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
import { isSmallTalkMessage } from "../../../lib/chat/intent";
import {
  extractSearchKeywordFallback,
  isGreeting,
  isTooVagueForSearch,
} from "../../../lib/chat/intentHeuristics";
import { normalizeMcpPlace } from "../../../lib/places/normalizeMcpPlace";
import { enrichPlaces } from "../../../lib/places/enrichPlaces";
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
import { rankMcpPlacesByRelevance } from "../../../lib/chat/relevanceRanker";
import { PENDING_ACTION_RECOMMEND } from "../../../lib/chat/recommendState";
import { geocodeLocationText } from "../../../lib/intent/geocode";
import { extractWithLLM } from "../../../lib/intent/llmExtractor";
import {
  normalizeRequestCoords,
  resolveSearchCoords,
  type SearchCoordsSource,
} from "../../../lib/chat/searchCoords";
import type { SessionPlace } from "../../../lib/chat/sessionMemory";
import { getSessionMemory, updateSessionMemory } from "../../../lib/chat/sessionMemory";
import { classifyIntent } from "../../../lib/chat/classifyIntent";
import { resolvePlaceReference } from "../../../lib/chat/resolvePlaceReference";
import {
  answerFromLastPlaces,
  isListQuestion,
} from "../../../lib/chat/listQna";
import { mergePrefs } from "../../../lib/chat/prefs";
import type { UserPrefs, UserPrefsUpdate } from "../../../lib/chat/types";
import { listMcpTools, mcpCall } from "../../../lib/mcp/client";
import { resolveMcpPayloadFromResult } from "../../../lib/mcp/resultParser";
import { resolveMcpTools } from "../../../lib/mcp/toolResolver";
import type { ToolDefinition } from "../../../lib/mcp/types";
import { buildFallbackNarration } from "../../../lib/narration/fallbackNarration";
import { narratePlacesWithLLM } from "../../../lib/narration/narratePlaces";
import { narrateSearchResults } from "../../../lib/narration/narrateSearchResults";
import { t } from "../../../lib/i18n";
import type {
  ChatResponse,
  RecommendationCardData,
} from "../../../lib/types/chat";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const defaultTimeoutMs = 12_000;
const extendedTimeoutMs = 25_000;
const allowRequestCoordsFallback =
  process.env.EXPLICIT_LOCATION_COORDS_FALLBACK !== "false";
const LOW_CONFIDENCE_THRESHOLD = 0.45;


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
  hasCoordinates?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isError = (value: unknown): value is Error => value instanceof Error;

const isAbortError = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

const isCoordsInMyanmar = (coords: { lat: number; lng: number }) =>
  coords.lat >= 9 && coords.lat <= 29 && coords.lng >= 92 && coords.lng <= 102;

const sanitizeCoords = (
  coords: { lat: number; lng: number } | null | undefined,
): { lat: number; lng: number } | null => {
  if (!coords) {
    return null;
  }
  const { lat, lng } = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  if (lat === 0 && lng === 0) {
    return null;
  }
  return coords;
};

const validateRequestCoords = (
  coords: { lat: number; lng: number } | null | undefined,
  {
    locationEnabled,
    enforceMyanmarBounds,
  }: { locationEnabled: boolean; enforceMyanmarBounds: boolean },
) => {
  if (!coords) {
    return { coords: null, valid: false, reason: "missing" };
  }
  const { lat, lng } = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { coords: null, valid: false, reason: "non_finite" };
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { coords: null, valid: false, reason: "out_of_range" };
  }
  if (lat === 0 && lng === 0) {
    return { coords: null, valid: false, reason: "zero_coords" };
  }
  if (locationEnabled && enforceMyanmarBounds && !isCoordsInMyanmar(coords)) {
    return { coords: null, valid: false, reason: "outside_myanmar_bounds" };
  }
  return { coords, valid: true, reason: "ok" };
};

const buildPlaceFollowUpMessage = ({
  name,
  rating,
  distanceMeters,
  types,
  mapsUrl,
}: {
  name: string;
  rating?: number;
  distanceMeters?: number;
  types?: string[];
  mapsUrl?: string;
}) => {
  const highlights: string[] = [];
  if (typeof rating === "number") {
    highlights.push(`${rating.toFixed(1)}★`);
  }
  if (typeof distanceMeters === "number") {
    highlights.push(`${Math.round(distanceMeters)}m away`);
  }
  if (types && types.length > 0) {
    highlights.push(types[0].replace(/_/g, " "));
  }
  const highlightText = highlights.length > 0 ? highlights.join(", ") : "a solid pick";
  const mapLine = mapsUrl ? ` Map: ${mapsUrl}` : "";
  return `I think you mean ${name}. It stood out as ${highlightText} in your last search. Want more spots like this?${mapLine}`;
};

