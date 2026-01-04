import { logger } from "../logger";
import {
  buildFoodIncludedTypes,
  buildFoodSearchQuery,
  buildFoodTextSearchQuery,
  filterFoodPlaces,
  hasExplicitLocationPhrase,
  normalizeIncludedTypes,
} from "../places/foodFilter";
import { filterByMaxDistance } from "../geo/safetyNet";
import { haversineMeters } from "../reco/scoring";
import { listMcpTools, mcpCall } from "../mcp/client";
import { extractPlacesFromMcpResult } from "../mcp/placesExtractor";
import { resolveMcpPayloadFromResult } from "../mcp/resultParser";
import { resolveMcpTools } from "../mcp/toolResolver";
import { normalizeMcpPlace } from "../places/normalizeMcpPlace";
import {
  rankMcpPlacesByRelevance,
  type RelevanceRankerDeps,
} from "./relevanceRanker";
import type { ToolDefinition } from "../mcp/types";
import type { RecommendationCardData } from "../types/chat";

export type McpPlacesExtractor = typeof extractPlacesFromMcpResult;

let extractPlacesFromMcpImpl: McpPlacesExtractor = extractPlacesFromMcpResult;

export const extractPlacesFromMcp = (payload: unknown) =>
  extractPlacesFromMcpImpl(payload);

export const setExtractPlacesFromMcpResult = (extractor: McpPlacesExtractor) => {
  extractPlacesFromMcpImpl = extractor;
};

