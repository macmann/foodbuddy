import { logger } from "../logger";
import { getLocationCoords, getLocationText, type GeoLocation } from "../location";
import { invalidateMcpToolsCache, listMcpTools, mcpCall } from "../mcp/client";
import { resolveMcpPayloadFromResult } from "../mcp/resultParser";
import { resolveMcpTools, selectSearchTool } from "../mcp/toolResolver";
import type { ToolDefinition } from "../mcp/types";
import { resolvePlacesProvider } from "../places";
import type { Coordinates, PlaceCandidate } from "../places";
import { haversineMeters } from "../reco/scoring";
import { parseQuery, recommend } from "../reco/engine";
import { loadSearchSession, upsertSearchSession } from "../searchSession";
import type { RecommendationCardData } from "../types";
import type { ToolSchema } from "./types";

export type AgentToolContext = {
  location: GeoLocation;
  radius_m?: number;
  requestId?: string;
  userIdHash?: string;
  rawMessage?: string;
  locationEnabled?: boolean;
  sessionId?: string;
};

type NearbySearchArgs = {
  query: string;
  latitude?: number;
  longitude?: number;
  radius_m?: number;
};

type RecommendInternalArgs = {
  query: string;
  location?: string;
  maxResultCount?: number;
};

type GeocodeArgs = {
  place: string;
};

type ToolHandler = (
  args: Record<string, unknown>,
  context: AgentToolContext,
) => Promise<Record<string, unknown>>;

const MAX_RECOMMENDATIONS = 3;
const DEFAULT_MAX_RESULT_COUNT = 10;
const MIN_RADIUS_METERS = 500;
const MAX_RADIUS_METERS = 10_000;
const DEFAULT_RADIUS_METERS = 1500;
const PAGINATION_PHRASES = ["show more", "more options", "more", "next"];

type LastSearchState = {
  keyword: string;
  radiusMeters: number;
  nextPageToken?: string;
  lat: number;
  lng: number;
};

const lastSearchBySession = new Map<string, LastSearchState>();

const clampRadiusMeters = (radius?: number): number => {
  const candidate = typeof radius === "number" && Number.isFinite(radius) ? radius : DEFAULT_RADIUS_METERS;
  return Math.min(MAX_RADIUS_METERS, Math.max(MIN_RADIUS_METERS, Math.round(candidate)));
};

const isPaginationMessage = (message?: string): boolean => {
  if (!message) {
    return false;
  }
  const normalized = message.toLowerCase().trim();
  return PAGINATION_PHRASES.some((phrase) => normalized.includes(phrase));
};