const LOCATION_DENYLIST = new Set([
  "place",
  "places",
  "here",
  "nearby",
  "around",
  "my area",
  "area",
  "this area",
]);

const normalizeLocationToken = (value: string) =>
  value.toLowerCase().replace(/[.,]/g, "").trim();

const isGenericLocation = (value: string) =>
  LOCATION_DENYLIST.has(normalizeLocationToken(value));

const mapSessionPlaceToRecommendation = (place: SessionPlace) => ({
  placeId: place.placeId,
  name: place.name,
  rating: place.rating,
  reviewCount: place.reviews,
  address: place.address,
  lat: place.lat,
  lng: place.lng,
  distanceMeters: place.distanceMeters,
  mapsUrl: place.mapsUrl,
  types: place.types,
});

const toSessionPlaces = (places: RecommendationCardData[]) =>
  places.map((place) => ({
    placeId: place.placeId,
    name: place.name,
    rating: place.rating,
    reviews: place.reviewCount,
    address: place.address,
    lat: place.lat,
    lng: place.lng,
    distanceMeters: place.distanceMeters,
    mapsUrl: place.mapsUrl,
    types: place.types,
  }));


const applyLocalRefine = ({
  message,
  places,
  extracted,
}: {
  message: string;
  places: SessionPlace[];
  extracted: {
    budget?: "cheap" | "mid" | "high";
    vibe?: string;
    dietary?: string;
  };
}) => {
  const normalized = message.toLowerCase();
  const wantsCloser = /\b(closer|nearest|nearer)\b/.test(normalized);
  const wantsHigherRated = /\b(higher rated|better rated|top rated|best rated)\b/.test(
    normalized,
  );
  const budgetKeywords: Record<NonNullable<typeof extracted.budget>, string[]> = {
    cheap: ["cheap", "budget", "inexpensive", "affordable"],
    mid: ["mid", "moderate", "standard"],
    high: ["fine dining", "upscale", "premium", "expensive"],
  };
  const filterKeywords = [
    ...(extracted.budget ? budgetKeywords[extracted.budget] : []),
    ...(extracted.vibe ? [extracted.vibe] : []),
    ...(extracted.dietary ? [extracted.dietary] : []),
  ].map((keyword) => keyword.toLowerCase());

  let refined = places;
  if (filterKeywords.length > 0) {
    refined = refined.filter((place) => {
      const haystack = [
        place.name,
        place.address,
        ...(place.types ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return filterKeywords.some((keyword) => haystack.includes(keyword));
    });
  }

  if (wantsCloser) {
    refined = [...refined].sort((a, b) => {
      const distanceA = a.distanceMeters ?? Number.POSITIVE_INFINITY;
      const distanceB = b.distanceMeters ?? Number.POSITIVE_INFINITY;
      return distanceA - distanceB;
    });
  } else if (wantsHigherRated) {
    refined = [...refined].sort((a, b) => {
      const ratingA = a.rating ?? -1;
      const ratingB = b.rating ?? -1;
      return ratingB - ratingA;
    });
  }

  return refined;
};

const getPlaceMapsUrl = (place: { placeId?: string; mapsUrl?: string }) =>
  place.mapsUrl ??
  (place.placeId
    ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(
        place.placeId,
      )}`
    : undefined);

const extractPreferenceUpdates = (message: string): UserPrefsUpdate | null => {
  const normalized = message.toLowerCase();
  const cuisine: string[] = [];
  const vibe: string[] = [];
  const dietary: string[] = [];
  let budget: string | undefined;

  if (/\bspicy\b/.test(normalized)) {
    vibe.push("spicy");
  }
  if (/\bquiet\b/.test(normalized)) {
    vibe.push("quiet");
  }
  if (/\bhalal\b/.test(normalized)) {
    dietary.push("halal");
  }
  if (/\bvegetarian\b/.test(normalized)) {
    dietary.push("vegetarian");
  }
  if (/\bno pork\b/.test(normalized)) {
    dietary.push("no pork");
  }
  if (/\b(cheap|budget|low|affordable|inexpensive)\b/.test(normalized)) {
    budget = "cheap";
  }
  if (/\b(mid|midrange|moderate|normal|average)\b/.test(normalized)) {
    budget = budget ?? "mid";
  }
  if (/\b(high|expensive|pricey|premium|luxury|high-end|upscale)\b/.test(normalized)) {
    budget = "high";
  }

  const cues = [/i like\b/, /i prefer\b/, /i love\b/, /i want\b/];
  const hasCue = cues.some((cue) => cue.test(normalized));

  if (!hasCue && !budget && vibe.length === 0 && dietary.length === 0) {
    return null;
  }

  return {
    cuisine: cuisine.length > 0 ? cuisine : undefined,
    vibe: vibe.length > 0 ? vibe : undefined,
    dietary: dietary.length > 0 ? dietary : undefined,
    budget,
  };
};

const buildPlaceHighlights = ({
  place,
  query,
  prefs,
}: {
  place: RecommendationCardData;
  query: string;
  prefs?: UserPrefs;
}) => {
  const normalizedQuery = query.toLowerCase();
  const typeHints = (place.types ?? []).map((type) => type.toLowerCase());
  const keywordHints = [
    "noodles",
    "ramen",
    "sushi",
    "hotpot",
    "dim sum",
    "pizza",
    "burger",
    "bbq",
    "coffee",
    "tea",
    "dessert",
  ].filter((term) => normalizedQuery.includes(term));
  const typeMap: Array<{ match: RegExp; hint: string }> = [
    { match: /cafe|coffee/i, hint: "coffee" },
    { match: /bakery|dessert/i, hint: "pastries" },
    { match: /hotpot/i, hint: "hotpot" },
    { match: /sushi/i, hint: "sushi" },
    { match: /ramen|noodle/i, hint: "noodles" },
    { match: /bbq|barbecue/i, hint: "bbq" },
    { match: /bar/i, hint: "drinks" },
  ];
  const typeHint = typeMap.find((entry) =>
    typeHints.some((type) => entry.match.test(type)),
  )?.hint;
  const prefHint =
    prefs?.cuisine?.[0] ??
    prefs?.dietary?.[0] ??
    prefs?.vibe?.[0] ??
    undefined;

  const suggestion = keywordHints[0] ?? typeHint ?? prefHint;
  const tryLine = suggestion
    ? `People often go for ${suggestion} here—worth checking their popular dishes.`
    : "People often go for their popular dishes here—worth checking what's recommended.";

  const highlights: string[] = [];
  if (typeof place.rating === "number") {
    highlights.push(`${place.rating.toFixed(1)}★`);
  }
  if (typeof place.distanceMeters === "number") {
    highlights.push(`${Math.round(place.distanceMeters)}m away`);
  }
  const whyLine =
    highlights.length > 0
      ? `Stands out for ${highlights.join(", ")}.`
      : "Stood out in your last search.";

  return { whyLine, tryLine };
};

const addWhyTryLines = ({
  places,
  query,
  prefs,
}: {
  places: RecommendationCardData[];
  query: string;
  prefs?: UserPrefs;
}) =>
  places.map((place, index) => {
    if (index > 1) {
      return place;
    }
    const { whyLine, tryLine } = buildPlaceHighlights({ place, query, prefs });
    return { ...place, whyLine, tryLine };
  });

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
  const hasCoordinates =
    typeof payload.hasCoordinates === "boolean" ? payload.hasCoordinates : undefined;
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
    hasCoordinates,
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

const SINGLE_TOKEN_FOOD_TERMS = new Set([
  "bbq",
  "hotpot",
  "noodle",
  "noodles",
  "sushi",
  "ramen",
  "pizza",
  "burger",
]);

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

const extractSingleTokenFoodKeyword = (message: string | null | undefined) => {
  if (!message) {
    return undefined;
  }
  const trimmed = message.trim();
  if (!trimmed) {
    return undefined;
  }
  const tokens = trimmed.split(/\s+/);
  if (tokens.length !== 1) {
    return undefined;
  }
  const normalized = tokens[0].toLowerCase();
  return SINGLE_TOKEN_FOOD_TERMS.has(normalized) ? trimmed : undefined;
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
  const rankingResult = await rankMcpPlacesByRelevance({
    query: normalizedQuery,
    places,
    coords: { lat: session.lat, lng: session.lng },
    radiusMeters,
    requestId,
  });
  places = rankingResult.rankedPlaces;
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
  const filtered = filterFoodPlaces(places, normalizedQuery, {
    preserveOrder: rankingResult.usedRanker,
  });
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
    assistantMessage: rankingResult.assistantMessage,
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
  mode,
  suggestedPrompts,
  followups,
  isFollowUp,
  language,
  highlights,
  referencedPlaceIds,
  source,
  suppressIntro,
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
  mode?: ChatResponse["meta"]["mode"];
  suggestedPrompts?: ChatResponse["meta"]["suggestedPrompts"];
  followups?: ChatResponse["meta"]["followups"];
  isFollowUp?: boolean;
  language?: string;
  highlights?: ChatResponse["meta"]["highlights"];
  referencedPlaceIds?: ChatResponse["meta"]["referencedPlaceIds"];
  source?: ChatResponse["meta"]["source"];
  suppressIntro?: boolean;
}): ChatResponse => ({
  status,
  message: (() => {
    const sanitizedMessage = safeUserMessage(message, "");
    if (places.length > 0 && !suppressIntro) {
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
  meta: {
    mode:
      mode ??
      (needsLocation
        ? "needs_location"
        : isFollowUp
          ? "place_followup"
          : places.length === 0 && status === "ok"
            ? "refine"
            : "search"),
    suggestedPrompts:
      suggestedPrompts ??
      (places.length > 0 && !needsLocation
        ? ["cheap", "spicy", "family-friendly"]
        : undefined),
    followups,
    sessionId,
    nextPageToken,
    needs_location: needsLocation || undefined,
    language,
    highlights,
    referencedPlaceIds,
    source,
  },
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
  language,
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
  language?: string;
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
    language,
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
  const locationEnabled =
    body.hasCoordinates === false ? false : Boolean(body.locationEnabled);
  const rawReqCoords =
    body.hasCoordinates === false ? null : normalizeRequestCoords(rawBody);
  const reqCoordsCheck = validateRequestCoords(rawReqCoords, {
    locationEnabled,
    enforceMyanmarBounds: locationEnabled,
  });
  const reqCoords = reqCoordsCheck.coords;
  const roundedLat = reqCoords ? Math.round(reqCoords.lat * 1000) / 1000 : undefined;
  const roundedLng = reqCoords ? Math.round(reqCoords.lng * 1000) / 1000 : undefined;
  const geoLocation = normalizeGeoLocation({
    coordinates:
      reqCoords ??
      (body.hasCoordinates === false ? undefined : body.location),
    latitude: body.hasCoordinates === false ? undefined : body.latitude ?? undefined,
    longitude: body.hasCoordinates === false ? undefined : body.longitude ?? undefined,
    locationText: requestLocationText,
  });
  const rawGpsCoords = getLocationCoords(geoLocation);
  const gpsCoordsCheck = validateRequestCoords(rawGpsCoords ?? null, {
    locationEnabled,
    enforceMyanmarBounds: locationEnabled,
  });
  const gpsCoords = gpsCoordsCheck.coords;
  const coords = reqCoords ?? gpsCoords ?? null;
  const hasCoordinates = Boolean(coords);
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
      coordsValid: reqCoordsCheck.valid,
      coordsInvalidReason: reqCoordsCheck.valid ? undefined : reqCoordsCheck.reason,
      gpsCoordsValid: gpsCoordsCheck.valid,
      gpsCoordsInvalidReason: gpsCoordsCheck.valid ? undefined : gpsCoordsCheck.reason,
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

  const sessionMemory = sessionId ? getSessionMemory(sessionId) : null;
  const searchSession = await getOrCreateSession({ sessionId, channel });
  const hasPendingRecommend =
    searchSession?.pendingAction === PENDING_ACTION_RECOMMEND;
  const llmExtract = await extractWithLLM({
    message: body.message,
    locale: locale ?? undefined,
    hasDeviceCoords: Boolean(coords),
    lastPlacesCount: sessionMemory?.lastPlaces?.length ?? 0,
  });
  const responseLanguage = llmExtract.language;
  const locationPromptMessage = t("NEED_LOCATION", responseLanguage);
  const cravingPromptMessage = t("ASK_CRAVING", responseLanguage);
  const usedKeyword =
    llmExtract.keyword_en?.trim() || llmExtract.keyword?.trim() || null;
  const usedKeywordEn = Boolean(llmExtract.keyword_en?.trim());
  const keywordPreview = usedKeyword ? usedKeyword.slice(0, 60) : null;

  logger.info(
    {
      requestId,
      language: llmExtract.language,
      intent: llmExtract.intent,
      keywordPreview,
      location_text: llmExtract.location_text ?? null,
      confidence: llmExtract.confidence,
      usedKeywordEn,
    },
    "LLM extract",
  );

  const heuristicGreeting = isGreeting(body.message, responseLanguage);
  const heuristicTooVague = isTooVagueForSearch(body.message);
  const fallbackKeyword = extractSearchKeywordFallback(body.message);
  const shouldUseHeuristic =
    heuristicGreeting || heuristicTooVague || llmExtract.confidence < LOW_CONFIDENCE_THRESHOLD;
  const intentSource = shouldUseHeuristic ? "heuristic" : "llm";

  logger.info(
    {
      ...logContext,
      intentSource,
      heuristicGreeting: heuristicGreeting || undefined,
      heuristicTooVague: heuristicTooVague || undefined,
    },
    "Intent resolution",
  );

  const shouldHandleSmallTalk =
    llmExtract.intent === "smalltalk" &&
    !(hasPendingRecommend && !isSmallTalkMessage(body.message));

  const preferenceUpdate: UserPrefsUpdate | null = extractPreferenceUpdates(body.message);
  if (sessionId && (body.action === "set_pref" || preferenceUpdate)) {
    const nextPrefs: UserPrefs = mergePrefs(
      sessionMemory?.userPrefs,
      preferenceUpdate ?? {},
    );
    updateSessionMemory(sessionId, { userPrefs: nextPrefs });
    if (body.action === "set_pref" || llmExtract.intent === "smalltalk") {
      return respondChat(
        200,
        buildChatResponse({
          status: "ok",
          message: "Got it — I’ll keep that in mind for your next recommendations.",
          places: [],
          sessionId,
          userMessage: body.message,
          locationLabel: locationText,
          radiusMeters,
          mode: "smalltalk",
          language: responseLanguage,
        }),
      );
    }
  }

  if (heuristicGreeting) {
    const smallTalkMessage = `Hi! ${cravingPromptMessage}`;
    if (sessionId) {
      updateSessionMemory(sessionId, { lastIntent: "smalltalk" });
    }
    logger.info(
      {
        ...logContext,
        intentSource,
        no_mcp_call: true,
        skipReason: "greeting",
      },
      "Skipping MCP search for smalltalk",
    );
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
        mode: "smalltalk",
        language: responseLanguage,
        suggestedPrompts: ["hotpot", "noodles", "BBQ"],
        source: intentSource,
      }),
    );
  }

  if (shouldHandleSmallTalk) {
    const smallTalkMessage =
      "Hi! Tell me what you’re craving, or ask for a cuisine near a place (e.g., 'dim sum near Yangon').";
    if (sessionId) {
      updateSessionMemory(sessionId, { lastIntent: "smalltalk" });
    }
    logger.info(
      {
        ...logContext,
        intentSource,
        no_mcp_call: true,
        skipReason: "smalltalk",
      },
      "Skipping MCP search for smalltalk",
    );
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
        mode: "smalltalk",
        language: responseLanguage,
        suggestedPrompts: ["hotpot", "noodles", "BBQ"],
        source: intentSource,
      }),
    );
  }

  if (heuristicTooVague) {
    if (sessionId) {
      updateSessionMemory(sessionId, { lastIntent: "refine" });
    }
    logger.info(
      {
        ...logContext,
        intentSource,
        no_mcp_call: true,
        skipReason: "vague_keyword",
      },
      "Skipping MCP search for vague query",
    );
    return respondChat(
      200,
      buildChatResponse({
        status: "ok",
        message: cravingPromptMessage,
        places: [],
        sessionId,
        userMessage: body.message,
        locationLabel: locationText,
        radiusMeters,
        mode: "refine",
        language: responseLanguage,
        suggestedPrompts: ["hotpot", "noodles", "BBQ"],
        source: intentSource,
      }),
    );
  }
  const shouldResolvePlace =
    llmExtract.intent === "place_followup" || Boolean(llmExtract.place_name);
  if (shouldResolvePlace && sessionMemory?.lastPlaces?.length) {
    const placeQuery = llmExtract.place_name ?? body.message;
    const resolved = resolvePlaceReference(placeQuery, sessionMemory.lastPlaces);
    if (resolved && resolved.score >= 0.78) {
      const mapsUrl = getPlaceMapsUrl(resolved.place);
      const message = buildPlaceFollowUpMessage({
        name: resolved.place.name,
        rating: resolved.place.rating,
        distanceMeters: resolved.place.distanceMeters,
        types: resolved.place.types,
        mapsUrl,
      });
      const followupPlace = addWhyTryLines({
        places: [
          {
            placeId: resolved.place.placeId,
            name: resolved.place.name,
            rating: resolved.place.rating,
            reviewCount: resolved.place.reviews,
            address: resolved.place.address,
            lat: resolved.place.lat,
            lng: resolved.place.lng,
            distanceMeters: resolved.place.distanceMeters,
            mapsUrl,
            types: resolved.place.types,
          },
        ],
        query: sessionMemory?.lastQuery ?? body.message,
        prefs: sessionMemory?.userPrefs,
      })[0];
      if (sessionId) {
        updateSessionMemory(sessionId, { lastIntent: "place_followup" });
      }
      return respondChat(
        200,
        buildChatResponse({
          status: "ok",
          message,
          places: followupPlace ? [followupPlace] : [],
          sessionId,
          userMessage: body.message,
          locationLabel: locationText,
          radiusMeters,
          mode: "place_followup",
          language: responseLanguage,
        }),
      );
    }
  }

  const shouldHandleListQna = isListQuestion(body.message);
  if (shouldHandleListQna) {
    const listQnaResult = answerFromLastPlaces({
      message: body.message,
      lastPlaces: sessionMemory?.lastPlaces ?? [],
      userPrefs: sessionMemory?.userPrefs,
    });
    logger.info(
      {
        ...logContext,
        lastPlacesCount: sessionMemory?.lastPlaces?.length ?? 0,
        detectedIntent: listQnaResult.detectedIntent,
        no_mcp_call: true,
        mode: "list_qna",
      },
      "List Q&A answered from session places",
    );
    const responsePlaces = addWhyTryLines({
      places: (listQnaResult.rankedPlaces ?? sessionMemory?.lastPlaces ?? []).map(
        mapSessionPlaceToRecommendation,
      ),
      query: sessionMemory?.lastQuery ?? body.message,
      prefs: sessionMemory?.userPrefs,
    });
    if (sessionId) {
      updateSessionMemory(sessionId, { lastIntent: "list_qna" });
    }
    return respondChat(
      200,
      buildChatResponse({
        status: "ok",
        message: listQnaResult.summary,
        places: responsePlaces,
        sessionId,
        userMessage: body.message,
        locationLabel: locationText,
        radiusMeters,
        mode: "list_qna",
        language: responseLanguage,
        highlights: listQnaResult.highlights,
        referencedPlaceIds: listQnaResult.referencedPlaceIds,
        source: "session_last_places",
        suppressIntro: true,
      }),
    );
  }

  if (llmExtract.intent === "refine" && sessionMemory?.lastPlaces?.length) {
    const classifiedIntent = await classifyIntent(body.message, sessionMemory);
    const refinedPlaces = applyLocalRefine({
      message: body.message,
      places: sessionMemory.lastPlaces,
      extracted: {
        budget: classifiedIntent.extracted.budget,
        vibe: classifiedIntent.extracted.vibe,
        dietary: classifiedIntent.extracted.dietary,
      },
    });
    if (refinedPlaces.length >= 3) {
      const responsePlaces = addWhyTryLines({
        places: refinedPlaces.map(mapSessionPlaceToRecommendation),
        query: sessionMemory.lastQuery,
        prefs: sessionMemory.userPrefs,
      });
      const narratedMessage = await narrateSearchResults({
        userMessage: body.message,
        locationLabel: sessionMemory.lastResolvedLocation?.label ?? locationText,
        topPlaces: responsePlaces.slice(0, 3),
        userPrefs: sessionMemory.userPrefs,
        requestId,
        timeoutMs: narrationTimeoutMs,
      });
      if (sessionId) {
        updateSessionMemory(sessionId, {
          lastPlaces: refinedPlaces,
          lastQuery: sessionMemory.lastQuery,
          lastResolvedLocation: sessionMemory.lastResolvedLocation,
          lastIntent: "refine",
        });
      }
      return respondChat(
        200,
        buildChatResponse({
          status: "ok",
          message: narratedMessage,
          places: responsePlaces,
          sessionId,
          userMessage: body.message,
          locationLabel: sessionMemory.lastResolvedLocation?.label ?? locationText,
          radiusMeters,
          mode: "refine",
          language: responseLanguage,
        }),
      );
    }

    if (sessionMemory.lastResolvedLocation) {
      const refinedKeyword = buildFoodSearchQuery(
        [sessionMemory.lastQuery, body.message].filter(Boolean).join(" "),
      );
      const refinedRadius = searchSession?.lastRadiusM ?? radiusMeters;
      const searchResult = await searchPlacesWithMcp({
        keyword: refinedKeyword,
        coords: {
          lat: sessionMemory.lastResolvedLocation.lat,
          lng: sessionMemory.lastResolvedLocation.lng,
        },
        radiusMeters: refinedRadius,
        requestId,
        locationText: sessionMemory.lastResolvedLocation.label,
      });
      const withCoords = searchResult.places.filter(
        (place) => typeof place.lat === "number" && typeof place.lng === "number",
      );
      const enrichedPlaces = await enrichPlaces({
        places: withCoords,
        origin: {
          lat: sessionMemory.lastResolvedLocation.lat,
          lng: sessionMemory.lastResolvedLocation.lng,
        },
      });
      const refinedPlaces = addWhyTryLines({
        places: enrichedPlaces,
        query: refinedKeyword,
        prefs: sessionMemory.userPrefs,
      });
      const refinedMessage = await narrateSearchResults({
        userMessage: body.message,
        locationLabel: sessionMemory.lastResolvedLocation.label,
        topPlaces: refinedPlaces.slice(0, 3),
        userPrefs: sessionMemory.userPrefs,
        requestId,
        timeoutMs: narrationTimeoutMs,
      });
      if (sessionId) {
        updateSessionMemory(sessionId, {
          lastPlaces: toSessionPlaces(searchResult.places),
          lastQuery: refinedKeyword,
          lastResolvedLocation: sessionMemory.lastResolvedLocation,
          lastIntent: "refine",
        });
      }
      return respondChat(
        200,
        buildChatResponse({
          status: "ok",
          message: refinedMessage,
          places: refinedPlaces,
          sessionId,
          nextPageToken: searchResult.nextPageToken,
          userMessage: body.message,
          locationLabel: sessionMemory.lastResolvedLocation.label,
          radiusMeters: refinedRadius,
          mode: "refine",
          language: responseLanguage,
        }),
      );
    }
  }

  if (isFollowUpRequest(body)) {
    const storedSession = body.sessionId
      ? await getFollowUpSession(body.sessionId)
      : null;
    if (!storedSession) {
      if (sessionId) {
        updateSessionMemory(sessionId, { lastIntent: "place_followup" });
      }
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
          isFollowUp: true,
          language: responseLanguage,
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
    const withCoords = followUp.places.filter(
      (place) => typeof place.lat === "number" && typeof place.lng === "number",
    );
    const enrichedFollowUps = await enrichPlaces({
      places: withCoords,
      origin: { lat: storedSession.lat, lng: storedSession.lng },
    });
    const followUpMessage = followUp.assistantMessage
      ? safeUserMessage(followUp.assistantMessage, followUpFallbackMessage)
      : await buildNarratedMessage({
          query: storedSession.lastQuery,
          userMessage: body.message,
          locationLabel: locationText,
          places: enrichedFollowUps,
          locale,
          requestId,
          timeoutMs: narrationTimeoutMs,
          fallbackMessage: followUpFallbackMessage,
        });
    const annotatedFollowUps = addWhyTryLines({
      places: enrichedFollowUps,
      query: storedSession.lastQuery,
      prefs: sessionMemory?.userPrefs,
    });

    if (sessionId) {
      updateSessionMemory(sessionId, {
        lastPlaces: toSessionPlaces(annotatedFollowUps),
        lastQuery: storedSession.lastQuery,
        lastResolvedLocation: {
          lat: storedSession.lat,
          lng: storedSession.lng,
          label: locationText ?? "Current location",
        },
        lastIntent: "place_followup",
      });
    }

    return respondChat(
      200,
      buildChatResponse({
        status: "ok",
        message: followUpMessage,
        places: annotatedFollowUps,
        sessionId: storedSession.id,
        nextPageToken: followUp.nextPageToken,
        userMessage: body.message,
        locationLabel: locationText,
        radiusMeters: followUp.usedRadius ?? storedSession.radius,
        isFollowUp: true,
        language: responseLanguage,
      }),
    );
  }

  const countryHint = request.headers.get("x-country");

  const pendingKeyword =
    searchSession?.pendingAction === PENDING_ACTION_RECOMMEND
      ? searchSession.pendingKeyword ?? undefined
      : undefined;
  const singleTokenFoodKeyword = extractSingleTokenFoodKeyword(body.message);
  const keyword =
    usedKeyword ??
    (pendingKeyword && pendingKeyword.trim().length > 0 ? pendingKeyword : null) ??
    singleTokenFoodKeyword ??
    fallbackKeyword ??
    extractCuisineKeyword(body.message) ??
    null;
  if (!keyword) {
    if (sessionId) {
      updateSessionMemory(sessionId, { lastIntent: "refine" });
    }
    return respondChat(
      200,
      buildChatResponse({
        status: "ok",
        message: cravingPromptMessage,
        places: [],
        sessionId,
        userMessage: body.message,
        locationLabel: locationText,
        radiusMeters,
        needsLocation: false,
        language: responseLanguage,
      }),
    );
  }

  const keywordMeaningful =
    keyword.trim().length >= 3 &&
    !isGreeting(keyword) &&
    !isTooVagueForSearch(keyword);

  if (!keywordMeaningful) {
    if (sessionId) {
      updateSessionMemory(sessionId, { lastIntent: "refine" });
    }
    logger.info(
      {
        ...logContext,
        intentSource,
        no_mcp_call: true,
        skipReason: "keyword_not_meaningful",
        keywordPreview: keyword.slice(0, 40),
      },
      "Skipping MCP search for non-meaningful keyword",
    );
    return respondChat(
      200,
      buildChatResponse({
        status: "ok",
        message: cravingPromptMessage,
        places: [],
        sessionId,
        userMessage: body.message,
        locationLabel: locationText,
        radiusMeters,
        needsLocation: false,
        language: responseLanguage,
        suggestedPrompts: ["hotpot", "noodles", "BBQ"],
        source: intentSource,
      }),
    );
  }

  const parsedRadius =
    typeof llmExtract.radius_m === "number" &&
    Number.isFinite(llmExtract.radius_m) &&
    llmExtract.radius_m > 0
      ? Math.round(llmExtract.radius_m)
      : radiusMeters;
  const explicitLocationTextCandidate = llmExtract.location_text?.trim();
  const explicitLocationText =
    explicitLocationTextCandidate && !isGenericLocation(explicitLocationTextCandidate)
      ? explicitLocationTextCandidate
      : undefined;
  const explicitLocationPresent = Boolean(explicitLocationText);

  if (!explicitLocationPresent && !coords) {
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
    if (sessionId) {
      updateSessionMemory(sessionId, {
        lastQuery: buildFoodSearchQuery(keyword),
        lastResolvedLocation: null,
        lastIntent: "refine",
      });
    }
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
        language: responseLanguage,
      }),
    );
  }

  let searchCoords: { lat: number; lng: number } | null = null;
  let resolvedLocationLabel: string | undefined = locationText ?? undefined;
  let searchLocationText: string | undefined;
  let confirmMessage: string | undefined;
  let coordsSource: SearchCoordsSource = "none";

  if (!coords && explicitLocationText) {
    await setPending(sessionId, {
      action: PENDING_ACTION_RECOMMEND,
      keyword,
    });
  }

  const resolvedSearchCoords = await resolveSearchCoords({
    reqCoords: coords,
    locationText: explicitLocationText,
    requestId,
    locale,
    countryHint,
    coords,
    geocode: geocodeLocationText,
  });

  if (resolvedSearchCoords.geocodeFailed) {
    if (coords && allowRequestCoordsFallback) {
      logger.warn(
        { requestId, keyword },
        "Geocode failed; falling back to request coords",
      );
      searchCoords = coords;
      coordsSource = "request_coords";
    } else {
      if (sessionId) {
        updateSessionMemory(sessionId, {
          lastQuery: buildFoodSearchQuery(keyword),
          lastResolvedLocation: null,
          lastIntent: "refine",
        });
      }
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
        language: responseLanguage,
      }),
    );
    }
  } else {
    const sanitized = sanitizeCoords(resolvedSearchCoords.searchCoords);
    if (!sanitized && resolvedSearchCoords.searchCoords) {
      logger.warn(
        {
          ...logContext,
          coordsSource: resolvedSearchCoords.coordsSource,
        },
        "Ignoring invalid search coords",
      );
    }
    searchCoords = sanitized;
    coordsSource = sanitized ? resolvedSearchCoords.coordsSource : "none";
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
    if (sessionId) {
      updateSessionMemory(sessionId, {
        lastQuery: buildFoodSearchQuery(keyword),
        lastResolvedLocation: null,
        lastIntent: "refine",
      });
    }
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
        language: responseLanguage,
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

  const sessionPrefs = sessionId ? getSessionMemory(sessionId)?.userPrefs : undefined;
  const withCoords = searchResult.places.filter(
    (place) => typeof place.lat === "number" && typeof place.lng === "number",
  );
  const enrichedPlaces = await enrichPlaces({
    places: withCoords,
    origin: searchCoords,
  });
  const annotatedPlaces = addWhyTryLines({
    places: enrichedPlaces,
    query: keyword,
    prefs: sessionPrefs,
  });
  const narratedMessage = await narrateSearchResults({
    userMessage: body.message,
    locationLabel: resolvedLocationLabel ?? searchLocationText ?? locationText,
    topPlaces: annotatedPlaces.slice(0, 3),
    userPrefs: sessionPrefs,
    requestId,
    timeoutMs: narrationTimeoutMs,
  });

  if (sessionId) {
    updateSessionMemory(sessionId, {
      lastPlaces: toSessionPlaces(annotatedPlaces),
      lastQuery: buildFoodSearchQuery(keyword),
      lastResolvedLocation: {
        lat: searchCoords.lat,
        lng: searchCoords.lng,
        label: resolvedLocationLabel ?? searchLocationText ?? locationText ?? "Current location",
      },
      lastIntent: searchResult.places.length > 0 ? "search" : "refine",
    });
  }

  return respondChat(
    200,
    buildChatResponse({
      status: "ok",
      message: confirmMessage ? `${confirmMessage} ${narratedMessage}` : narratedMessage,
      places: annotatedPlaces,
      sessionId,
      nextPageToken: searchResult.nextPageToken,
      userMessage: body.message,
      locationLabel: resolvedLocationLabel,
      radiusMeters: parsedRadius,
      language: responseLanguage,
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
            language: responseLanguage,
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
            language: responseLanguage,
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
        language: responseLanguage,
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
    const withCoords = payload.filter(
      (place) => typeof place.lat === "number" && typeof place.lng === "number",
    );
    payload = await enrichPlaces({
      places: withCoords,
      origin: resolvedCoords,
    });
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
        language: responseLanguage,
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
        language: responseLanguage,
      }),
    );
  }
}

const truncateJson = (value: string, maxLength = 8000) =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

const roundCoord = (value: number) => Math.round(value * 100) / 100;
