import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { hashUserId } from "../../../lib/hash";
import { logger } from "../../../lib/logger";
import { createRequestContext } from "../../../lib/request";
import { rateLimit } from "../../../lib/rateLimit";
import { parseQuery, recommend, writeRecommendationEvent } from "../../../lib/reco/engine";
import { runFoodBuddyAgent } from "../../../lib/agent/agent";
import { getLocationCoords, normalizeGeoLocation, type GeoLocation } from "../../../lib/location";
import { DEFAULT_MAX_DISTANCE_MULTIPLIER } from "../../../lib/geo/constants";
import { filterByMaxDistance } from "../../../lib/geo/safetyNet";
import { haversineMeters } from "../../../lib/reco/scoring";
import { getLLMSettings } from "../../../lib/settings/llm";
import { isAllowedModel } from "../../../lib/agent/model";
import { detectIntent, isSmallTalkMessage } from "../../../lib/chat/intent";
import { normalizeMcpPlace } from "../../../lib/places/normalizeMcpPlace";
import {
  buildNearbySearchArgs,
  buildTextSearchArgs,
  extractPlacesFromMcp,
  formatErrorSnippet,
  getNextPageToken,
  matchSchemaKey,
  searchPlacesWithMcp,
  shouldRetryWithTextSearch,
} from "../../../lib/chat/routeInternals";
import {
  clearPending,
  getFollowUpSession,
  getOrCreateSession,
  loadSearchSession,
  setLastLocation,
  setPending,
  upsertSearchSession,
} from "../../../lib/searchSession";
import {
  buildFoodSearchQuery,
  filterFoodPlaces,
  hasExplicitLocationPhrase,
} from "../../../lib/places/foodFilter";
import { PENDING_ACTION_RECOMMEND } from "../../../lib/chat/recommendState";
import { geocodeLocationText } from "../../../lib/intent/geocode";
import { applyGuardrails } from "../../../lib/intent/locationGuardrails";
import { parseLocationWithLLM } from "../../../lib/intent/locationParser";
import {
  normalizeRequestCoords,
  resolveSearchCoords,
  type SearchCoordsSource,
} from "../../../lib/chat/searchCoords";
import { listMcpTools, mcpCall } from "../../../lib/mcp/client";
import { resolveMcpPayloadFromResult } from "../../../lib/mcp/resultParser";
import { resolveMcpTools } from "../../../lib/mcp/toolResolver";
import type { ToolDefinition } from "../../../lib/mcp/types";
import { buildFallbackNarration } from "../../../lib/narration/fallbackNarration";
import { narratePlacesWithLLM } from "../../../lib/narration/narratePlaces";
import type {
  ChatResponse,
  RecommendationCardData,
} from "../../../lib/types/chat";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const defaultTimeoutMs = 12_000;
const extendedTimeoutMs = 25_000;
const locationPromptMessage =
  "Please share your location or enable GPS (e.g., Yangon, Hlaing, Mandalay).";
const allowRequestCoordsFallback =
  process.env.EXPLICIT_LOCATION_COORDS_FALLBACK !== "false";


type ChatRequestBody = {
  anonId: string;
  sessionId?: string;
  location?: { lat: number; lng: number };
  locationText?: string;
  neighborhood?: string;
  message: string;
  action?: string;
  latitude?: number | null;
  longitude?: number | null;
  radius_m?: number | null;
  locationEnabled?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isError = (value: unknown): value is Error => value instanceof Error;

const isAbortError = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

type Attempt = {
  radius: number;
  endpoint: string;
  resultsCount: number;
  keyword: string | undefined;
  googleStatus: string | undefined;
};

type LegacyChatStatus = "OK" | "NO_RESULTS" | "ERROR" | "fallback";

type ToolDebugInfo = {
  endpointUsed?: string;
  provider?: string;
  googleStatus?: string;
  error_message?: string;
  attempts?: Attempt[];
};

const coerceNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const coerceString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const sanitizeAttempts = (raw: unknown): Attempt[] | undefined => {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const attempts = raw
    .filter(isRecord)
    .map((attempt) => {
      const radius = coerceNumber(attempt.radius);
      const resultsCount = coerceNumber(attempt.resultsCount);
      const endpoint = coerceString(attempt.endpoint);
      if (!endpoint || radius === undefined || resultsCount === undefined) {
        return undefined;
      }
      const keyword = coerceString(attempt.keyword);
      const googleStatus = coerceString(attempt.googleStatus);
      return {
        radius,
        endpoint,
        resultsCount,
        keyword,
        googleStatus,
      };
    })
    .filter((attempt): attempt is Attempt => attempt !== null);
  return attempts.length > 0 ? attempts : undefined;
};

const parseChatRequestBody = (payload: unknown): ChatRequestBody | null => {
  if (!isRecord(payload)) {
    return null;
  }
  const anonId = typeof payload.anonId === "string" ? payload.anonId : "";
  const sessionId =
    typeof payload.sessionId === "string" && payload.sessionId.trim().length > 0
      ? payload.sessionId
      : undefined;
  const action = typeof payload.action === "string" ? payload.action : undefined;
  let message = typeof payload.message === "string" ? payload.message : "";
  if (!anonId || (!message && action !== "more")) {
    return null;
  }
  if (!message && action === "more") {
    message = "show more options";
  }
  const location =
    isRecord(payload.location) &&
    typeof payload.location.lat === "number" &&
    Number.isFinite(payload.location.lat) &&
    typeof payload.location.lng === "number" &&
    Number.isFinite(payload.location.lng)
      ? { lat: payload.location.lat, lng: payload.location.lng }
      : undefined;
  const latitude =
    typeof payload.latitude === "number" && Number.isFinite(payload.latitude)
      ? payload.latitude
      : null;
  const longitude =
    typeof payload.longitude === "number" && Number.isFinite(payload.longitude)
      ? payload.longitude
      : null;
  const radius_m =
    typeof payload.radius_m === "number" && Number.isFinite(payload.radius_m)
      ? payload.radius_m
      : null;
  const locationText =
    typeof payload.locationText === "string" ? payload.locationText : undefined;
  const neighborhood =
    typeof payload.neighborhood === "string" ? payload.neighborhood : undefined;
  const locationEnabled =
    typeof payload.locationEnabled === "boolean" ? payload.locationEnabled : undefined;
  return {
    anonId,
    sessionId,
    message,
    action,
    location,
    locationText,
    neighborhood,
    latitude,
    longitude,
    radius_m,
    locationEnabled,
  };
};

const isChatRequestBody = (value: ChatRequestBody | null): value is ChatRequestBody =>
  value !== null;

const buildToolDebug = (
  toolDebug?: Record<string, unknown>,
): ToolDebugInfo | undefined => {
  if (!toolDebug) {
    return undefined;
  }
  const tool = toolDebug.tool;
  if (!isRecord(tool)) {
    return undefined;
  }
  const attempts = sanitizeAttempts(tool.attempts);
  return {
    endpointUsed: typeof tool.endpointUsed === "string" ? tool.endpointUsed : undefined,
    provider: typeof tool.provider === "string" ? tool.provider : undefined,
    googleStatus: typeof tool.googleStatus === "string" ? tool.googleStatus : undefined,
    error_message: typeof tool.error_message === "string" ? tool.error_message : undefined,
    attempts,
  };
};

const buildRecommendationPayload = (
  result: Awaited<ReturnType<typeof recommend>>,
  location?: { lat: number; lng: number },
) => {
  const allResults = [result.primary, ...result.alternatives].filter(Boolean);
  const results = allResults.filter(
    (item): item is NonNullable<typeof item> => item !== null
  );
  return results.map((item) => {
    const distanceMeters = location
      ? haversineMeters(location, { lat: item.place.lat, lng: item.place.lng })
      : undefined;
    return {
      placeId: item.place.placeId,
      name: item.place.name,
      rating: item.place.rating,
      lat: item.place.lat,
      lng: item.place.lng,
      distanceMeters,
      openNow: item.place.openNow,
      address: item.place.address,
      mapsUrl: item.place.mapsUrl,
      rationale: item.explanation,
    };
  });
};

const normalizeChatStatus = (
  status?: LegacyChatStatus,
): ChatResponse["status"] => {
  if (status === "ERROR" || status === "fallback") {
    return "error";
  }
  return "ok";
};

const sanitizeMessage = (message: string | null | undefined, fallback: string) => {
  if (!message) {
    return fallback;
  }
  const trimmed = message.trim();
  if (!trimmed) {
    return fallback;
  }
  const looksLikeJson =
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    /"\s*[^"]+"\s*:/.test(trimmed) ||
    /'\s*[^']+'\s*:/.test(trimmed);
  const looksLikeStack =
    /traceback|stack trace|stacktrace/i.test(trimmed) || /\n\s*at\s+\S+\s*\(/.test(trimmed);
  const mentionsLogs = /\blogs\b/i.test(trimmed);
  if (looksLikeJson || looksLikeStack || mentionsLogs) {
    return fallback;
  }
  return trimmed;
};

