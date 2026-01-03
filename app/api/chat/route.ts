import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { hashUserId } from "../../../lib/hash";
import { logger } from "../../../lib/logger";
import { createRequestContext } from "../../../lib/request";
import { rateLimit } from "../../../lib/rateLimit";
import { parseQuery, recommend, writeRecommendationEvent } from "../../../lib/reco/engine";
import { runFoodBuddyAgent } from "../../../lib/agent/agent";
import { getLocationCoords, normalizeGeoLocation, type GeoLocation } from "../../../lib/location";
import { haversineMeters } from "../../../lib/reco/scoring";
import { getLLMSettings } from "../../../lib/settings/llm";
import { isAllowedModel } from "../../../lib/agent/model";
import { detectIntent, isSmallTalkMessage } from "../../../lib/chat/intent";
import { narratePlaces } from "../../../lib/chat/narratePlaces";
import {
  runSmallTalkLLM,
  SMALL_TALK_FOOD_LOCATION_PROMPT,
} from "../../../lib/chat/smallTalk";
import { loadSearchSession, upsertSearchSession } from "../../../lib/searchSession";
import {
  FOOD_PLACE_TYPE_FILTER,
  buildFoodSearchQuery,
  filterFoodPlaces,
} from "../../../lib/places/foodFilter";
import {
  PENDING_ACTION_RECOMMEND,
  resolveRecommendDecision,
} from "../../../lib/chat/recommendState";
import {
  clearPending,
  getOrCreateSession,
  setLastLocation,
  setPending,
} from "../../../lib/session/searchSession";
import { listMcpTools, mcpCall } from "../../../lib/mcp/client";
import { extractPlacesFromMcpResult } from "../../../lib/mcp/placesExtractor";
import { resolveMcpPayloadFromResult } from "../../../lib/mcp/resultParser";
import { resolveMcpTools, selectSearchTool } from "../../../lib/mcp/toolResolver";
import type { ToolDefinition } from "../../../lib/mcp/types";
import type {
  ChatResponse,
  RecommendationCardData,
} from "../../../lib/types/chat";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const defaultTimeoutMs = 12_000;
const extendedTimeoutMs = 25_000;
const locationPromptMessage =
  "Please share your GPS location or type your area/city (e.g., 'Hlaing, Yangon'). What area are you in?";

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

const pickFirstString = (...values: Array<unknown | undefined>) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
};