export const resetExtractPlacesFromMcpResult = () => {
  extractPlacesFromMcpImpl = extractPlacesFromMcpResult;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

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

const INVALID_INCLUDED_TYPES_ERROR = "invalid place type(s) for includedtypes";

const resolveStatusCodeFromRecord = (record: Record<string, unknown>): number | undefined => {
  const statusKeys = new Set(["statuscode", "status_code", "status", "code"]);
  for (const [key, value] of Object.entries(record)) {
    if (statusKeys.has(key.toLowerCase())) {
      const parsed = coerceNumber(value);
      if (parsed !== undefined) {
        return parsed;
      }
    }
  }
  return undefined;
};

const extractStatusCode = (payload: unknown): number | undefined => {
  if (!isRecord(payload)) {
    return undefined;
  }
  const direct = resolveStatusCodeFromRecord(payload);
  if (direct !== undefined) {
    return direct;
  }
  if (isRecord(payload.error)) {
    const nested = resolveStatusCodeFromRecord(payload.error);
    if (nested !== undefined) {
      return nested;
    }
  }
  if (isRecord(payload.response)) {
    const nested = resolveStatusCodeFromRecord(payload.response);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
};

const hasIncludedTypesError = (error?: string) =>
  error?.toLowerCase().includes(INVALID_INCLUDED_TYPES_ERROR) ?? false;

export const formatErrorSnippet = (error?: string) => {
  if (!error) {
    return undefined;
  }
  const trimmed = error.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 120) : undefined;
};

export const shouldRetryWithTextSearch = ({
  successfull,
  error,
  payload,
  isNearbySearch,
  retriedWithTextSearch,
  hasTextSearchTool,
}: {
  successfull: boolean | undefined;
  error: string | undefined;
  payload: unknown;
  isNearbySearch: boolean;
  retriedWithTextSearch: boolean;
  hasTextSearchTool: boolean;
}) => {
  if (retriedWithTextSearch || successfull !== false) {
    return false;
  }
  if (!isNearbySearch || !hasTextSearchTool) {
    return false;
  }
  if (hasIncludedTypesError(error)) {
    return true;
  }
  return extractStatusCode(payload) === 400;
};

export const getNextPageToken = (payload: unknown): string | undefined => {
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

export const matchSchemaKey = (
  schema: Record<string, unknown> | undefined,
  candidates: string[],
) => {
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

export const buildNearbySearchArgs = (
  tool: ToolDefinition,
  params: {
    lat: number;
    lng: number;
    radiusMeters: number;
    keyword?: string;
    nextPageToken?: string;
    maxResultCount?: number;
    includedTypesOverride?: string[];
  },
): { args: Record<string, unknown>; includedTypes?: string[] | string } => {
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
  const excludedTypesKey = matchSchemaKey(schema, [
    "excludedtypes",
    "excluded_types",
    "excludetypes",
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

  const normalizedIncludedTypesOverride = normalizeIncludedTypes(params.includedTypesOverride);
  const fallbackIncludedTypes = normalizedIncludedTypesOverride ?? buildFoodIncludedTypes(params.keyword);
  if (includedTypesKey && fallbackIncludedTypes && !args[includedTypesKey]) {
    args[includedTypesKey] = fallbackIncludedTypes;
  }

  if (excludedTypesKey && !args[excludedTypesKey]) {
    args[excludedTypesKey] = ["store", "lodging", "school", "shopping_mall"];
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

  const includedTypes = includedTypesKey ? (args[includedTypesKey] as string[] | string) : undefined;
  return { args, includedTypes };
};

export const buildTextSearchArgs = (
  tool: ToolDefinition,
  params: {
    query: string;
    queryOverride?: string;
    locationText?: string;
    location?: { lat: number; lng: number };
    nextPageToken?: string;
    maxResultCount?: number;
    radiusMeters?: number;
    includedTypesOverride?: string[];
  },
): { args: Record<string, unknown>; query: string; includedTypes?: string[] | string } => {
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
  const includedTypesKey = matchSchemaKey(schema, [
    "includedtypes",
    "included_types",
    "includetypes",
  ]);

  const supportsLocationBias =
    Boolean(locationBiasKey) ||
    Boolean(latKey) ||
    Boolean(lngKey) ||
    hasSchemaProperty(schema, "location");
  const queryValue =
    params.queryOverride ??
    buildFoodTextSearchQuery({
      keyword: params.query,
      locationText: params.locationText,
      coords: params.location,
    });

  if (queryKey) {
    args[queryKey] = queryValue;
  } else {
    args.query = queryValue;
  }

  const normalizedIncludedTypesOverride = normalizeIncludedTypes(params.includedTypesOverride);
  const fallbackIncludedTypes = normalizedIncludedTypesOverride ?? buildFoodIncludedTypes(params.query);
  if (includedTypesKey && fallbackIncludedTypes) {
    args[includedTypesKey] = fallbackIncludedTypes;
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

  const includedTypes = includedTypesKey ? (args[includedTypesKey] as string[] | string) : undefined;
  return { args, query: queryValue, includedTypes };
};

const formatRadiusLabel = (radiusMeters: number) => {
  if (radiusMeters >= 1000) {
    const kilometers = (radiusMeters / 1000).toFixed(1).replace(/\.0$/, "");
    return `${kilometers} km`;
  }
  return `${radiusMeters} m`;
};

type McpPlacesSearchResult = {
  places: RecommendationCardData[];
  message: string;
  nextPageToken?: string;
  assistantMessage?: string;
};

export const searchPlacesWithMcp = async ({
  keyword,
  coords,
  radiusMeters,
  requestId,
  locationText,
  distanceRetryAttempted = false,
  forceNearbySearch = false,
  placeTypes,
  relevanceRankerDeps,
}: {
  keyword: string;
  coords: { lat: number; lng: number };
  radiusMeters: number;
  requestId: string;
  locationText?: string;
  distanceRetryAttempted?: boolean;
  forceNearbySearch?: boolean;
  placeTypes?: string[];
  relevanceRankerDeps?: RelevanceRankerDeps;
}): Promise<McpPlacesSearchResult> => {
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
  const intentKeyword = keyword.trim().length > 0 ? keyword.trim() : "restaurant";
  const preferTextSearch =
    !forceNearbySearch && (Boolean(locationText) || hasExplicitLocationPhrase(keyword));
  const selectedTool = preferTextSearch
    ? resolvedTools.textSearch ?? resolvedTools.nearbySearch
    : resolvedTools.nearbySearch ?? resolvedTools.textSearch;
  if (coords && !selectedTool) {
    return {
      places: [],
      message: "Places search is temporarily unavailable.",
      nextPageToken: undefined,
    };
  }
  if (!selectedTool) {
    return {
      places: [],
      message: "Places search is temporarily unavailable.",
      nextPageToken: undefined,
    };
  }

  const queryBase = normalizedKeyword.trim().length > 0 ? normalizedKeyword.trim() : "restaurants";
  const maxResultCount = 12;
  let retriedWithTextSearch = false;

  const payload =
    selectedTool.name === resolvedTools.textSearch?.name
      ? await mcpCall<unknown>({
          url: mcpUrl,
          apiKey: composioApiKey,
          method: "tools/call",
          params: {
            name: selectedTool.name,
            arguments: (() => {
              const { args, query, includedTypes } = buildTextSearchArgs(selectedTool, {
                query: intentKeyword,
                location: coords,
                radiusMeters,
                locationText,
                maxResultCount,
                includedTypesOverride: placeTypes,
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
              return args;
            })(),
          },
          requestId,
        })
      : await mcpCall<unknown>({
          url: mcpUrl,
          apiKey: composioApiKey,
          method: "tools/call",
          params: {
            name: selectedTool.name,
            arguments: (() => {
              const { args, includedTypes } = buildNearbySearchArgs(selectedTool, {
                lat: coords.lat,
                lng: coords.lng,
                radiusMeters,
                keyword: queryBase,
                maxResultCount,
                includedTypesOverride: placeTypes,
              });
              logger.info(
                {
                  requestId,
                  selectedToolName: selectedTool.name,
                  usedMode: "nearby",
                  keyword: queryBase,
                  includedTypes,
                  radiusMeters,
                },
                "MCP search request",
              );
              return args;
            })(),
          },
          requestId,
        });

  let { payload: parsedPayload } = resolveMcpPayloadFromResult(payload);
  let { places, successfull, error } = extractPlacesFromMcp(payload);
  const rankingResult = await rankMcpPlacesByRelevance(
    {
      query: queryBase,
      places,
      coords,
      locationText,
      radiusMeters,
      requestId,
    },
    relevanceRankerDeps,
  );
  places = rankingResult.rankedPlaces;
  const isNearbySearch = selectedTool.name === resolvedTools.nearbySearch?.name;
  const hasTextSearchTool = Boolean(resolvedTools.textSearch);
  let usedFallback = false;

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
      "MCP nearby search failed; retrying with text search",
    );

    const fallbackTool = resolvedTools.textSearch;
    if (fallbackTool) {
      const fallbackKeyword =
        keyword.trim().length > 0 ? keyword.trim() : "restaurant";
      const fallbackPayload = await mcpCall<unknown>({
        url: mcpUrl,
        apiKey: composioApiKey,
        method: "tools/call",
        params: {
          name: fallbackTool.name,
          arguments: (() => {
            const { args, query, includedTypes } = buildTextSearchArgs(fallbackTool, {
              query: fallbackKeyword,
              location: coords,
              locationText,
              radiusMeters,
              maxResultCount,
              includedTypesOverride: placeTypes,
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
        },
        requestId,
      });

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
    logger.warn({ requestId, error }, "MCP place search failed");
  }
  const filtered = filterFoodPlaces(places, queryBase, {
    preserveOrder: rankingResult.usedRanker,
  });
  let normalized = filtered
    .map((place) => normalizeMcpPlace(place, coords))
    .filter((place): place is RecommendationCardData => Boolean(place));
  const applyDistanceSafetyNet = (
    items: RecommendationCardData[],
    retryModeUsed?: string | null,
  ) => {
    const maxDistanceMeters = Math.max(radiusMeters * 4, 8_000);
    const candidateDistances = items.slice(0, 3).map((place) => {
      if (typeof place.lat !== "number" || typeof place.lng !== "number") {
        return null;
      }
      return Math.round(haversineMeters(coords, { lat: place.lat, lng: place.lng }));
    });
    const result = filterByMaxDistance(
      coords,
      items,
      (place) =>
        typeof place.lat === "number" && typeof place.lng === "number"
          ? { lat: place.lat, lng: place.lng }
          : null,
      maxDistanceMeters,
    );
    logger.info(
      {
        requestId,
        originLat: coords.lat,
        originLng: coords.lng,
        radiusMeters,
        maxDistanceMeters,
        candidateDistances,
        droppedCount: result.droppedCount,
        retryModeUsed: retryModeUsed ?? null,
        maxKeptDistance: result.maxKeptDistance,
      },
      "Applied MCP distance safety net",
    );
    return result;
  };

  const initialSafety = applyDistanceSafetyNet(normalized);
  const hadPlacesBeforeSafety = normalized.length > 0;
  normalized = initialSafety.kept;

  if (!distanceRetryAttempted && hadPlacesBeforeSafety && normalized.length === 0) {
    const expandedRadius = Math.min(radiusMeters * 3, 8_000);
    if (expandedRadius > radiusMeters) {
      const retryResult = await searchPlacesWithMcp({
        keyword,
        coords,
        radiusMeters: expandedRadius,
        requestId,
        locationText,
        distanceRetryAttempted: true,
        forceNearbySearch,
        placeTypes,
        relevanceRankerDeps,
      });
      const retryMessage = locationText
        ? `I found places, but they seem far from ${locationText}. I’ll retry with a wider radius.`
        : "I found places, but they seem far from that spot. I’ll retry with a wider radius.";
      return {
        ...retryResult,
        message: retryResult.message
          ? `${retryMessage} ${retryResult.message}`.trim()
          : retryMessage,
      };
    }
  }

  let usedDistanceFallback = false;
  if (
    locationText &&
    hadPlacesBeforeSafety &&
    normalized.length === 0 &&
    resolvedTools.textSearch
  ) {
    usedDistanceFallback = true;
    const fallbackQuery = `${intentKeyword} in ${locationText}`;
    const fallbackTool = resolvedTools.textSearch;
    const fallbackPayload = await mcpCall<unknown>({
      url: mcpUrl,
      apiKey: composioApiKey,
      method: "tools/call",
      params: {
        name: fallbackTool.name,
        arguments: (() => {
          const { args, query, includedTypes } = buildTextSearchArgs(fallbackTool, {
            query: intentKeyword,
            queryOverride: fallbackQuery,
            location: coords,
            locationText,
            radiusMeters,
            maxResultCount,
            includedTypesOverride: placeTypes,
          });
          logger.info(
            {
              requestId,
              selectedToolName: fallbackTool.name,
              usedMode: "text",
              query,
              includedTypes,
              radiusMeters,
              fallback: "distance_safety_net",
            },
            "MCP search request",
          );
          return args;
        })(),
      },
      requestId,
    });

    const fallbackParsed = resolveMcpPayloadFromResult(fallbackPayload);
    const fallbackResult = extractPlacesFromMcp(fallbackPayload);
    if (fallbackResult.successfull !== false) {
      parsedPayload = fallbackParsed.payload;
      places = fallbackResult.places;
      successfull = fallbackResult.successfull;
      error = fallbackResult.error;
      const fallbackFiltered = filterFoodPlaces(places, queryBase);
      normalized = fallbackFiltered
        .map((place) => normalizeMcpPlace(place, coords))
        .filter((place): place is RecommendationCardData => Boolean(place));
      const retryModeUsed = isNearbySearch ? "nearby->textsearch" : "textsearch->textsearch";
      normalized = applyDistanceSafetyNet(normalized, retryModeUsed).kept;
    }
  }
  const nextPageToken = getNextPageToken(parsedPayload ?? payload);
  const safetyDropMessage =
    initialSafety.droppedCount > 0 && normalized.length === 0
      ? "I couldn’t find reliable nearby matches for that location. Try widening your radius or share a more specific neighborhood."
      : null;
  const fallbackMessage =
    usedFallback && normalized.length > 0
      ? "I had trouble with nearby filtering, so I searched by text instead. Here are some options."
      : null;
  const emptyExplicitLocationMessage =
    usedDistanceFallback &&
    normalized.length === 0 &&
    locationText
      ? `I couldn’t find results near ${locationText} within ${formatRadiusLabel(
          radiusMeters,
        )}. Try a broader keyword or increase radius.`
      : null;

  const message = (() => {
    if (fallbackMessage) return fallbackMessage;
    if (normalized.length > 0) return "Here are a few places you might like.";
    return (
      emptyExplicitLocationMessage ??
      safetyDropMessage ??
      "I couldn’t find food places nearby. Try a different keyword."
    );
  })();

  return {
    places: normalized,
    message,
    nextPageToken,
    assistantMessage: rankingResult.assistantMessage,
  };
};