const stripMcpLogs = (message: string | null | undefined) => {
  if (!message) {
    return "";
  }
  const withoutJsonLogs = message
    .replace(/"logs"\s*:\s*\[[\s\S]*?\]\s*,?/gi, "")
    .replace(/"logs"\s*:\s*\{[\s\S]*?\}\s*,?/gi, "");
  const filteredLines = withoutJsonLogs
    .split("\n")
    .filter((line) => !/^logs?\s*[:=]/i.test(line.trim()));
  return filteredLines.join("\n").trim();
};

const safeUserMessage = (input: string | null | undefined, fallback: string) =>
  sanitizeMessage(stripMcpLogs(input), fallback);

const CUISINE_KEYWORDS = [
  "chinese",
  "thai",
  "korean",
  "japanese",
  "burmese",
  "myanmar",
  "indian",
  "malay",
  "vietnamese",
  "seafood",
  "vegetarian",
  "vegan",
  "halal",
  "pizza",
  "burger",
  "bbq",
  "barbecue",
  "hotpot",
  "dim sum",
  "noodle",
  "noodles",
  "ramen",
  "sushi",
  "coffee",
  "tea",
  "dessert",
  "cake",
  "breakfast",
  "brunch",
  "lunch",
  "dinner",
];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const formatCuisineLabel = (keyword: string) => {
  const normalized = keyword.trim().toLowerCase();
  if (normalized === "bbq") {
    return "BBQ";
  }
  return normalized
    .split(" ")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
};

const extractCuisineKeyword = (message: string | null | undefined) => {
  if (!message) {
    return undefined;
  }
  const normalized = message.toLowerCase();
  return CUISINE_KEYWORDS.find((keyword) =>
    new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i").test(normalized),
  );
};

const formatRadiusKm = (radiusMeters: number) => {
  const km = radiusMeters / 1000;
  const rounded = Math.round(km * 10) / 10;
  return rounded.toFixed(1).replace(/\.0$/, "");
};

const buildPlacesIntroMessage = ({
  userMessage,
  locationLabel,
  radiusMeters,
}: {
  userMessage?: string;
  locationLabel?: string;
  radiusMeters?: number;
}) => {
  const cuisineKeyword = extractCuisineKeyword(userMessage);
  const safeLocation = locationLabel?.trim();
  if (safeLocation && typeof radiusMeters === "number" && radiusMeters > 0) {
    return `Here are a few options within ~${formatRadiusKm(
      radiusMeters,
    )} km of ${safeLocation}.`;
  }
  if (safeLocation) {
    return `Got it — here are a few options near ${safeLocation}.`;
  }
  if (cuisineKeyword) {
    return `Got it — here are a few ${formatCuisineLabel(cuisineKeyword)} options.`;
  }
  return "Got it — here are a few options.";
};

