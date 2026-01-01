import { logger } from "../logger";
import { getLocationCoords, getLocationText, type GeoLocation } from "../location";
import { invalidateMcpToolsCache, listMcpTools, mcpCall } from "../mcp/client";
import { extractPlacesFromMcpResult } from "../mcp/placesExtractor";
import { resolveMcpPayloadFromResult } from "../mcp/resultParser";
import { resolveMcpTools, selectSearchTool } from "../mcp/toolResolver";
import type { ToolDefinition } from "../mcp/types";
import { resolvePlacesProvider } from "../places";
import type { Coordinates, PlaceCandidate } from "../places";
import { haversineMeters } from "../reco/scoring";
import { parseQuery, recommend } from "../reco/engine";
import type { RecommendationCardData } from "../types";
import type { ToolSchema } from "./types";

export type AgentToolContext = {
  location: GeoLocation;
  radius_m?: number;
  requestId?: string;
  userIdHash?: string;
  rawMessage?: string;
  locationEnabled?: boolean;
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
};

type GeocodeArgs = {
  place: string;
};

type ToolHandler = (
  args: Record<string, unknown>,
  context: AgentToolContext,
) => Promise<Record<string, unknown>>;

const MAX_RECOMMENDATIONS = 3;
const MIN_RADIUS_METERS = 500;
const MAX_RADIUS_METERS = 10_000;
const DEFAULT_RADIUS_METERS = 1500;

const clampRadiusMeters = (radius?: number): number => {
  const candidate = typeof radius === "number" && Number.isFinite(radius) ? radius : DEFAULT_RADIUS_METERS;
  return Math.min(MAX_RADIUS_METERS, Math.max(MIN_RADIUS_METERS, Math.round(candidate)));
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

const buildMapsUrl = (placeId?: string): string | undefined => {
  if (!placeId) {
    return undefined;
  }
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
};

const normalizeMcpPlace = (
  payload: Record<string, unknown>,
  origin?: Coordinates,
): RecommendationCardData | null => {
  const displayName = payload.displayName;
  const displayNameText =
    isRecord(displayName) && typeof displayName.text === "string"
      ? displayName.text
      : undefined;
  const displayNameAlt =
    typeof payload.display_name === "string" ? payload.display_name : undefined;
  const name = pickFirstString(
    payload.name,
    displayNameText,
    displayNameAlt,
  );
  const placeId = pickFirstString(payload.placeId, payload.place_id, payload.id, payload.placeid);
  const { lat, lng } = extractLatLng(payload);

  if (!placeId && !name) {
    return null;
  }

  const rating = toNumber(payload.rating ?? payload.google_rating ?? payload.score);
  const reviewCount = toNumber(
    payload.userRatingsTotal ?? payload.user_ratings_total ?? payload.rating_count,
  );
  const priceLevel = toNumber(payload.priceLevel ?? payload.price_level);
  const address = pickFirstString(
    payload.address,
    payload.formatted_address,
    payload.formattedAddress,
    payload.vicinity,
  );
  const mapsUrl =
    pickFirstString(
      payload.mapsUrl,
      payload.url,
      payload.googleMapsUrl,
      payload.googleMapsUri,
    ) ?? buildMapsUrl(placeId ?? undefined);
  const openNow =
    typeof payload.openNow === "boolean"
      ? payload.openNow
      : typeof payload.open_now === "boolean"
        ? payload.open_now
        : undefined;

  const distanceMeters =
    origin && lat !== undefined && lng !== undefined
      ? haversineMeters(origin, { lat, lng })
      : undefined;

  const normalizedPlaceId =
    placeId ?? `${name ?? "place"}-${lat ?? ""}-${lng ?? ""}`.replace(/\s+/g, "-");

  return {
    placeId: normalizedPlaceId,
    name: name ?? "Unknown",
    rating,
    reviewCount,
    priceLevel,
    lat,
    lng,
    distanceMeters,
    openNow,
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
  },
): Record<string, unknown> => {
  const schema = tool.inputSchema;
  const args: Record<string, unknown> = {};

  const latKey = matchSchemaKey(schema, ["lat", "latitude"]);
  const lngKey = matchSchemaKey(schema, ["lng", "lon", "longitude"]);
  const radiusKey = matchSchemaKey(schema, ["radius", "radius_m", "distance"]);
  const keywordKey = matchSchemaKey(schema, ["keyword", "query", "text", "search"]);

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

  if (keywordKey && params.keyword) {
    args[keywordKey] = params.keyword;
  }

  return args;
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
  },
): Record<string, unknown> => {
  const schema = tool.inputSchema;
  const args: Record<string, unknown> = {};
  const queryKey = matchSchemaKey(schema, ["query", "text", "input", "search"]);
  const locationKey = matchSchemaKey(schema, ["location", "near", "bias"]);
  const latKey = matchSchemaKey(schema, ["lat", "latitude"]);
  const lngKey = matchSchemaKey(schema, ["lng", "lon", "longitude"]);

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
  const initialRadiusMeters = clampRadiusMeters(
    args.radius_m ?? context.radius_m ?? parsed.radiusMeters,
  );
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
      keyword: parsed.keyword,
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
    const parsed = parseQuery(args.query);
    const initialRadiusMeters = clampRadiusMeters(context.radius_m ?? parsed.radiusMeters);
    const locationText = pickFirstString(
      args.location,
      parsed.locationText,
      getLocationText(context.location),
    );
    const selection = resolvePlacesProvider();
    const providerName = selection.providerName;
    const provider = selection.provider;
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
        keyword: parsed.keyword,
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
      const keyword = parsed.keyword ?? args.query;
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

        const callTool = async (tool: ToolDefinition, toolArgs: Record<string, unknown>) => {
          logger.info(
            {
              requestId: context.requestId,
              provider: "MCP",
              tool: tool.name,
              argsKeys: Object.keys(toolArgs),
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

        const parsePlaces = (payload: unknown) => {
          const { places, contentText } = extractPlacesFromMcpResult(payload);
          if (contentText) {
            logger.info(
              {
                requestId: context.requestId,
                provider: "MCP",
                contentSnippet: contentText.slice(0, 300),
              },
              "MCP content text received",
            );
          }
          return places
            .map((place) => normalizeMcpPlace(place, locationCoords))
            .filter((place): place is RecommendationCardData => Boolean(place));
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
        const searchTool = selectSearchTool(resolvedTools, { hasCoordinates: true }).tool;
        if (searchTool) {
          for (const radiusMeters of retryRadii) {
            const toolArgs =
              searchTool.name === resolvedTools.textSearch?.name
                ? buildTextSearchArgs(searchTool, {
                    query: keyword,
                    locationText,
                    location: locationCoords,
                  })
                : buildNearbySearchArgs(searchTool, {
                    lat: locationCoords.lat,
                    lng: locationCoords.lng,
                    radiusMeters,
                    keyword,
                  });
            try {
              const payload = await callTool(searchTool, toolArgs);
              normalized = parsePlaces(payload);
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
            resultsCount: normalized.length,
          },
          "MCP recommend_places results parsed",
        );

        return { results: normalized };
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
      queryText: args.query,
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