const nextPaginationRadius = (currentRadius: number): number => {
  const steps = [1500, 2500, 4000, 6000, 8000, 10_000];
  const current = clampRadiusMeters(currentRadius);
  const next = steps.find((step) => step > current) ?? current;
  return clampRadiusMeters(next);
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

const getLastSearch = async (
  context: AgentToolContext,
): Promise<LastSearchState | null> => {
  if (!context.sessionId) {
    return null;
  }
  const cached = lastSearchBySession.get(context.sessionId);
  if (cached) {
    return cached;
  }
  const stored = await loadSearchSession(context.sessionId);
  if (!stored) {
    return null;
  }
  if (stored.lastLat === null || stored.lastLng === null || !stored.lastQuery) {
    return null;
  }
  const hydrated = {
    keyword: stored.lastQuery,
    radiusMeters: stored.lastRadiusM ?? DEFAULT_RADIUS_METERS,
    nextPageToken: stored.nextPageToken ?? undefined,
    lat: stored.lastLat,
    lng: stored.lastLng,
  };
  lastSearchBySession.set(context.sessionId, hydrated);
  return hydrated;
};

const setLastSearch = async (
  context: AgentToolContext,
  state: LastSearchState,
): Promise<void> => {
  if (!context.sessionId) {
    return;
  }
  lastSearchBySession.set(context.sessionId, state);
  await upsertSearchSession({
    sessionId: context.sessionId,
    lastQuery: state.keyword,
    lastLat: state.lat,
    lastLng: state.lng,
    lastRadiusM: state.radiusMeters,
    nextPageToken: state.nextPageToken ?? null,
  });
};

const resolvePaginationOverride = async (
  context: AgentToolContext,
  fallback: { keyword: string; radiusMeters: number },
): Promise<{ keyword: string; radiusMeters: number; nextPageToken?: string } | null> => {
  if (!context.sessionId) {
    return null;
  }
  if (!isPaginationMessage(context.rawMessage)) {
    return null;
  }
  const lastSearch = await getLastSearch(context);
  if (!lastSearch) {
    return null;
  }
  return {
    keyword: lastSearch.keyword || fallback.keyword,
    radiusMeters: lastSearch.radiusMeters,
    nextPageToken: lastSearch.nextPageToken,
  };
};

const normalizeCandidate = (
  candidate: PlaceCandidate,
  origin?: { lat: number; lng: number },
): RecommendationCardData => {
  const distanceMeters = origin
    ? haversineMeters(origin, { lat: candidate.lat, lng: candidate.lng })
    : undefined;

  return {
    placeId: candidate.placeId,
    name: candidate.name,
    rating: candidate.rating,
    reviewCount: candidate.userRatingsTotal,
    priceLevel: candidate.priceLevel,
    lat: candidate.lat,
    lng: candidate.lng,
    distanceMeters,
    openNow: candidate.openNow,
    address: candidate.address,
    mapsUrl: candidate.mapsUrl,
  };
};

const normalizeRecommendations = (
  items: RecommendationCardData[],
): { primary: RecommendationCardData | null; alternatives: RecommendationCardData[] } => {
  const [primary, ...alternatives] = items.slice(0, MAX_RECOMMENDATIONS);
  return { primary: primary ?? null, alternatives };
};

const pickFirstString = (...values: Array<unknown | undefined>): string | undefined => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

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

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const parseNearbySearchArgs = (args: Record<string, unknown>): NearbySearchArgs => {
  const query = typeof args.query === "string" ? args.query : "";
  return {
    query,
    latitude: toNumber(args.latitude),
    longitude: toNumber(args.longitude),
    radius_m: toNumber(args.radius_m),
  };
};

const parseRecommendArgs = (args: Record<string, unknown>): RecommendInternalArgs => {
  return {
    query: typeof args.query === "string" ? args.query : "",
    location: typeof args.location === "string" ? args.location : undefined,
    maxResultCount: toNumber(
      args.maxResultCount ?? args.max_result_count ?? args.limit ?? args.maxResults,
    ),
  };
};

const parseGeocodeArgs = (args: Record<string, unknown>): GeocodeArgs => {
  return {
    place: typeof args.place === "string" ? args.place : "",
  };
};

const extractLatLng = (payload: unknown): { lat?: number; lng?: number } => {
  if (!isRecord(payload)) {
    return {};
  }
  const record = payload;
  const lat = toNumber(record.lat ?? record.latitude ?? record.y);
  const lng = toNumber(record.lng ?? record.lon ?? record.longitude ?? record.x);
  if (lat !== undefined && lng !== undefined) {
    return { lat, lng };
  }

  const location = record.location ?? record.geometry;
  if (isRecord(location)) {
    return extractLatLng(location);
  }

  return {};
};

const normalizeMcpPlace = (
  payload: Record<string, unknown>,
  origin?: Coordinates,
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
    origin && lat !== undefined && lng !== undefined
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

const buildProviderFallbackResult = ({
  errorMessage,
  providerName = "MCP",
}: {
  errorMessage: string;
  providerName?: string;
}): Record<string, unknown> => {
  return {
    results: [],
    meta: {
      fallbackUsed: true,
      errorMessage,
    },
    debug: {
      error: "provider_failed",
      tool: {
        provider: providerName,
        error_message: errorMessage,
      },
    },
  };
};

const buildNearbySearchArgs = (
  tool: ToolDefinition,
  params: {
    lat: number;
    lng: number;
    radiusMeters: number;
    keyword?: string;
    excludedTypes?: string[] | string;
    nextPageToken?: string;
    maxResultCount?: number;
  },
): { args: Record<string, unknown>; logKeys: string[]; keywordOmitted: boolean } => {
  const schema = tool.inputSchema;
  const args: Record<string, unknown> = {};
  const logKeys = new Set<string>();

  const latKey = matchSchemaKey(schema, ["lat", "latitude"]);
  const lngKey = matchSchemaKey(schema, ["lng", "lon", "longitude"]);
  const radiusKey = matchSchemaKey(schema, ["radius", "radius_m", "distance"]);
  const keywordKey = resolveKeywordSchemaKey(schema);
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
  const nextPageTokenKey = matchSchemaKey(schema, [
    "nextpagetoken",
    "next_page_token",
    "pagetoken",
    "page_token",
    "pageToken",
  ]);
  const maxResultsKey = matchSchemaKey(schema, ["maxresultcount", "maxresults", "limit"]);

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
  const keywordOmitted = Boolean(keywordValue && !keywordKey);
  if (keywordKey && keywordValue) {
    args[keywordKey] = keywordValue;
    logKeys.add(keywordKey);
  }

  if (includedTypesKey && keywordValue) {
    const lowerKeyword = keywordValue.toLowerCase();
    const includedTypes = new Set<string>();
    if (lowerKeyword.includes("noodle")) {
      includedTypes.add("restaurant");
      includedTypes.add("meal_takeaway");
    }
    if (lowerKeyword.includes("takeaway") || lowerKeyword.includes("takeout")) {
      includedTypes.add("meal_takeaway");
    }
    if (includedTypes.size > 0) {
      args[includedTypesKey] = Array.from(includedTypes);
      logKeys.add("includedTypes");
    }
  }

  if (excludedTypesKey && params.excludedTypes !== undefined) {
    const excludedValues = Array.isArray(params.excludedTypes)
      ? params.excludedTypes.filter((item): item is string => typeof item === "string")
      : typeof params.excludedTypes === "string"
        ? [params.excludedTypes]
        : [];
    if (excludedValues.length > 0) {
      args[excludedTypesKey] = excludedValues;
      logKeys.add("excludedTypes");
    }
  }

  if (nextPageTokenKey && params.nextPageToken) {
    args[nextPageTokenKey] = params.nextPageToken;
    logKeys.add("pageToken");
  }

  if (maxResultsKey && params.maxResultCount) {
    args[maxResultsKey] = params.maxResultCount;
  }

  return { args, logKeys: Array.from(logKeys), keywordOmitted };
};

const buildGeocodeArgs = (tool: ToolDefinition, text: string): Record<string, unknown> => {
  const schema = tool.inputSchema;
  const textKey = matchSchemaKey(schema, ["text", "address", "query", "input"]) ?? "text";
  return { [textKey]: text };
};

const buildTextSearchArgs = (
  tool: ToolDefinition,
  params: {
    query: string;
    locationText?: string;
    location?: { lat: number; lng: number };
    nextPageToken?: string;
    maxResultCount?: number;
  },
): Record<string, unknown> => {
  const schema = tool.inputSchema;
  const args: Record<string, unknown> = {};
  const queryKey = matchSchemaKey(schema, ["query", "text", "input", "search"]);
  const locationKey = matchSchemaKey(schema, ["location", "near", "bias"]);
  const latKey = matchSchemaKey(schema, ["lat", "latitude"]);
  const lngKey = matchSchemaKey(schema, ["lng", "lon", "longitude"]);
  const nextPageTokenKey = matchSchemaKey(schema, [
    "nextpagetoken",
    "next_page_token",
    "pagetoken",
    "page_token",
    "pageToken",
  ]);
  const maxResultsKey = matchSchemaKey(schema, ["maxresultcount", "maxresults", "limit"]);

  const queryValue = params.locationText
    ? `${params.query} in ${params.locationText}`
    : params.query;

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

  if (nextPageTokenKey && params.nextPageToken) {
    args[nextPageTokenKey] = params.nextPageToken;
  }

  if (maxResultsKey && params.maxResultCount) {
    args[maxResultsKey] = params.maxResultCount;
  }

  return args;
};

const isUnknownToolError = (err: unknown): boolean => {
  const message = err instanceof Error ? err.message.toLowerCase() : "";
  return message.includes("unknown tool") || message.includes("tool not found");
};

const nearbySearch = async (
  args: NearbySearchArgs,
  context: AgentToolContext,
): Promise<Record<string, unknown>> => {
  const selection = resolvePlacesProvider();
  if (!selection.provider) {
    return {
      results: [],
      debug: { error: selection.reason ?? "Places provider unavailable." },
    };
  }
  const provider = selection.provider;
  const coords = getLocationCoords(context.location);
  const latitude = args.latitude ?? coords?.lat;
  const longitude = args.longitude ?? coords?.lng;

  if (latitude == null || longitude == null) {
    return { error: "Location coordinates are required for nearby search." };
  }

  const parsed = parseQuery(args.query);
  const lastSearch = args.query.trim() ? null : await getLastSearch(context);
  const fallbackKeyword = parsed.keyword ?? lastSearch?.keyword ?? args.query;
  const fallbackRadius = clampRadiusMeters(
    args.radius_m ?? context.radius_m ?? parsed.radiusMeters,
  );
  const paginationOverride = await resolvePaginationOverride(context, {
    keyword: fallbackKeyword,
    radiusMeters: fallbackRadius,
  });
  const keyword = paginationOverride?.keyword ?? fallbackKeyword;
  const baseRadiusMeters = clampRadiusMeters(
    paginationOverride?.radiusMeters ?? fallbackRadius,
  );
  const initialRadiusMeters = paginationOverride?.nextPageToken
    ? baseRadiusMeters
    : paginationOverride
      ? nextPaginationRadius(baseRadiusMeters)
      : baseRadiusMeters;
  const retryRadii =
    initialRadiusMeters <= 1000 ? [initialRadiusMeters, 3000, 8000] : [initialRadiusMeters];

  let candidates: PlaceCandidate[] = [];
  let usedRadiusMeters = initialRadiusMeters;

  for (let attempt = 0; attempt < retryRadii.length; attempt += 1) {
    const radiusMeters = retryRadii[attempt];
    usedRadiusMeters = radiusMeters;
    const response = await provider.nearbySearch({
      lat: latitude,
      lng: longitude,
      radiusMeters,
      keyword,
      openNow: parsed.openNow,
      requestId: context.requestId,
    });
    candidates = response.results;

    logger.info(
      {
        requestId: context.requestId,
        tool: "nearby_search",
        count: candidates.length,
        usedLat: latitude,
        usedLng: longitude,
        usedRadius: radiusMeters,
      },
      "Nearby search results",
    );

    if (candidates.length > 0) {
      break;
    }
  }

  const normalized = candidates.map((candidate) =>
    normalizeCandidate(candidate, { lat: latitude, lng: longitude }),
  );

  if (keyword) {
    await setLastSearch(context, {
      keyword,
      radiusMeters: usedRadiusMeters,
      lat: latitude,
      lng: longitude,
    });
  }

  return {
    results: normalized,
    usedLatitude: latitude,
    usedLongitude: longitude,
    usedRadiusMeters,
    exhausted: candidates.length === 0 && retryRadii.length > 1,
  };
};

const recommendInternal = async (
  args: RecommendInternalArgs,
  context: AgentToolContext,
): Promise<Record<string, unknown>> => {
  try {
    const rawQuery = args.query.trim();
    const lastSearch = rawQuery ? null : await getLastSearch(context);
    const resolvedQuery = rawQuery || lastSearch?.keyword || "";
    const parsed = parseQuery(resolvedQuery);
    const fallbackKeyword = parsed.keyword ?? resolvedQuery;
    const requestedMaxResultCount =
      args.maxResultCount && args.maxResultCount > 0
        ? Math.round(args.maxResultCount)
        : undefined;
    const maxResultCount = requestedMaxResultCount ?? DEFAULT_MAX_RESULT_COUNT;
    const fallbackRadius = clampRadiusMeters(context.radius_m ?? parsed.radiusMeters);
    const paginationOverride = await resolvePaginationOverride(context, {
      keyword: fallbackKeyword,
      radiusMeters: fallbackRadius,
    });
    const keyword = paginationOverride?.keyword ?? fallbackKeyword;
    const baseRadiusMeters = clampRadiusMeters(
      paginationOverride?.radiusMeters ?? fallbackRadius,
    );
    const initialRadiusMeters = paginationOverride?.nextPageToken
      ? baseRadiusMeters
      : paginationOverride
        ? nextPaginationRadius(baseRadiusMeters)
        : baseRadiusMeters;
    const locationText = pickFirstString(
      args.location,
      parsed.locationText,
      getLocationText(context.location),
    );
    const selection = resolvePlacesProvider();
    const providerName = selection.providerName;
    const provider = selection.provider;
    const nextPageToken = paginationOverride?.nextPageToken;
    const mcpUrl = (process.env.COMPOSIO_MCP_URL ?? "").trim().replace(/^"+|"+$/g, "");
    const composioApiKey = process.env.COMPOSIO_API_KEY ?? "";

    if (providerName === "MCP" && mcpUrl && !mcpUrl.startsWith("http")) {
      throw new Error("COMPOSIO_MCP_URL must start with http:// or https://");
    }

    let locationCoords = getLocationCoords(context.location);

    if (!locationCoords && locationText && provider) {
      const geocoded = await provider.geocode(locationText, context.requestId);
      if (geocoded) {
        locationCoords = { lat: geocoded.lat, lng: geocoded.lng };
      }
    }

    logger.info(
      {
        requestId: context.requestId,
        provider: providerName,
        hasCoordinates: Boolean(locationCoords),
        lat: locationCoords?.lat,
        lng: locationCoords?.lng,
        radius_m: initialRadiusMeters,
        keyword,
        rawMessage: context.rawMessage ?? args.query,
        locationEnabled: context.locationEnabled,
        locationText,
      },
      "recommend_places request",
    );

    if (providerName === "NONE" || !provider) {
      return buildProviderFallbackResult({
        errorMessage: selection.reason ?? "Places provider unavailable; please try again.",
        providerName,
      });
    }

    if (!locationCoords && providerName !== "MCP") {
      return {
        results: [],
        debug: { error: "Location is required for recommendations." },
      };
    }

    if (providerName === "MCP") {
      try {
        const tools = await listMcpTools({
          url: mcpUrl,
          apiKey: composioApiKey,
          requestId: context.requestId,
        });
        const resolvedTools = resolveMcpTools(tools);
        const available = tools.map((item) => item.name).join(", ");

        const ensureTools = () => {
          if (!resolvedTools.nearbySearch && !resolvedTools.textSearch) {
            throw new Error(
              `Unable to resolve MCP search tool. Available tools: ${available || "(none)"}`,
            );
          }
        };
        ensureTools();

        const refreshTools = async () => {
          invalidateMcpToolsCache({ url: mcpUrl, apiKey: composioApiKey });
          const refreshed = await listMcpTools({
            url: mcpUrl,
            apiKey: composioApiKey,
            requestId: context.requestId,
          });
          const updated = resolveMcpTools(refreshed);
          return { tools: refreshed, resolved: updated };
        };

        const callTool = async (
          tool: ToolDefinition,
          toolArgs: Record<string, unknown>,
          extraLogKeys: string[] = [],
        ) => {
          const argsKeys = Array.from(
            new Set([...Object.keys(toolArgs), ...extraLogKeys]),
          );
          logger.info(
            {
              requestId: context.requestId,
              provider: "MCP",
              tool: tool.name,
              argsKeys,
            },
            "MCP tool call prepared",
          );
          return mcpCall<unknown>({
            url: mcpUrl,
            apiKey: composioApiKey,
            method: "tools/call",
            params: { name: tool.name, arguments: toolArgs },
            requestId: context.requestId,
          });
        };

        const parsePlaces = (
          payload: unknown,
        ): {
          success: boolean;
          error?: string;
          places: RecommendationCardData[];
          parsedCount: number;
          mappedCount: number;
          nextPageToken?: string;
          message: string;
        } => {
          const { payload: parsedPayload, contentText } = resolveMcpPayloadFromResult(
            payload,
          );
          const rawText = contentText ?? "";
          if (rawText) {
            logger.info(
              {
                requestId: context.requestId,
                provider: "MCP",
                contentSnippet: rawText.slice(0, 300),
              },
              "MCP content text received",
            );
          }

          let parsed: unknown = parsedPayload;
          if (!isRecord(parsed) && rawText) {
            try {
              parsed = JSON.parse(rawText);
            } catch (error) {
              logger.warn(
                { error, requestId: context.requestId, provider: "MCP" },
                "MCP content text JSON parse failed",
              );
            }
          }

          const parsedRecord = isRecord(parsed) ? parsed : undefined;
          const successfull =
            typeof parsedRecord?.successfull === "boolean"
              ? parsedRecord.successfull
              : undefined;
          const errorMessage =
            typeof parsedRecord?.error === "string" ? parsedRecord.error : undefined;
          const logs = parsedRecord?.logs;
          if (logs !== undefined) {
            logger.info(
              { requestId: context.requestId, provider: "MCP", logs },
              "MCP logs received",
            );
          }

          const placesCandidate = isRecord(parsedRecord?.data)
            ? parsedRecord?.data.places
            : undefined;
          const nextPageTokenParsed = getNextPageToken(parsed ?? payload);
          const failureMessage = "Couldn't fetch nearby places. Please try again.";
          if (successfull === false || !Array.isArray(placesCandidate)) {
            return {
              success: false,
              error: errorMessage ?? "No places array",
              places: [],
              parsedCount: 0,
              mappedCount: 0,
              nextPageToken: nextPageTokenParsed,
              message: failureMessage,
            };
          }

          const mappedPlaces = placesCandidate
            .filter((place): place is Record<string, unknown> => isRecord(place))
            .map((place) => normalizeMcpPlace(place, locationCoords))
            .filter((place): place is RecommendationCardData => Boolean(place));

          logger.info(
            {
              requestId: context.requestId,
              provider: "MCP",
              parsedCount: placesCandidate.length,
              mappedCount: mappedPlaces.length,
            },
            "MCP places parsed",
          );

          const limit = maxResultCount;
          if (mappedPlaces.length > limit) {
            logger.info(
              {
                requestId: context.requestId,
                provider: "MCP",
                preLimitCount: mappedPlaces.length,
                limit,
              },
              "MCP places limited",
            );
          }

          const limitedPlaces = mappedPlaces.slice(0, limit);
          return {
            success: true,
            places: limitedPlaces,
            parsedCount: placesCandidate.length,
            mappedCount: mappedPlaces.length,
            nextPageToken: nextPageTokenParsed,
            message: `Here are ${limitedPlaces.length} places near you.`,
          };
        };

        if (!locationCoords && locationText && resolvedTools.geocode) {
          const geocodeArgs = buildGeocodeArgs(resolvedTools.geocode, locationText);
          try {
            const geocodePayload = await callTool(resolvedTools.geocode, geocodeArgs);
            const { payload } = resolveMcpPayloadFromResult(geocodePayload);
            const coords = extractLatLng(payload ?? {});
            if (coords.lat !== undefined && coords.lng !== undefined) {
              locationCoords = { lat: coords.lat, lng: coords.lng };
            }
          } catch (err) {
            if (isUnknownToolError(err)) {
              await refreshTools();
            }
          }
        }

        if (!locationCoords) {
          return buildProviderFallbackResult({
            errorMessage:
              "Location coordinates are required. Share your GPS location or provide a neighborhood.",
            providerName,
          });
        }

        const retryRadii = Array.from(
          new Set([initialRadiusMeters, 3000, 5000].map(clampRadiusMeters)),
        );

        let normalized: RecommendationCardData[] = [];
        let parsedPlacesCount = 0;
        let mappedPlacesCount = 0;
        let parsedNextPageToken: string | undefined;
        let responseMessage: string | undefined;
        let usedRadiusMeters = baseRadiusMeters;
        let supportsNextPageToken = false;
        const nearbyKeywordKey = resolvedTools.nearbySearch
          ? resolveKeywordSchemaKey(resolvedTools.nearbySearch.inputSchema)
          : undefined;
        const shouldPreferTextSearch =
          Boolean(keyword) &&
          Boolean(resolvedTools.textSearch) &&
          Boolean(resolvedTools.nearbySearch) &&
          !nearbyKeywordKey;
        if (shouldPreferTextSearch) {
          logger.info(
            {
              requestId: context.requestId,
              provider: "MCP",
              tool: resolvedTools.textSearch?.name,
              keyword,
              nearbySchemaKeys: getSchemaProperties(
                resolvedTools.nearbySearch?.inputSchema,
              ),
            },
            "MCP nearby search lacks keyword field; using text search",
          );
        }
        const selectedTool = selectSearchTool(resolvedTools, { hasCoordinates: true }).tool;
        const searchTool = shouldPreferTextSearch
          ? resolvedTools.textSearch ?? selectedTool
          : selectedTool;
        if (searchTool) {
          supportsNextPageToken = Boolean(
            matchSchemaKey(searchTool.inputSchema, [
              "nextpagetoken",
              "next_page_token",
              "pagetoken",
              "page_token",
              "pageToken",
            ]),
          );
          const radiusMetersToUse =
            paginationOverride && (!nextPageToken || !supportsNextPageToken)
              ? nextPaginationRadius(baseRadiusMeters)
              : baseRadiusMeters;
          usedRadiusMeters = radiusMetersToUse;
          const radiiToTry = paginationOverride ? [radiusMetersToUse] : retryRadii;
          for (const radiusMeters of radiiToTry) {
            try {
              let payload: unknown;
              if (searchTool.name === resolvedTools.textSearch?.name) {
                payload = await callTool(
                  searchTool,
                  buildTextSearchArgs(searchTool, {
                    query: keyword,
                    locationText,
                    location: locationCoords,
                    nextPageToken: supportsNextPageToken ? nextPageToken : undefined,
                    maxResultCount,
                  }),
                );
              } else {
                const { args: nearbyArgs, logKeys, keywordOmitted } = buildNearbySearchArgs(
                  searchTool,
                  {
                    lat: locationCoords.lat,
                    lng: locationCoords.lng,
                    radiusMeters,
                    keyword,
                    nextPageToken: supportsNextPageToken ? nextPageToken : undefined,
                    maxResultCount,
                  },
                );
                if (keywordOmitted) {
                  logger.info(
                    {
                      requestId: context.requestId,
                      provider: "MCP",
                      tool: searchTool.name,
                      keyword,
                      schemaKeys: getSchemaProperties(searchTool.inputSchema),
                    },
                    "MCP nearby search keyword omitted; no matching field",
                  );
                }
                payload = await callTool(searchTool, nearbyArgs, logKeys);
              }
              const parsed = parsePlaces(payload);
              normalized = parsed.places;
              parsedPlacesCount = parsed.parsedCount;
              mappedPlacesCount = parsed.mappedCount;
              parsedNextPageToken = parsed.nextPageToken;
              responseMessage = parsed.message;
            } catch (err) {
              if (isUnknownToolError(err)) {
                const refreshed = await refreshTools();
                resolvedTools.nearbySearch = refreshed.resolved.nearbySearch;
                resolvedTools.textSearch = refreshed.resolved.textSearch;
              } else {
                throw err;
              }
            }
            if (normalized.length > 0) {
              break;
            }
          }
        }

        logger.info(
          {
            requestId: context.requestId,
            provider: "MCP",
            resultsCount: mappedPlacesCount,
            parsedCount: parsedPlacesCount,
          },
          "MCP recommend_places results parsed",
        );

        if (keyword && locationCoords) {
          await setLastSearch(context, {
            keyword,
            radiusMeters: usedRadiusMeters,
            nextPageToken: parsedNextPageToken ?? nextPageToken,
            lat: locationCoords.lat,
            lng: locationCoords.lng,
          });
        }

        return { results: normalized, message: responseMessage };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown MCP error.";
        logger.warn({ err, requestId: context.requestId }, "Composio MCP recommend_places failed");
        return buildProviderFallbackResult({ errorMessage, providerName });
      }
    }

    if (!locationCoords) {
      return {
        results: [],
        debug: { error: "Location is required for recommendations." },
      };
    }

    const response = await recommend({
      channel: "WEB",
      userIdHash: context.userIdHash ?? "unknown",
      location: locationCoords,
      queryText: keyword,
      radiusMetersOverride: initialRadiusMeters,
      requestId: context.requestId,
    });

    const candidates = [response.primary, ...response.alternatives].filter(
      (item): item is NonNullable<typeof item> => Boolean(item),
    );
    const normalized = candidates.map((item) => {
      const distanceMeters = locationCoords
        ? haversineMeters(locationCoords, {
            lat: item.place.lat,
            lng: item.place.lng,
          })
        : undefined;
      return {
        placeId: item.place.placeId,
        name: item.place.name,
        rating: item.place.rating,
        reviewCount: item.place.userRatingsTotal,
        priceLevel: item.place.priceLevel,
        lat: item.place.lat,
        lng: item.place.lng,
        distanceMeters,
        openNow: item.place.openNow,
        address: item.place.address,
        mapsUrl: item.place.mapsUrl,
        rationale: item.explanation,
      };
    });

    if (keyword && locationCoords) {
      await setLastSearch(context, {
        keyword,
        radiusMeters: initialRadiusMeters,
        lat: locationCoords.lat,
        lng: locationCoords.lng,
      });
    }

    return {
      results: normalized,
      debug: response.debug,
    };
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error during recommend_places.";
    logger.error({ err, requestId: context.requestId }, "recommend_places failed");
    if (resolvePlacesProvider().providerName === "MCP") {
      return buildProviderFallbackResult({
        errorMessage,
        providerName: "MCP",
      });
    }
    return { results: [], debug: { error: "recommend_places_failed" } };
  }
};

const geocodeLocation = async (
  args: GeocodeArgs,
  context: AgentToolContext,
): Promise<Record<string, unknown>> => {
  const selection = resolvePlacesProvider();
  if (!selection.provider) {
    return { error: selection.reason ?? "Places provider unavailable." };
  }
  const provider = selection.provider;
  const coords = await provider.geocode(args.place, context.requestId);
  return { coordinates: coords };
};

export const toolSchemas: ToolSchema[] = [
  {
    type: "function",
    name: "nearby_search",
    description: "Find nearby food places based on user intent and location",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The user's search intent." },
        latitude: { type: "number", description: "Latitude of the user." },
        longitude: { type: "number", description: "Longitude of the user." },
        radius_m: { type: "number", description: "Search radius in meters." },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "recommend_places",
    description: "Use FoodBuddy internal recommendation engine",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The user's search query." },
        location: { type: "string", description: "Location text if known." },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "geocode_location",
    description: "Convert a place name to lat/lng",
    parameters: {
      type: "object",
      properties: {
        place: { type: "string", description: "Place name or address." },
      },
      required: ["place"],
    },
  },
];

export const toolHandlers: Record<string, ToolHandler> = {
  nearby_search: async (args, context) => {
    const start = Date.now();
    const result = await nearbySearch(parseNearbySearchArgs(args), context);
    logger.info(
      {
        requestId: context.requestId,
        tool: "nearby_search",
        latencyMs: Date.now() - start,
      },
      "Tool executed",
    );
    return result;
  },
  recommend_places: async (args, context) => {
    const start = Date.now();
    const result = await recommendInternal(parseRecommendArgs(args), context);
    logger.info(
      {
        requestId: context.requestId,
        tool: "recommend_places",
        latencyMs: Date.now() - start,
      },
      "Tool executed",
    );
    return result;
  },
  geocode_location: async (args, context) => {
    const start = Date.now();
    const result = await geocodeLocation(parseGeocodeArgs(args), context);
    logger.info(
      {
        requestId: context.requestId,
        tool: "geocode_location",
        latencyMs: Date.now() - start,
      },
      "Tool executed",
    );
    return result;
  },
};

export const extractRecommendations = (
  toolName: string,
  toolResult: Record<string, unknown>,
): { primary: RecommendationCardData | null; alternatives: RecommendationCardData[] } => {
  if (toolName === "nearby_search" || toolName === "recommend_places") {
    const results = toolResult.results;
    if (!Array.isArray(results)) {
      return { primary: null, alternatives: [] };
    }
    const normalizedResults = results.filter(
      (result): result is RecommendationCardData =>
        isRecord(result) && typeof result.placeId === "string",
    );
    return normalizeRecommendations(normalizedResults);
  }

  return { primary: null, alternatives: [] };
};