const buildNarratedMessage = async ({
  query,
  userMessage,
  locationLabel,
  places,
  locale,
  requestId,
  timeoutMs,
  fallbackMessage,
}: {
  query: string;
  userMessage: string;
  locationLabel?: string;
  places: RecommendationCardData[];
  locale?: string | null;
  requestId: string;
  timeoutMs: number;
  fallbackMessage?: string;
}) => {
  if (places.length === 0) {
    return fallbackMessage ?? buildFallbackNarration(places);
  }
  try {
    const narrated = await narratePlacesWithLLM({
      query,
      userMessage,
      locationLabel,
      places,
      locale: locale ?? undefined,
      requestId,
      timeoutMs,
    });
    const fallbackNarration = buildFallbackNarration(places);
    return safeUserMessage(narrated, fallbackNarration);
  } catch (err) {
    logger.warn({ err, requestId }, "Failed to narrate places");
    return buildFallbackNarration(places);
  }
};

const followUpIntentRegex = /show more|more options|next|another|refine/i;

const isFollowUpIntent = (body: ChatRequestBody) =>
  followUpIntentRegex.test(body.message);

const isFollowUpRequest = (body: ChatRequestBody) => {
  const normalized = body.message.trim().toLowerCase();
  return normalized === "show more options" || body.action === "more";
};

const fetchMoreFromMcp = async ({
  session,
  requestId,
}: {
  session: {
    id: string;
    lastQuery: string;
    lat: number;
    lng: number;
    radius: number;
    nextPageToken?: string | null;
  };
  requestId: string;
}) => {
  const mcpUrl = (process.env.COMPOSIO_MCP_URL ?? "").trim().replace(/^"+|"+$/g, "");
  const composioApiKey = process.env.COMPOSIO_API_KEY ?? "";
  if (!mcpUrl) {
    return {
      places: [],
      nextPageToken: session.nextPageToken ?? undefined,
      message: "No more results yet — try a new search.",
      usedRadius: session.radius,
    };
  }

  const tools = await listMcpTools({
    url: mcpUrl,
    apiKey: composioApiKey,
    requestId,
  });
  const resolvedTools = resolveMcpTools(tools);
  const normalizedQuery = buildFoodSearchQuery(session.lastQuery);
  const preferTextSearch = hasExplicitLocationPhrase(session.lastQuery);
  const selectedTool = preferTextSearch
    ? resolvedTools.textSearch ?? resolvedTools.nearbySearch
    : resolvedTools.nearbySearch ?? resolvedTools.textSearch;
  if (!selectedTool) {
    return {
      places: [],
      nextPageToken: session.nextPageToken ?? undefined,
      message: "Places search is temporarily unavailable.",
      usedRadius: session.radius,
    };
  }

  const supportsNextPageToken = Boolean(
    matchSchemaKey(selectedTool.inputSchema, [
      "nextpagetoken",
      "next_page_token",
      "pagetoken",
      "page_token",
      "pageToken",
    ]),
  );
  const supportsMaxResultCount = Boolean(
    matchSchemaKey(selectedTool.inputSchema, ["maxresultcount", "maxresults", "limit"]),
  );
  const hasNextPageToken = Boolean(session.nextPageToken);
  const radiusMultiplier = supportsNextPageToken && hasNextPageToken ? 1 : 1.5;
  const radiusMeters = Math.round(session.radius * radiusMultiplier);
  const maxResultCount = supportsMaxResultCount ? 30 : undefined;
  const nextPageToken =
    supportsNextPageToken && session.nextPageToken ? session.nextPageToken : undefined;

  const callTool = async (tool: ToolDefinition, toolArgs: Record<string, unknown>) => {
    return mcpCall<unknown>({
      url: mcpUrl,
      apiKey: composioApiKey,
      method: "tools/call",
      params: { name: tool.name, arguments: toolArgs },
      requestId,
    });
  };

  let payload: unknown;
  if (selectedTool.name === resolvedTools.textSearch?.name) {
    const { args, query, includedTypes } = buildTextSearchArgs(selectedTool, {
      query: session.lastQuery,
      location: { lat: session.lat, lng: session.lng },
      radiusMeters,
      maxResultCount,
      nextPageToken: supportsNextPageToken ? nextPageToken : undefined,
    });
    logger.info(
      {
        requestId,
        selectedToolName: selectedTool.name,
        usedMode: "text",
        query,
        includedTypes,
        radiusMeters,
      },
      "MCP search request",
    );
    payload = await callTool(selectedTool, args);
  } else {
    const { args, includedTypes } = buildNearbySearchArgs(selectedTool, {
      lat: session.lat,
      lng: session.lng,
      radiusMeters,
      keyword: normalizedQuery,
      nextPageToken,
      maxResultCount,
    });
    logger.info(
      {
        requestId,
        selectedToolName: selectedTool.name,
        usedMode: "nearby",
        keyword: normalizedQuery,
        includedTypes,
        radiusMeters,
      },
      "MCP search request",
    );
    payload = await callTool(selectedTool, args);
  }

  let { payload: parsedPayload } = resolveMcpPayloadFromResult(payload);
  let { places, successfull, error } = extractPlacesFromMcp(payload);
  let retriedWithTextSearch = false;
  let usedFallback = false;
  const isNearbySearch = selectedTool.name === resolvedTools.nearbySearch?.name;
  const hasTextSearchTool = Boolean(resolvedTools.textSearch);
  if (
    shouldRetryWithTextSearch({
      successfull,
      error,
      payload: parsedPayload ?? payload,
      isNearbySearch,
      retriedWithTextSearch,
      hasTextSearchTool,
    })
  ) {
    retriedWithTextSearch = true;
    logger.warn(
      {
        requestId,
        originalTool: selectedTool.name,
        fallbackTool: resolvedTools.textSearch?.name,
        errorSnippet: formatErrorSnippet(error),
      },
      "MCP nearby follow-up failed; retrying with text search",
    );

    const fallbackTool = resolvedTools.textSearch;
    if (fallbackTool) {
      const fallbackKeyword =
        session.lastQuery.trim().length > 0 ? session.lastQuery.trim() : "restaurant";
      const fallbackPayload = await callTool(
        fallbackTool,
        (() => {
          const { args, query, includedTypes } = buildTextSearchArgs(fallbackTool, {
            query: fallbackKeyword,
            location: { lat: session.lat, lng: session.lng },
            radiusMeters,
            maxResultCount,
          });
          logger.info(
            {
              requestId,
              selectedToolName: fallbackTool.name,
              usedMode: "text",
              query,
              includedTypes,
              radiusMeters,
              fallback: true,
            },
            "MCP search request",
          );
          return args;
        })(),
      );
      const fallbackParsed = resolveMcpPayloadFromResult(fallbackPayload);
      const fallbackResult = extractPlacesFromMcp(fallbackPayload);
      if (fallbackResult.successfull !== false) {
        parsedPayload = fallbackParsed.payload;
        places = fallbackResult.places;
        successfull = fallbackResult.successfull;
        error = fallbackResult.error;
        usedFallback = true;
      }
    }
  }

  if (successfull === false) {
    logger.warn(
      { requestId, provider: "MCP", errorMessage: error },
      "MCP follow-up search failed",
    );
  }
  const filtered = filterFoodPlaces(places, normalizedQuery);
  const normalized = filtered
    .map((place) => normalizeMcpPlace(place, { lat: session.lat, lng: session.lng }))
    .filter((place): place is RecommendationCardData => Boolean(place));
  const updatedNextPageToken = getNextPageToken(parsedPayload ?? payload);

  const message =
    successfull === false
      ? "Couldn't fetch nearby places. Please try again."
      : usedFallback && normalized.length > 0
        ? "I had trouble with nearby filtering, so I searched by text instead. Here are some options."
        : normalized.length > 0
          ? "Here are more places you might like."
          : "I couldn’t find food places for that. Try a different keyword (e.g., 'hotpot', 'noodle', 'dim sum').";

  return {
    places: normalized,
    nextPageToken: updatedNextPageToken,
    message,
    usedRadius: radiusMeters,
  };
};