const extractLatLng = (payload: unknown): { lat?: number; lng?: number } => {
  if (!isRecord(payload)) {
    return {};
  }
  const record = payload;
  const lat = coerceNumber(record.lat ?? record.latitude ?? record.y);
  const lng = coerceNumber(record.lng ?? record.lon ?? record.longitude ?? record.x);
  if (lat !== undefined && lng !== undefined) {
    return { lat, lng };
  }
  const location = record.location ?? record.geometry;
  if (isRecord(location)) {
    return extractLatLng(location);
  }
  return {};
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

const cleanUserMessage = (input: string | null | undefined, fallback: string) =>
  sanitizeMessage(stripMcpLogs(input), fallback);

const buildNarratedMessage = async ({
  query,
  locationLabel,
  places,
  fallbackMessage,
  locale,
  requestId,
}: {
  query: string;
  locationLabel?: string;
  places: RecommendationCardData[];
  fallbackMessage: string;
  locale?: string | null;
  requestId: string;
}) => {
  if (places.length === 0) {
    return fallbackMessage;
  }
  try {
    const narrated = await narratePlaces({
      query,
      locationLabel,
      places,
      locale: locale ?? undefined,
      requestId,
    });
    return cleanUserMessage(narrated, fallbackMessage);
  } catch (err) {
    logger.warn({ err, requestId }, "Failed to narrate places");
    return fallbackMessage;
  }
};

const followUpIntentRegex = /show more|more options|next|another|refine/i;

const isFollowUpIntent = (body: ChatRequestBody) =>
  followUpIntentRegex.test(body.message);

const isFollowUpRequest = (body: ChatRequestBody) => {
  const normalized = body.message.trim().toLowerCase();
  return normalized === "show more options" || body.action === "more";
};

const getNextPageToken = (payload: unknown): string | undefined => {
  if (!isRecord(payload)) {
    return undefined;
  }
  const direct =
    (typeof payload.nextPageToken === "string" && payload.nextPageToken) ||
    (typeof payload.next_page_token === "string" && payload.next_page_token) ||
    (typeof payload.pageToken === "string" && payload.pageToken) ||
    (typeof payload.page_token === "string" && payload.page_token);
  if (direct) {
    return direct;
  }
  const data = payload.data;
  if (isRecord(data)) {
    return getNextPageToken(data);
  }
  return undefined;
};

const getSchemaProperties = (schema?: Record<string, unknown>): string[] => {
  if (!schema) {
    return [];
  }
  const properties = schema.properties;
  if (!isRecord(properties)) {
    return [];
  }
  return Object.keys(properties);
};

const matchSchemaKey = (schema: Record<string, unknown> | undefined, candidates: string[]) => {
  const keys = getSchemaProperties(schema);
  const lowerKeys = keys.map((key) => key.toLowerCase());
  for (const candidate of candidates) {
    const candidateLower = candidate.toLowerCase();
    const index = lowerKeys.findIndex((key) => key.includes(candidateLower));
    if (index >= 0) {
      return keys[index];
    }
  }
  return undefined;
};

const hasSchemaProperty = (schema: Record<string, unknown> | undefined, name: string) => {
  const keys = getSchemaProperties(schema);
  return keys.some((key) => key.toLowerCase() === name.toLowerCase());
};

const resolveKeywordSchemaKey = (schema: Record<string, unknown> | undefined) => {
  if (hasSchemaProperty(schema, "keyword")) {
    return "keyword";
  }
  if (hasSchemaProperty(schema, "query")) {
    return "query";
  }
  return matchSchemaKey(schema, ["textquery", "searchterm", "text", "search"]);
};

const normalizeMcpPlace = (
  payload: Record<string, unknown>,
  origin: { lat: number; lng: number },
): RecommendationCardData | null => {
  const displayName = isRecord(payload.displayName) ? payload.displayName : undefined;
  const displayNameText =
    typeof displayName?.text === "string" ? displayName.text : undefined;
  const placeName = typeof payload.name === "string" ? payload.name : undefined;
  const name = displayNameText ?? placeName;

  if (!name) {
    return null;
  }

  const address =
    typeof payload.formattedAddress === "string"
      ? payload.formattedAddress
      : typeof payload.shortFormattedAddress === "string"
        ? payload.shortFormattedAddress
        : undefined;
  const rating = typeof payload.rating === "number" ? payload.rating : undefined;
  const reviewCount =
    typeof payload.userRatingCount === "number" ? payload.userRatingCount : undefined;
  const location = isRecord(payload.location) ? payload.location : undefined;
  const lat = typeof location?.latitude === "number" ? location.latitude : undefined;
  const lng = typeof location?.longitude === "number" ? location.longitude : undefined;
  const mapsUrl =
    typeof payload.googleMapsUri === "string" ? payload.googleMapsUri : undefined;

  const distanceMeters =
    lat !== undefined && lng !== undefined
      ? haversineMeters(origin, { lat, lng })
      : undefined;
  const placeId =
    typeof payload.id === "string" ? payload.id : placeName ?? name;

  return {
    placeId,
    name,
    rating,
    reviewCount,
    lat,
    lng,
    distanceMeters,
    address,
    mapsUrl,
  };
};

const buildNearbySearchArgs = (
  tool: ToolDefinition,
  params: {
    lat: number;
    lng: number;
    radiusMeters: number;
    keyword?: string;
    nextPageToken?: string;
    maxResultCount?: number;
  },
) => {
  const schema = tool.inputSchema;
  const args: Record<string, unknown> = {};
  const latKey = matchSchemaKey(schema, ["lat", "latitude"]);
  const lngKey = matchSchemaKey(schema, ["lng", "lon", "longitude"]);
  const radiusKey = matchSchemaKey(schema, ["radius", "radius_m", "distance"]);
  const keywordKey = resolveKeywordSchemaKey(schema);
  const nextPageTokenKey = matchSchemaKey(schema, [
    "nextpagetoken",
    "next_page_token",
    "pagetoken",
    "page_token",
    "pageToken",
  ]);
  const maxResultsKey = matchSchemaKey(schema, ["maxresultcount", "maxresults", "limit"]);
  const fieldMaskKey = matchSchemaKey(schema, ["fieldmask", "field_mask", "fields"]);
  const includedTypesKey = matchSchemaKey(schema, [
    "includedtypes",
    "included_types",
    "includetypes",
  ]);

  if (hasSchemaProperty(schema, "location") && (!latKey || !lngKey)) {
    args.location = { lat: params.lat, lng: params.lng };
  } else {
    if (latKey) {
      args[latKey] = params.lat;
    }
    if (lngKey) {
      args[lngKey] = params.lng;
    }
  }

  if (radiusKey) {
    args[radiusKey] = params.radiusMeters;
  }

  const keywordValue =
    typeof params.keyword === "string" && params.keyword.trim().length > 0
      ? params.keyword.trim()
      : undefined;
  if (keywordKey && keywordValue) {
    args[keywordKey] = keywordValue;
  }

  if (includedTypesKey && !args[includedTypesKey]) {
    args[includedTypesKey] = FOOD_PLACE_TYPE_FILTER;
  }

  if (nextPageTokenKey && params.nextPageToken) {
    args[nextPageTokenKey] = params.nextPageToken;
  }

  if (maxResultsKey && params.maxResultCount) {
    args[maxResultsKey] = params.maxResultCount;
  }

  if (fieldMaskKey) {
    args[fieldMaskKey] =
      "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.googleMapsUri,places.types,places.primaryType,places.primaryTypeDisplayName,places.businessStatus";
  }

  return args;
};

const buildTextSearchArgs = (
  tool: ToolDefinition,
  params: {
    query: string;
    locationText?: string;
    location?: { lat: number; lng: number };
    nextPageToken?: string;
    maxResultCount?: number;
    radiusMeters?: number;
  },
) => {
  const schema = tool.inputSchema;
  const args: Record<string, unknown> = {};
  const queryKey = matchSchemaKey(schema, ["query", "text", "input", "search"]);
  const locationKey = matchSchemaKey(schema, ["location", "near", "bias"]);
  const latKey = matchSchemaKey(schema, ["lat", "latitude"]);
  const lngKey = matchSchemaKey(schema, ["lng", "lon", "longitude"]);
  const locationBiasKey = matchSchemaKey(schema, ["locationbias", "location_bias"]);
  const rankPreferenceKey = matchSchemaKey(schema, [
    "rankpreference",
    "rank_preference",
    "rankby",
    "rank_by",
  ]);
  const nextPageTokenKey = matchSchemaKey(schema, [
    "nextpagetoken",
    "next_page_token",
    "pagetoken",
    "page_token",
    "pageToken",
  ]);
  const maxResultsKey = matchSchemaKey(schema, ["maxresultcount", "maxresults", "limit"]);
  const fieldMaskKey = matchSchemaKey(schema, ["fieldmask", "field_mask", "fields"]);

  const supportsLocationBias =
    Boolean(locationBiasKey) ||
    Boolean(latKey) ||
    Boolean(lngKey) ||
    hasSchemaProperty(schema, "location");
  let queryValue = params.query;
  if (params.locationText) {
    queryValue = `${queryValue} in ${params.locationText}`;
  }
  if (params.location && !supportsLocationBias) {
    queryValue = `${queryValue} near ${params.location.lat},${params.location.lng}`;
  }

  if (queryKey) {
    args[queryKey] = queryValue;
  } else {
    args.query = queryValue;
  }

  if (params.location && (latKey || lngKey)) {
    if (latKey) {
      args[latKey] = params.location.lat;
    }
    if (lngKey) {
      args[lngKey] = params.location.lng;
    }
  } else if (params.location && hasSchemaProperty(schema, "location")) {
    args.location = { lat: params.location.lat, lng: params.location.lng };
  } else if (locationKey && params.locationText) {
    args[locationKey] = params.locationText;
  }

  if (params.location && typeof params.radiusMeters === "number" && locationBiasKey) {
    args[locationBiasKey] = {
      circle: {
        center: {
          latitude: params.location.lat,
          longitude: params.location.lng,
        },
        radius: params.radiusMeters,
      },
    };
  }

  if (rankPreferenceKey) {
    args[rankPreferenceKey] = rankPreferenceKey.toLowerCase().includes("rankby")
      ? "distance"
      : "DISTANCE";
  }

  if (nextPageTokenKey && params.nextPageToken) {
    args[nextPageTokenKey] = params.nextPageToken;
  }

  if (maxResultsKey && params.maxResultCount) {
    args[maxResultsKey] = params.maxResultCount;
  }

  if (fieldMaskKey) {
    args[fieldMaskKey] =
      "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.googleMapsUri,places.types,places.primaryType,places.primaryTypeDisplayName,places.businessStatus";
  }

  return args;
};

const buildGeocodeArgs = (tool: ToolDefinition, locationText: string) => {
  const schema = tool.inputSchema;
  const addressKey =
    matchSchemaKey(schema, ["address_query"]) ??
    matchSchemaKey(schema, ["address", "query", "text", "input"]) ??
    "address_query";
  return { [addressKey]: locationText };
};

const geocodeLocationText = async ({
  locationText,
  requestId,
}: {
  locationText: string;
  requestId: string;
}) => {
  const mcpUrl = (process.env.COMPOSIO_MCP_URL ?? "").trim().replace(/^"+|"+$/g, "");
  const composioApiKey = process.env.COMPOSIO_API_KEY ?? "";
  if (!mcpUrl) {
    return { coords: null, formattedAddress: null, error: "Missing MCP URL." };
  }

  const tools = await listMcpTools({
    url: mcpUrl,
    apiKey: composioApiKey,
    requestId,
  });
  const resolved = resolveMcpTools(tools);
  const directTool = tools.find(
    (tool) => tool.name.toLowerCase() === "google_maps_geocode_address_with_query",
  );
  const geocodeTool = directTool ?? resolved.geocode;
  if (!geocodeTool) {
    return { coords: null, formattedAddress: null, error: "No geocode tool found." };
  }

  const geocodePayload = await mcpCall<unknown>({
    url: mcpUrl,
    apiKey: composioApiKey,
    method: "tools/call",
    params: { name: geocodeTool.name, arguments: buildGeocodeArgs(geocodeTool, locationText) },
    requestId,
  });
  const { payload } = resolveMcpPayloadFromResult(geocodePayload);
  const coords = extractLatLng(payload ?? {});
  const formattedAddress =
    pickFirstString(
      (payload as { formatted_address?: string })?.formatted_address,
      (payload as { formattedAddress?: string })?.formattedAddress,
      (payload as { address?: string })?.address,
    ) ?? null;

  if (coords.lat === undefined || coords.lng === undefined) {
    return { coords: null, formattedAddress, error: "No coordinates returned." };
  }

  return { coords: { lat: coords.lat, lng: coords.lng }, formattedAddress, error: null };
};

const selectMcpSearchTool = (
  tools: ReturnType<typeof resolveMcpTools>,
  keyword: string,
): ToolDefinition | null => {
  const trimmedKeyword = keyword.trim();
  if (tools.nearbySearch) {
    const nearbyKeywordKey = resolveKeywordSchemaKey(tools.nearbySearch.inputSchema);
    if (nearbyKeywordKey || !trimmedKeyword) {
      return tools.nearbySearch;
    }
  }
  if (tools.textSearch) {
    return tools.textSearch;
  }
  return tools.nearbySearch ?? null;
};

const searchPlacesWithMcp = async ({
  keyword,
  coords,
  radiusMeters,
  requestId,
  locationText,
}: {
  keyword: string;
  coords: { lat: number; lng: number };
  radiusMeters: number;
  requestId: string;
  locationText?: string;
}) => {
  const mcpUrl = (process.env.COMPOSIO_MCP_URL ?? "").trim().replace(/^"+|"+$/g, "");
  const composioApiKey = process.env.COMPOSIO_API_KEY ?? "";
  if (!mcpUrl) {
    return {
      places: [],
      message: "Places search is temporarily unavailable.",
      nextPageToken: undefined,
    };
  }

  const tools = await listMcpTools({
    url: mcpUrl,
    apiKey: composioApiKey,
    requestId,
  });
  const resolvedTools = resolveMcpTools(tools);
  const normalizedKeyword = buildFoodSearchQuery(keyword);
  const selectedTool =
    selectMcpSearchTool(resolvedTools, normalizedKeyword) ??
    selectSearchTool(resolvedTools, { hasCoordinates: true }).tool;
  if (!selectedTool) {
    return {
      places: [],
      message: "Places search is temporarily unavailable.",
      nextPageToken: undefined,
    };
  }

  const queryBase = normalizedKeyword.trim().length > 0 ? normalizedKeyword.trim() : "restaurants";
  const textQuery = queryBase;

  const payload =
    selectedTool.name === resolvedTools.textSearch?.name
      ? await mcpCall<unknown>({
          url: mcpUrl,
          apiKey: composioApiKey,
          method: "tools/call",
          params: {
            name: selectedTool.name,
            arguments: buildTextSearchArgs(selectedTool, {
              query: textQuery,
              location: coords,
              radiusMeters,
              locationText,
            }),
          },
          requestId,
        })
      : await mcpCall<unknown>({
          url: mcpUrl,
          apiKey: composioApiKey,
          method: "tools/call",
          params: {
            name: selectedTool.name,
            arguments: buildNearbySearchArgs(selectedTool, {
              lat: coords.lat,
              lng: coords.lng,
              radiusMeters,
              keyword: queryBase,
            }),
          },
          requestId,
        });

  const { payload: parsedPayload } = resolveMcpPayloadFromResult(payload);
  const { places, successfull, error } = extractPlacesFromMcpResult(payload);
  if (successfull === false) {
    logger.warn({ requestId, error }, "MCP place search failed");
  }
  const filtered = filterFoodPlaces(places, queryBase);
  const normalized = filtered
    .map((place) => normalizeMcpPlace(place, coords))
    .filter((place): place is RecommendationCardData => Boolean(place));
  const nextPageToken = getNextPageToken(parsedPayload ?? payload);

  const message =
    normalized.length > 0
      ? "Here are a few places you might like."
      : "I couldn’t find food places for that. Try a different keyword (e.g., 'hotpot', 'noodle', 'dim sum').";

  return {
    places: normalized,
    message,
    nextPageToken,
  };
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
  const selectedTool =
    selectMcpSearchTool(resolvedTools, normalizedQuery) ??
    selectSearchTool(resolvedTools, { hasCoordinates: true }).tool;
  if (!selectedTool) {
    return {
      places: [],
      nextPageToken: session.nextPageToken ?? undefined,
      message: "No more results yet — try a new search.",
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
    payload = await callTool(
      selectedTool,
      buildTextSearchArgs(selectedTool, {
        query: normalizedQuery,
        location: { lat: session.lat, lng: session.lng },
        radiusMeters,
        nextPageToken,
        maxResultCount,
      }),
    );
  } else {
    payload = await callTool(
      selectedTool,
      buildNearbySearchArgs(selectedTool, {
        lat: session.lat,
        lng: session.lng,
        radiusMeters,
        keyword: normalizedQuery,
        nextPageToken,
        maxResultCount,
      }),
    );
  }

  const { payload: parsedPayload } = resolveMcpPayloadFromResult(payload);
  const { places, successfull, error } = extractPlacesFromMcpResult(payload);
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
}: {
  status: ChatResponse["status"];
  message: string;
  places: RecommendationCardData[];
  sessionId?: string;
  nextPageToken?: string;
}): ChatResponse => ({
  status,
  message,
  places,
  meta:
    sessionId || nextPageToken
      ? {
          sessionId,
          nextPageToken,
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
}: {
  agentMessage: string | null | undefined;
  recommendations: RecommendationCardData[];
  status?: LegacyChatStatus;
  requestId: string;
  errorMessage?: string;
  debugEnabled: boolean;
  toolDebug?: Record<string, unknown>;
  sessionId: string;
}): ChatResponse => {
  const hasRecommendations = recommendations.length > 0;
  const resolvedStatus = normalizeChatStatus(status ?? (hasRecommendations ? "OK" : "NO_RESULTS"));
  const baseMessage = hasRecommendations
    ? "Here are a few places you might like."
    : "Tell me a neighborhood or enable location so I can find nearby places.";
  const errorFallback = "Sorry, something went wrong while finding places.";
  const message = cleanUserMessage(
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

  const body = parseChatRequestBody(await request.json());

  if (!body) {
    return respondError(400, "Invalid request.");
  }

  const sessionId = body.sessionId ?? randomUUID();
  const timeoutMs = isFollowUpIntent(body) ? extendedTimeoutMs : defaultTimeoutMs;

  if (body.message.length > 500) {
    return respondError(400, "Message too long.", sessionId);
  }

  const userIdHash = hashUserId(body.anonId);
  const locationText = body.neighborhood ?? body.locationText;
  const geoLocation = normalizeGeoLocation({
    coordinates: body.location,
    latitude: body.latitude ?? undefined,
    longitude: body.longitude ?? undefined,
    locationText,
  });
  const coords = getLocationCoords(geoLocation);
  const hasCoordinates = Boolean(coords);
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
  const locale = request.headers.get("accept-language")?.split(",")[0];
  const radius_m =
    typeof body.radius_m === "number" && Number.isFinite(body.radius_m) && body.radius_m > 0
      ? body.radius_m
      : 1500;
  const radiusMeters = Math.round(radius_m);
  const radius_defaulted =
    locationEnabled &&
    hasCoordinates &&
    !(typeof body.radius_m === "number" && Number.isFinite(body.radius_m) && body.radius_m > 0);

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
    const fallbackMessage = "Hi! How can I help you today?";
    const smallTalkMessage = cleanUserMessage(
      await runSmallTalkLLM({
        userMessage: body.message,
        locale,
        requestId,
      }),
      fallbackMessage,
    );
    return respondChat(
      200,
      buildChatResponse({
        status: "ok",
        message: smallTalkMessage,
        places: [],
        sessionId,
      }),
    );
  }

  if (intent === "FOOD_INTENT") {
    if (!coords && !locationText) {
      await setPending(sessionId, {
        action: PENDING_ACTION_RECOMMEND,
        keyword: body.message,
      });
      const smallTalkMessage = cleanUserMessage(
        await runSmallTalkLLM({
          userMessage: body.message,
          locale,
          requestId,
        }),
        SMALL_TALK_FOOD_LOCATION_PROMPT,
      );
      return respondChat(
        200,
        buildChatResponse({
          status: "ok",
          message: smallTalkMessage,
          places: [],
          sessionId,
        }),
      );
    }

    if (!coords && locationText) {
      await setPending(sessionId, {
        action: PENDING_ACTION_RECOMMEND,
        keyword: body.message,
      });
      const geocodeResult = await geocodeLocationText({
        locationText,
        requestId,
      });
      if (!geocodeResult.coords) {
        return respondChat(
          200,
          buildChatResponse({
            status: "ok",
            message: `I couldn't find that location. ${locationPromptMessage}`,
            places: [],
            sessionId,
          }),
        );
      }

      const resolvedLocationLabel = geocodeResult.formattedAddress ?? locationText;

      await setLastLocation(sessionId, {
        lat: geocodeResult.coords.lat,
        lng: geocodeResult.coords.lng,
        radiusM: radiusMeters,
      });
      await clearPending(sessionId);

      const searchResult = await searchPlacesWithMcp({
        keyword: body.message,
        coords: geocodeResult.coords,
        radiusMeters,
        requestId,
        locationText: resolvedLocationLabel,
      });

      await upsertSearchSession({
        sessionId,
        channel,
        lastQuery: buildFoodSearchQuery(body.message),
        lastLat: geocodeResult.coords.lat,
        lastLng: geocodeResult.coords.lng,
        lastRadiusM: radiusMeters,
        nextPageToken: searchResult.nextPageToken ?? null,
      });

      const confirmMessage = `Got it — searching near ${resolvedLocationLabel}…`;
      const searchFallbackMessage =
        searchResult.places.length > 0
          ? "Here are a few places you might like."
          : "I couldn’t find food places for that. Try a different keyword (e.g., 'hotpot', 'noodle', 'dim sum').";
      const narratedMessage = await buildNarratedMessage({
        query: body.message,
        locationLabel: resolvedLocationLabel,
        places: searchResult.places,
        fallbackMessage: searchFallbackMessage,
        locale,
        requestId,
      });

      return respondChat(
        200,
        buildChatResponse({
          status: "ok",
          message: `${confirmMessage} ${narratedMessage}`,
          places: searchResult.places,
          sessionId,
          nextPageToken: searchResult.nextPageToken,
        }),
      );
    }

    if (coords) {
      await clearPending(sessionId);
      await setLastLocation(sessionId, {
        lat: coords.lat,
        lng: coords.lng,
        radiusM: radiusMeters,
      });

      const searchResult = await searchPlacesWithMcp({
        keyword: body.message,
        coords,
        radiusMeters,
        requestId,
      });

      await upsertSearchSession({
        sessionId,
        channel,
        lastQuery: buildFoodSearchQuery(body.message),
        lastLat: coords.lat,
        lastLng: coords.lng,
        lastRadiusM: radiusMeters,
        nextPageToken: searchResult.nextPageToken ?? null,
      });

      const searchFallbackMessage =
        searchResult.places.length > 0
          ? "Here are a few places you might like."
          : "I couldn’t find food places for that. Try a different keyword (e.g., 'hotpot', 'noodle', 'dim sum').";
      const narratedMessage = await buildNarratedMessage({
        query: body.message,
        locationLabel: locationText,
        places: searchResult.places,
        fallbackMessage: searchFallbackMessage,
        locale,
        requestId,
      });

      return respondChat(
        200,
        buildChatResponse({
          status: "ok",
          message: narratedMessage,
          places: searchResult.places,
          sessionId,
          nextPageToken: searchResult.nextPageToken,
        }),
      );
    }
  }

  if (isFollowUpRequest(body)) {
    const storedSession = body.sessionId ? await loadSearchSession(body.sessionId) : null;
    if (
      !storedSession ||
      storedSession.lastLat === null ||
      storedSession.lastLng === null ||
      !storedSession.lastQuery ||
      storedSession.lastRadiusM === null
    ) {
      return respondChat(
        200,
        buildChatResponse({
          status: "ok",
          message: "No more results yet — try a new search.",
          places: [],
          sessionId,
        }),
      );
    }

    const followUp = await fetchMoreFromMcp({
      session: {
        id: storedSession.sessionId,
        lastQuery: storedSession.lastQuery,
        lat: storedSession.lastLat,
        lng: storedSession.lastLng,
        radius: storedSession.lastRadiusM,
        nextPageToken: storedSession.nextPageToken,
      },
      requestId,
    });

    await upsertSearchSession({
      sessionId: storedSession.sessionId,
      lastQuery: storedSession.lastQuery,
      lastLat: storedSession.lastLat,
      lastLng: storedSession.lastLng,
      lastRadiusM: followUp.usedRadius ?? storedSession.lastRadiusM,
      nextPageToken: followUp.nextPageToken ?? null,
    });

    const followUpFallbackMessage =
      followUp.places.length > 0
        ? "Here are more places you might like."
        : "No more results yet — try a new search.";
    const followUpMessage = await buildNarratedMessage({
      query: storedSession.lastQuery,
      locationLabel: locationText,
      places: followUp.places,
      fallbackMessage: followUpFallbackMessage,
      locale,
      requestId,
    });

    return respondChat(
      200,
      buildChatResponse({
        status: "ok",
        message: followUpMessage,
        places: followUp.places,
        sessionId: storedSession.sessionId,
        nextPageToken: followUp.nextPageToken,
      }),
    );
  }

  const decision = resolveRecommendDecision({
    message: body.message,
    action: body.action,
    coords: coords ?? undefined,
    locationText,
    radiusM: radiusMeters,
    session: searchSession ?? undefined,
    allowSessionLocation: locationEnabled || Boolean(coords),
  });

  if (decision) {
    if (decision.action === "ask_location") {
      await setPending(sessionId, {
        action: PENDING_ACTION_RECOMMEND,
        keyword: decision.keyword,
      });
      return respondChat(
        200,
        buildChatResponse({
          status: "ok",
          message: locationPromptMessage,
          places: [],
          sessionId,
        }),
      );
    }

    if (decision.action === "geocode") {
      await setPending(sessionId, {
        action: PENDING_ACTION_RECOMMEND,
        keyword: decision.keyword,
      });
      const geocodeResult = await geocodeLocationText({
        locationText: decision.locationText,
        requestId,
      });
      if (!geocodeResult.coords) {
        return respondChat(
          200,
          buildChatResponse({
            status: "ok",
            message: `I couldn't find that location. ${locationPromptMessage}`,
            places: [],
            sessionId,
          }),
        );
      }

      const resolvedLocationLabel =
        geocodeResult.formattedAddress ?? decision.locationText;

      await setLastLocation(sessionId, {
        lat: geocodeResult.coords.lat,
        lng: geocodeResult.coords.lng,
        radiusM: radiusMeters,
      });
      await clearPending(sessionId);

      const searchResult = await searchPlacesWithMcp({
        keyword: decision.keyword,
        coords: geocodeResult.coords,
        radiusMeters,
        requestId,
        locationText: resolvedLocationLabel,
      });

      await upsertSearchSession({
        sessionId,
        channel,
        lastQuery: buildFoodSearchQuery(decision.keyword),
        lastLat: geocodeResult.coords.lat,
        lastLng: geocodeResult.coords.lng,
        lastRadiusM: radiusMeters,
        nextPageToken: searchResult.nextPageToken ?? null,
      });

      const confirmMessage = `Got it — searching near ${resolvedLocationLabel}…`;
      const searchFallbackMessage =
        searchResult.places.length > 0
          ? "Here are a few places you might like."
          : "I couldn’t find food places for that. Try a different keyword (e.g., 'hotpot', 'noodle', 'dim sum').";
      const searchMessage = await buildNarratedMessage({
        query: decision.keyword,
        locationLabel: resolvedLocationLabel,
        places: searchResult.places,
        fallbackMessage: searchFallbackMessage,
        locale,
        requestId,
      });
      return respondChat(
        200,
        buildChatResponse({
          status: "ok",
          message: `${confirmMessage} ${searchMessage}`,
          places: searchResult.places,
          sessionId,
          nextPageToken: searchResult.nextPageToken,
        }),
      );
    }

    const searchCoords = decision.coords;
    await clearPending(sessionId);
    await setLastLocation(sessionId, {
      lat: searchCoords.lat,
      lng: searchCoords.lng,
      radiusM: decision.radiusM,
    });

    const searchResult = await searchPlacesWithMcp({
      keyword: decision.keyword,
      coords: searchCoords,
      radiusMeters: decision.radiusM,
      requestId,
    });

    await upsertSearchSession({
      sessionId,
      channel,
      lastQuery: buildFoodSearchQuery(decision.keyword),
      lastLat: searchCoords.lat,
      lastLng: searchCoords.lng,
      lastRadiusM: decision.radiusM,
      nextPageToken: searchResult.nextPageToken ?? null,
    });

    const searchFallbackMessage =
      searchResult.places.length > 0
        ? "Here are a few places you might like."
        : "I couldn’t find food places for that. Try a different keyword (e.g., 'hotpot', 'noodle', 'dim sum').";

    return respondChat(
      200,
      buildChatResponse({
        status: "ok",
        message: await buildNarratedMessage({
          query: decision.keyword,
          locationLabel: locationText,
          places: searchResult.places,
          fallbackMessage: searchFallbackMessage,
          locale,
          requestId,
        }),
        places: searchResult.places,
        sessionId,
        nextPageToken: searchResult.nextPageToken,
      }),
    );
  }

  let settings: Awaited<ReturnType<typeof getLLMSettings>> | undefined;
  let llmTimedOut = false;
  try {
    settings = await getLLMSettings();

    const llmModel = settings.llmModel;
    const hasSystemPrompt =
      typeof settings.llmSystemPrompt === "string" &&
      settings.llmSystemPrompt.trim().length > 0;
    const agentEnabled = settings?.llmEnabled === true;
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
            location: geoLocation,
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

      if (agentResult) {
        const recommendations =
          agentResult.places && agentResult.places.length > 0
            ? agentResult.places
            : [agentResult.primary, ...(agentResult.alternatives ?? [])].filter(
                (item): item is RecommendationCardData => Boolean(item),
              );
        const resultCount = recommendations.length;
        const status = agentResult.status;
        const parsedConstraints = parseQuery(body.message);
        const rawResponseJson = truncateJson(
          JSON.stringify({
            assistant: agentResult.message,
            toolCallCount: agentResult.toolCallCount,
            parsedOutput: agentResult.parsedOutput,
            toolResponses: agentResult.rawResponse,
          }),
        );
        const toolInfo = buildToolDebug(
          isRecord(agentResult.toolDebug) ? agentResult.toolDebug : undefined,
        );
        if (toolInfo || agentResult.toolCallCount > 0) {
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
            toolCallCount: agentResult.toolCallCount,
            fallbackUsed: agentResult.fallbackUsed,
            rawResponseJson,
          },
          {
            status,
            latencyMs: Date.now() - agentStart,
            resultCount,
            recommendedPlaceIds: recommendations.map((item) => item.placeId),
            parsedConstraints: {
              ...parsedConstraints,
              llm: agentResult.parsedOutput ?? null,
            },
          },
        );

        logger.info(
          { ...logContext, latencyMs: Date.now() - agentStart },
          "Agent response complete",
        );

        if (coords) {
          const existingSession = await loadSearchSession(sessionId);
          await upsertSearchSession({
            sessionId,
            lastQuery: body.message,
            lastLat: coords.lat,
            lastLng: coords.lng,
            lastRadiusM: radiusMeters,
            nextPageToken: existingSession?.nextPageToken ?? null,
          });
        }

        return respondChat(
          200,
          buildAgentResponse({
            agentMessage: agentResult.message,
            recommendations,
            status,
            requestId,
            errorMessage: agentResult.errorMessage,
            debugEnabled,
            toolDebug: agentResult.toolDebug,
            sessionId,
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

  const agentEnabled = settings?.llmEnabled === true;
  const llmModel = settings?.llmModel ?? null;

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
      }),
    );
  }

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
      location: coords,
      queryText: body.message,
      radiusMetersOverride: radiusMeters,
      requestId,
    });

    const payload = buildRecommendationPayload(recommendation, coords);
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
      lastQuery: body.message,
      lastLat: coords.lat,
      lastLng: coords.lng,
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
      }),
    );
  } catch (fallbackError) {
    const errorMessage =
      fallbackError instanceof Error ? fallbackError.message : "Unknown error";
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
      }),
    );
  }
}

const truncateJson = (value: string, maxLength = 8000) =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

const roundCoord = (value: number) => Math.round(value * 100) / 100;