const buildChatResponse = ({
  status,
  message,
  places,
  sessionId,
  nextPageToken,
  userMessage,
  locationLabel,
  radiusMeters,
  needsLocation,
}: {
  status: ChatResponse["status"];
  message: string;
  places: RecommendationCardData[];
  sessionId?: string;
  nextPageToken?: string;
  userMessage?: string;
  locationLabel?: string;
  radiusMeters?: number;
  needsLocation?: boolean;
}): ChatResponse => ({
  status,
  message: (() => {
    const sanitizedMessage = safeUserMessage(message, "");
    if (places.length > 0) {
      const intro = buildPlacesIntroMessage({
        userMessage,
        locationLabel,
        radiusMeters,
      });
      return sanitizedMessage ? `${intro} ${sanitizedMessage}` : intro;
    }
    return sanitizedMessage || safeUserMessage(message, "Here are a few places you might like.");
  })(),
  places,
  meta:
    sessionId || nextPageToken || needsLocation
      ? {
          sessionId,
          nextPageToken,
          needs_location: needsLocation || undefined,
        }
      : undefined,
});

const buildAgentResponse = ({
  agentMessage,
  recommendations,
  status,
  requestId,
  errorMessage,
  debugEnabled,
  toolDebug,
  sessionId,
  userMessage,
  locationLabel,
  radiusMeters,
}: {
  agentMessage: string | null | undefined;
  recommendations: RecommendationCardData[];
  status?: LegacyChatStatus;
  requestId: string;
  errorMessage?: string;
  debugEnabled: boolean;
  toolDebug?: Record<string, unknown>;
  sessionId: string;
  userMessage?: string;
  locationLabel?: string;
  radiusMeters?: number;
}): ChatResponse => {
  const hasRecommendations = recommendations.length > 0;
  const resolvedStatus = normalizeChatStatus(status ?? (hasRecommendations ? "OK" : "NO_RESULTS"));
  const baseMessage = hasRecommendations
    ? "Here are a few places you might like."
    : "Tell me a neighborhood or enable location so I can find nearby places.";
  const errorFallback = "Sorry, something went wrong while finding places.";
  const message = safeUserMessage(
    agentMessage,
    resolvedStatus === "error" ? errorFallback : baseMessage,
  );
  if (debugEnabled && errorMessage) {
    const toolDebugInfo = isRecord(toolDebug) ? toolDebug : undefined;
    const toolInfo = buildToolDebug(toolDebugInfo);
    logger.info(
      {
        requestId,
        toolProvider: toolInfo?.provider,
        errorMessage,
      },
      "Agent tool debug summary",
    );
  }
  return buildChatResponse({
    status: resolvedStatus,
    message,
    places: recommendations,
    sessionId,
    userMessage,
    locationLabel,
    radiusMeters,
  });
};

export async function POST(request: Request) {
  const { requestId, startTime } = createRequestContext(request);
  const channel = "WEB";
  const logContext = { requestId, channel };
  const debugEnabled = process.env.FOODBUDDY_DEBUG === "true";
  const respondChat = (status: number, payload: ChatResponse) => {
    const response = NextResponse.json(payload, { status });
    response.headers.set("x-request-id", requestId);
    logger.info(
      {
        ...logContext,
        latencyMs: Date.now() - startTime,
        responseKeys: Object.keys(payload),
        placesCount: payload.places?.length ?? 0,
      },
      "Returning ChatResponse",
    );
    return response;
  };
  const respondError = (status: number, message: string, sessionId?: string) => {
    const response = respondChat(
      status,
      buildChatResponse({
        status: "error",
        message,
        places: [],
        sessionId,
      }),
    );
    logger.info({ ...logContext, latencyMs: Date.now() - startTime }, "chat request complete");
    return response;
  };

  const rawBody = await request.json();
  const parsedBody = parseChatRequestBody(rawBody);

  if (!isChatRequestBody(parsedBody)) {
    return respondError(400, "Invalid request.");
  }
  const body: ChatRequestBody = parsedBody;

  const sessionId = body.sessionId ?? randomUUID();
  const timeoutMs = isFollowUpIntent(body) ? extendedTimeoutMs : defaultTimeoutMs;

  if (body.message.length > 500) {
    return respondError(400, "Message too long.", sessionId);
  }

  const userIdHash = hashUserId(body.anonId);
  const requestLocationText = body.neighborhood ?? body.locationText;
  const reqCoords = normalizeRequestCoords(rawBody);
  const roundedLat = reqCoords ? Math.round(reqCoords.lat * 1000) / 1000 : undefined;
  const roundedLng = reqCoords ? Math.round(reqCoords.lng * 1000) / 1000 : undefined;
  const geoLocation = normalizeGeoLocation({
    coordinates: reqCoords ?? body.location,
    latitude: body.latitude ?? undefined,
    longitude: body.longitude ?? undefined,
    locationText: requestLocationText,
  });
  const gpsCoords = getLocationCoords(geoLocation);
  const coords = reqCoords ?? gpsCoords ?? null;
  const hasCoordinates = Boolean(reqCoords);
  const locationText = requestLocationText ?? undefined;
  const eventLocation: GeoLocation =
    coords
      ? {
          kind: "coords",
          coords: { lat: roundCoord(coords.lat), lng: roundCoord(coords.lng) },
        }
      : geoLocation.kind === "text"
        ? geoLocation
        : { kind: "none" };
  const locationEnabled = Boolean(body.locationEnabled);
  const locale = request.headers.get("accept-language")?.split(",")[0] ?? null;
  const radius_m =
    typeof body.radius_m === "number" && Number.isFinite(body.radius_m) && body.radius_m > 0
      ? body.radius_m
      : 1500;
  const radiusMeters = Math.round(radius_m);
  const radius_defaulted =
    locationEnabled &&
    hasCoordinates &&
    !(typeof body.radius_m === "number" && Number.isFinite(body.radius_m) && body.radius_m > 0);
  const narrationTimeoutMs = Number(process.env.NARRATION_LLM_TIMEOUT_MS ?? 2800);
  const searchMessage = body.message;
  const sessionQuery = body.message;

  logger.info(
    {
      ...logContext,
      hasCoordinates,
      reqCoordsPresent: Boolean(reqCoords),
      latRounded: roundedLat,
      lngRounded: roundedLng,
    },
    "Parsed request coords",
  );

  logger.info(
    {
      ...logContext,
      message: body.message,
      hasCoordinates,
      radius_m,
      radius_defaulted: radius_defaulted || undefined,
      locationEnabled,
      timeoutMs,
    },
    "Incoming chat request",
  );

  const limiter = rateLimit(`chat:${userIdHash}`, 10, 60_000);
  if (!limiter.allowed) {
    const response = respondError(
      429,
      "Too many requests. Please wait a moment and try again.",
      sessionId,
    );
    response.headers.set(
      "Retry-After",
      Math.ceil((limiter.resetAt - Date.now()) / 1000).toString(),
    );
    return response;
  }

  const intent = detectIntent(body.message);
  const searchSession = await getOrCreateSession({ sessionId, channel });
  const hasPendingRecommend =
    searchSession?.pendingAction === PENDING_ACTION_RECOMMEND;
  const shouldHandleSmallTalk =
    intent === "SMALL_TALK" && !(hasPendingRecommend && !isSmallTalkMessage(body.message));

  if (shouldHandleSmallTalk) {
    const smallTalkMessage =
      "Hi! Tell me what you’re craving, or ask for a cuisine near a place (e.g., 'dim sum near Yangon').";
    return respondChat(
      200,
      buildChatResponse({
        status: "ok",
        message: smallTalkMessage,
        places: [],
        sessionId,
        userMessage: body.message,
        locationLabel: locationText,
        radiusMeters,
      }),
    );
  }

  if (isFollowUpRequest(body)) {
    const storedSession = body.sessionId
      ? await getFollowUpSession(body.sessionId)
      : null;
    if (!storedSession) {
    return respondChat(
      200,
      buildChatResponse({
        status: "ok",
        message: "No more results yet — try a new search.",
        places: [],
        sessionId,
        userMessage: body.message,
        locationLabel: locationText,
        radiusMeters,
      }),
    );
  }

    const followUp = await fetchMoreFromMcp({
      session: storedSession,
      requestId,
    });

    await upsertSearchSession({
      sessionId: storedSession.id,
      lastQuery: storedSession.lastQuery,
      lastLat: storedSession.lat,
      lastLng: storedSession.lng,
      lastRadiusM: followUp.usedRadius ?? storedSession.radius,
      nextPageToken: followUp.nextPageToken ?? null,
    });

    const followUpFallbackMessage =
      followUp.places.length > 0
        ? "Here are more places you might like."
        : "No more results yet — try a new search.";
    const followUpMessage = await buildNarratedMessage({
      query: storedSession.lastQuery,
      userMessage: body.message,
      locationLabel: locationText,
      places: followUp.places,
      locale,
      requestId,
      timeoutMs: narrationTimeoutMs,
      fallbackMessage: followUpFallbackMessage,
    });

    return respondChat(
      200,
      buildChatResponse({
        status: "ok",
        message: followUpMessage,
        places: followUp.places,
        sessionId: storedSession.id,
        nextPageToken: followUp.nextPageToken,
        userMessage: body.message,
        locationLabel: locationText,
        radiusMeters: followUp.usedRadius ?? storedSession.radius,
      }),
    );
  }

  const countryHint = request.headers.get("x-country");
  const parserResult = await parseLocationWithLLM({
    message: searchMessage,
    coords,
    channel,
    locale,
    countryHint,
    lastQuery: searchSession?.lastQuery ?? undefined,
    lastRadiusM: searchSession?.lastRadiusM ?? undefined,
    requestId,
  });
  const guarded = applyGuardrails(parserResult, {
    coords,
    explicitLocationText: requestLocationText,
    requestId,
  });
  const effectiveParse = guarded;

  logger.info(
    {
      requestId,
      query: effectiveParse.query,
      location_text: effectiveParse.location_text ?? null,
      use_device_location: effectiveParse.use_device_location,
      confidence: effectiveParse.confidence,
    },
    "Location parser summary",
  );

  const pendingKeyword =
    searchSession?.pendingAction === PENDING_ACTION_RECOMMEND
      ? searchSession.pendingKeyword ?? undefined
      : undefined;
  const parsedKeyword = effectiveParse.query?.trim();
  const keyword =
    (parsedKeyword && parsedKeyword.length > 0 ? parsedKeyword : undefined) ??
    pendingKeyword ??
    extractCuisineKeyword(body.message) ??
    "restaurant";
  const parsedRadius =
    typeof effectiveParse.radius_m === "number" &&
    Number.isFinite(effectiveParse.radius_m) &&
    effectiveParse.radius_m > 0
      ? Math.round(effectiveParse.radius_m)
      : radiusMeters;
  const placeTypes =
    Array.isArray(effectiveParse.place_types) && effectiveParse.place_types.length > 0
      ? effectiveParse.place_types
      : undefined;
  const explicitLocationText = effectiveParse.location_text?.trim() || undefined;
  const explicitLocationPresent = Boolean(explicitLocationText);

  if (!explicitLocationPresent && !reqCoords) {
    await setPending(sessionId, {
      action: PENDING_ACTION_RECOMMEND,
      keyword,
    });
    logger.info(
      {
        requestId,
        explicitLocationPresent,
        coordsSource: "none",
        keyword,
        latRounded: null,
        lngRounded: null,
      },
      "Location resolution decision",
    );
    return respondChat(
      200,
      buildChatResponse({
        status: "ok",
        message: locationPromptMessage,
        places: [],
        sessionId,
        userMessage: body.message,
        locationLabel: locationText,
        radiusMeters: parsedRadius,
        needsLocation: true,
      }),
    );
  }

  let searchCoords: { lat: number; lng: number } | null = null;
  let resolvedLocationLabel: string | undefined = locationText ?? undefined;
  let searchLocationText: string | undefined;
  let confirmMessage: string | undefined;
  let coordsSource: SearchCoordsSource = "none";

  if (!reqCoords && effectiveParse.location_text) {
    await setPending(sessionId, {
      action: PENDING_ACTION_RECOMMEND,
      keyword,
    });
  }

  const resolvedSearchCoords = await resolveSearchCoords({
    reqCoords,
    locationText: explicitLocationText,
    requestId,
    locale,
    countryHint,
    coords,
    geocode: geocodeLocationText,
  });

  if (resolvedSearchCoords.geocodeFailed) {
    if (reqCoords && allowRequestCoordsFallback) {
      logger.warn(
        { requestId, keyword },
        "Geocode failed; falling back to request coords",
      );
      searchCoords = reqCoords;
      coordsSource = "request_coords";
    } else {
      return respondChat(
        200,
        buildChatResponse({
          status: "ok",
          message:
            "I couldn't find that location. Please provide a more specific location (e.g., 'Thanlyin, Yangon').",
          places: [],
          sessionId,
          userMessage: body.message,
          locationLabel: locationText,
          radiusMeters: parsedRadius,
          needsLocation: true,
        }),
      );
    }
  } else {
    searchCoords = resolvedSearchCoords.searchCoords;
    coordsSource = resolvedSearchCoords.coordsSource;
    resolvedLocationLabel =
      resolvedSearchCoords.resolvedLocationLabel ?? resolvedLocationLabel;
    searchLocationText = resolvedSearchCoords.searchLocationText ?? searchLocationText;
    confirmMessage = resolvedSearchCoords.confirmMessage ?? confirmMessage;
  }

  if (!searchCoords) {
    await setPending(sessionId, {
      action: PENDING_ACTION_RECOMMEND,
      keyword,
    });
    return respondChat(
      200,
      buildChatResponse({
        status: "ok",
        message: locationPromptMessage,
        places: [],
        sessionId,
        userMessage: body.message,
        locationLabel: locationText,
        radiusMeters: parsedRadius,
        needsLocation: true,
      }),
    );
  }

  await clearPending(sessionId);
  await setLastLocation(sessionId, {
    lat: searchCoords.lat,
    lng: searchCoords.lng,
    radiusM: parsedRadius,
  });

  logger.info(
    {
      requestId,
      explicitLocationPresent,
      coordsSource,
      keyword,
      latRounded: Math.round(searchCoords.lat * 1000) / 1000,
      lngRounded: Math.round(searchCoords.lng * 1000) / 1000,
    },
    "Location resolution decision",
  );

  logger.info(
    {
      requestId,
      coordsSource,
      keyword,
      radiusMeters: parsedRadius,
      lat: searchCoords.lat,
      lng: searchCoords.lng,
    },
    "Final search params",
  );

  const searchResult = await searchPlacesWithMcp({
    keyword,
    coords: searchCoords,
    radiusMeters: parsedRadius,
    requestId,
    locationText: searchLocationText,
    forceNearbySearch: coordsSource === "geocoded_text",
    placeTypes,
  });

  await upsertSearchSession({
    sessionId,
    channel,
    lastQuery: buildFoodSearchQuery(keyword),
    lastLat: searchCoords.lat,
    lastLng: searchCoords.lng,
    lastRadiusM: parsedRadius,
    nextPageToken: searchResult.nextPageToken ?? null,
  });

  const searchFallbackMessage =
    searchResult.places.length > 0
      ? "Here are a few places you might like."
      : "I couldn’t find food places for that. Try a different keyword (e.g., 'hotpot', 'noodle', 'dim sum').";
  const narratedMessage = await buildNarratedMessage({
    query: keyword,
    userMessage: body.message,
    locationLabel: resolvedLocationLabel,
    places: searchResult.places,
    locale,
    requestId,
    timeoutMs: narrationTimeoutMs,
    fallbackMessage: searchFallbackMessage,
  });

  return respondChat(
    200,
    buildChatResponse({
      status: "ok",
      message: confirmMessage ? `${confirmMessage} ${narratedMessage}` : narratedMessage,
      places: searchResult.places,
      sessionId,
      nextPageToken: searchResult.nextPageToken,
      userMessage: body.message,
      locationLabel: resolvedLocationLabel,
      radiusMeters: parsedRadius,
    }),
  );

  const settings = await getLLMSettings();
  const llmModel = settings.llmModel;
  if (!llmModel) {
    logger.warn({ ...logContext }, "LLM model missing, using fallback");
  }
  let llmTimedOut = false;
  try {
    const hasSystemPrompt =
      typeof settings.llmSystemPrompt === "string" &&
      settings.llmSystemPrompt.trim().length > 0;
    const agentEnabled = settings.llmEnabled === true;
    const modelAllowed = isAllowedModel(llmModel);
    let reason = "agent_success";

    if (!agentEnabled) {
      reason = "agent_disabled";
    } else if (!llmModel) {
      reason = "missing_model";
    } else if (!modelAllowed) {
      reason = "invalid_model";
    } else if (!hasSystemPrompt) {
      reason = "missing_prompt";
    }

    if (reason === "agent_success") {
      if (geoLocation.kind === "none") {
        const message = locationPromptMessage;
        await writeRecommendationEvent(
          {
            channel: "WEB",
            userIdHash,
            location: eventLocation,
            queryText: body.message,
            requestId,
            locationEnabled,
            radiusMeters,
            source: "agent",
            agentEnabled,
            llmModel,
            toolCallCount: 0,
            fallbackUsed: false,
            rawResponseJson: truncateJson(JSON.stringify({ message })),
          },
          {
            status: "ERROR",
            latencyMs: Date.now() - startTime,
            errorMessage: "Missing location",
            resultCount: 0,
            recommendedPlaceIds: [],
            parsedConstraints: parseQuery(body.message),
          },
        );
        return respondChat(
          200,
          buildAgentResponse({
            agentMessage: message,
            recommendations: [],
            status: "ERROR",
            requestId,
            debugEnabled,
            sessionId,
            userMessage: body.message,
            locationLabel: locationText,
            radiusMeters,
          }),
        );
      }

      logger.info(
        {
          ...logContext,
          path: "llm_agent",
          agentEnabled,
          llmModel,
          hasSystemPrompt,
          reason,
          timeoutMs,
        },
        "Routing chat to agent",
      );
      const agentStart = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let agentResult: Awaited<ReturnType<typeof runFoodBuddyAgent>> | null = null;
      try {
        agentResult = await runFoodBuddyAgent({
          userMessage: body.message,
          context: {
            location: eventLocation,
            radius_m,
            sessionId,
            requestId,
            userIdHash,
            channel,
            locale: locale ?? undefined,
            locationEnabled,
          },
          signal: controller.signal,
        });
      } catch (err) {
        if (isAbortError(err)) {
          llmTimedOut = true;
          reason = "llm_timeout";
          logger.info(
            { ...logContext, reason, requestId, timeoutMs },
            "LLM request timed out",
          );
        } else {
          throw err;
        }
      } finally {
        clearTimeout(timeout);
      }

      if (agentResult !== null) {
        const resolvedAgentResult =
          agentResult as NonNullable<typeof agentResult>;
        const recommendations =
          resolvedAgentResult.places && resolvedAgentResult.places.length > 0
            ? resolvedAgentResult.places
            : [
                resolvedAgentResult.primary,
                ...(resolvedAgentResult.alternatives ?? []),
              ].filter(
                (item): item is RecommendationCardData => Boolean(item),
              );
        const resultCount = recommendations.length;
        const status = resolvedAgentResult.status;
        const parsedConstraints = parseQuery(body.message);
        const rawResponseJson = truncateJson(
          JSON.stringify({
            assistant: resolvedAgentResult.message,
            toolCallCount: resolvedAgentResult.toolCallCount,
            parsedOutput: resolvedAgentResult.parsedOutput,
            toolResponses: resolvedAgentResult.rawResponse,
          }),
        );
        const toolInfo = buildToolDebug(
          isRecord(resolvedAgentResult.toolDebug)
            ? resolvedAgentResult.toolDebug
            : undefined,
        );
        if (toolInfo || resolvedAgentResult.toolCallCount > 0) {
          logger.info(
            {
              requestId,
              tool: "recommend_places",
              returnedCount: resultCount,
              googleStatusIfAny: toolInfo?.googleStatus,
              errorIfAny: toolInfo?.error_message,
            },
            "Tool result summary",
          );
        }

        await writeRecommendationEvent(
          {
            channel: "WEB",
            userIdHash,
            location: eventLocation,
            queryText: body.message,
            requestId,
            locationEnabled,
            radiusMeters,
            source: "agent",
            agentEnabled,
            llmModel,
            toolCallCount: resolvedAgentResult.toolCallCount,
            fallbackUsed: resolvedAgentResult.fallbackUsed,
            rawResponseJson,
          },
          {
            status,
            latencyMs: Date.now() - agentStart,
            resultCount,
            recommendedPlaceIds: recommendations.map((item) => item.placeId),
            parsedConstraints: {
              ...parsedConstraints,
              llm: resolvedAgentResult.parsedOutput ?? null,
            },
          },
        );

        logger.info(
          { ...logContext, latencyMs: Date.now() - agentStart },
          "Agent response complete",
        );

        if (coords) {
          const resolvedCoords = coords as NonNullable<typeof coords>;
          const existingSession = await loadSearchSession(sessionId);
          await upsertSearchSession({
            sessionId,
            lastQuery: sessionQuery,
            lastLat: resolvedCoords.lat,
            lastLng: resolvedCoords.lng,
            lastRadiusM: radiusMeters,
            nextPageToken: existingSession?.nextPageToken ?? null,
          });
        }

        return respondChat(
          200,
          buildAgentResponse({
            agentMessage: resolvedAgentResult.message,
            recommendations,
            status,
            requestId,
            errorMessage: resolvedAgentResult.errorMessage,
            debugEnabled,
            toolDebug: resolvedAgentResult.toolDebug,
            sessionId,
            userMessage: body.message,
            locationLabel: locationText,
            radiusMeters,
          }),
        );
      }
    }

    logger.info(
      {
        ...logContext,
        path: "internal_recommend",
        agentEnabled,
        llmModel,
        hasSystemPrompt,
        reason,
      },
      "Routing chat to internal recommendations",
    );
  } catch (err) {
    logger.warn(
      {
        err,
        ...logContext,
        path: "internal_recommend",
        reason: "agent_failed_fallback",
      },
      "Agent failed; falling back to recommendations",
    );
  }

  const agentEnabled = settings.llmEnabled === true;

  if (!coords) {
    logger.info({ ...logContext, path: "fallback" }, "Missing location for chat");
    const message = locationPromptMessage;
    const responseStatus = llmTimedOut ? "fallback" : "ERROR";
    await writeRecommendationEvent(
      {
        channel: "WEB",
        userIdHash,
        location: eventLocation,
        queryText: body.message,
        requestId,
        locationEnabled,
        radiusMeters,
        source: "internal",
        agentEnabled,
        llmModel,
        toolCallCount: 0,
        fallbackUsed: false,
        rawResponseJson: truncateJson(JSON.stringify({ message })),
      },
      {
        status: "ERROR",
        latencyMs: Date.now() - startTime,
        errorMessage: "Missing location",
        resultCount: 0,
        recommendedPlaceIds: [],
        parsedConstraints: parseQuery(body.message),
      },
    );
    return respondChat(
      200,
      buildChatResponse({
        status: normalizeChatStatus(responseStatus),
        message,
        places: [],
        sessionId,
        userMessage: body.message,
        locationLabel: locationText,
        radiusMeters,
      }),
    );
  }

  const resolvedCoords = coords as NonNullable<typeof coords>;
  const recommendationStart = Date.now();
  const parsedConstraints = parseQuery(body.message);
  try {
    logger.info(
      { ...logContext, path: "internal_recommend" },
      "Routing chat to internal recommendations",
    );
    const recommendation = await recommend({
      channel: "WEB",
      userIdHash,
      location: resolvedCoords,
      queryText: searchMessage,
      radiusMetersOverride: radiusMeters,
      requestId,
    });

    let payload = buildRecommendationPayload(recommendation, resolvedCoords);
    const maxDistanceMeters = Math.max(
      radiusMeters * DEFAULT_MAX_DISTANCE_MULTIPLIER,
      5_000,
    );
    const safetyFiltered = filterByMaxDistance(
      resolvedCoords,
      payload,
      (item) =>
        typeof item.lat === "number" && typeof item.lng === "number"
          ? { lat: item.lat, lng: item.lng }
          : null,
      maxDistanceMeters,
    );
    if (safetyFiltered.droppedCount > 0) {
      logger.info(
        {
          requestId,
          originLat: resolvedCoords.lat,
          originLng: resolvedCoords.lng,
          radiusMeters,
          maxDistanceMeters,
          droppedCount: safetyFiltered.droppedCount,
          maxKeptDistance: safetyFiltered.maxKeptDistance,
        },
        "Dropped internal recommendations outside safety distance",
      );
    }
    payload = safetyFiltered.kept;
    const recommendedPlaceIds = payload.map((item) => item.placeId);
    const resultCount = payload.length;
    const recommendationDebug = recommendation.debug as
      | { tool?: { error_message?: string; provider?: string } }
      | undefined;
    const providerErrorMessage = recommendationDebug?.tool?.error_message
      ? "Places provider unavailable; please try again."
      : undefined;
    const status = providerErrorMessage
      ? "ERROR"
      : resultCount === 0
        ? "NO_RESULTS"
        : "OK";
    const responseStatus = llmTimedOut ? "fallback" : status;

    await writeRecommendationEvent(
      {
        channel: "WEB",
        userIdHash,
        location: eventLocation,
        queryText: body.message,
        requestId,
        locationEnabled,
        radiusMeters,
        source: "internal",
        agentEnabled,
        llmModel,
        toolCallCount: 0,
        fallbackUsed: false,
        rawResponseJson: truncateJson(
          JSON.stringify({
            status,
            resultCount,
            recommendedPlaceIds,
          }),
        ),
      },
      {
        status,
        latencyMs: Date.now() - recommendationStart,
        resultCount,
        recommendedPlaceIds,
        errorMessage: providerErrorMessage,
        parsedConstraints,
      },
    );

    const message =
      providerErrorMessage ??
      (resultCount > 0
        ? "Here are a few spots you might like."
        : "Sorry, I couldn't find any places for that query.");

    if (providerErrorMessage) {
      logger.info(
        { ...logContext, provider: recommendationDebug?.tool?.provider },
        providerErrorMessage,
      );
    }

    await upsertSearchSession({
      sessionId,
      lastQuery: sessionQuery,
      lastLat: resolvedCoords.lat,
      lastLng: resolvedCoords.lng,
      lastRadiusM: radiusMeters,
      nextPageToken: null,
    });

    if (llmTimedOut) {
      logger.warn(
        {
          ...logContext,
          fallbackSucceeded: true,
          finalOutcome: "fallback_ok",
          timeoutMs,
        },
        "LLM timed out; fallback recommendations succeeded",
      );
    }

    return respondChat(
      200,
      buildChatResponse({
        status: normalizeChatStatus(responseStatus),
        message,
        places: payload,
        sessionId,
        userMessage: body.message,
        locationLabel: locationText,
        radiusMeters,
      }),
    );
  } catch (fallbackError) {
    const errorMessage =
      isError(fallbackError)
        ? (fallbackError as Error).message
        : "Unknown error";
    await writeRecommendationEvent(
      {
        channel: "WEB",
        userIdHash,
        location: eventLocation,
        queryText: body.message,
        requestId,
        locationEnabled,
        radiusMeters,
        source: "internal",
        agentEnabled,
        llmModel,
        toolCallCount: 0,
        fallbackUsed: false,
        rawResponseJson: truncateJson(
          JSON.stringify({ error: errorMessage, message: "Internal fallback error" }),
        ),
      },
      {
        status: "ERROR",
        latencyMs: Date.now() - recommendationStart,
        errorMessage,
        resultCount: 0,
        recommendedPlaceIds: [],
        parsedConstraints,
      },
    );
    logger.error({ err: fallbackError, ...logContext }, "Failed fallback recommendations");
    return respondChat(
      200,
      buildChatResponse({
        status: "error",
        message: "Sorry, something went wrong while finding places.",
        places: [],
        sessionId,
        userMessage: body.message,
        locationLabel: locationText,
        radiusMeters,
      }),
    );
  }
}

const truncateJson = (value: string, maxLength = 8000) =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

const roundCoord = (value: number) => Math.round(value * 100) / 100;
