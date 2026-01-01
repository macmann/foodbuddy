import { logger } from "../logger";
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
  location?: { lat: number; lng: number } | null;
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

const getSchemaProperties = (schema?: Record<string, unknown>): string[] => {
  if (!schema) {
    return [];
  }
  const properties = (schema as { properties?: Record<string, unknown> }).properties;
  if (!properties || typeof properties !== "object") {
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

const extractLatLng = (payload: Record<string, unknown>): { lat?: number; lng?: number } => {
  const lat = toNumber(payload.lat ?? payload.latitude ?? payload.y);
  const lng = toNumber(payload.lng ?? payload.lon ?? payload.longitude ?? payload.x);
  if (lat !== undefined && lng !== undefined) {
    return { lat, lng };
  }

  const location = payload.location ?? payload.geometry;
  if (location && typeof location === "object") {
    return extractLatLng(location as Record<string, unknown>);
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
  origin?: Coordinates | null,
): RecommendationCardData | null => {
  const name = pickFirstString(
    payload.name,
    (payload as { displayName?: { text?: string } }).displayName?.text,
    (payload as { display_name?: string }).display_name,
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
  const latitude = args.latitude ?? context.location?.lat;
  const longitude = args.longitude ?? context.location?.lng;

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
    const locationText = args.location ?? parsed.locationText;
    const selection = resolvePlacesProvider();
    const providerName = selection.providerName;
    const provider = selection.provider;
    const mcpUrl = (process.env.COMPOSIO_MCP_URL ?? "").trim().replace(/^"+|"+$/g, "");
    const composioApiKey = process.env.COMPOSIO_API_KEY ?? "";

    if (providerName === "MCP" && mcpUrl && !mcpUrl.startsWith("http")) {
      throw new Error("COMPOSIO_MCP_URL must start with http:// or https://");
    }

    let location: Coordinates | null = null;
    if (context.location) {
      location = context.location;
    }

    if (locationText && provider) {
      const geocoded = await provider.geocode(locationText, context.requestId);
      if (geocoded) {
        location = { lat: geocoded.lat, lng: geocoded.lng };
      }
    }

    logger.info(
      {
        requestId: context.requestId,
        provider: providerName,
        hasCoordinates: Boolean(location),
        lat: location?.lat,
        lng: location?.lng,
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

    if (!location && providerName !== "MCP") {
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
            .map((place) => normalizeMcpPlace(place, location))
            .filter(Boolean) as RecommendationCardData[];
        };

        if (!location && locationText && resolvedTools.geocode) {
          const geocodeArgs = buildGeocodeArgs(resolvedTools.geocode, locationText);
          try {
            const geocodePayload = await callTool(resolvedTools.geocode, geocodeArgs);
            const { payload } = resolveMcpPayloadFromResult(geocodePayload);
            const coords = extractLatLng((payload ?? {}) as Record<string, unknown>);
            if (coords.lat !== undefined && coords.lng !== undefined) {
              location = { lat: coords.lat, lng: coords.lng };
            }
          } catch (err) {
            if (isUnknownToolError(err)) {
              await refreshTools();
            }
          }
        }

        const retryRadii = Array.from(
          new Set([initialRadiusMeters, 3000, 5000].map(clampRadiusMeters)),
        );

        let normalized: RecommendationCardData[] = [];
        if (location) {
          const searchTool = selectSearchTool(resolvedTools, { hasCoordinates: true }).tool;
          if (searchTool) {
            for (const radiusMeters of retryRadii) {
              const toolArgs =
                searchTool.name === resolvedTools.textSearch?.name
                  ? buildTextSearchArgs(searchTool, {
                      query: keyword,
                      locationText,
                      location,
                    })
                  : buildNearbySearchArgs(searchTool, {
                      lat: location.lat,
                      lng: location.lng,
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
        }

        if (normalized.length === 0 && resolvedTools.textSearch) {
          const textSearchArgs = buildTextSearchArgs(resolvedTools.textSearch, {
            query: keyword,
            locationText,
            location: location ?? undefined,
          });
          try {
            const payload = await callTool(resolvedTools.textSearch, textSearchArgs);
            normalized = parsePlaces(payload);
          } catch (err) {
            if (isUnknownToolError(err)) {
              await refreshTools();
            } else {
              throw err;
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

    const response = await recommend({
      channel: "WEB",
      userIdHash: context.userIdHash ?? "unknown",
      location,
      queryText: args.query,
      radiusMetersOverride: initialRadiusMeters,
      requestId: context.requestId,
    });

    const normalized = [response.primary, ...response.alternatives]
      .filter(Boolean)
      .map((item) => ({
        placeId: item!.place.placeId,
        name: item!.place.name,
        rating: item!.place.rating,
        reviewCount: item!.place.userRatingsTotal,
        priceLevel: item!.place.priceLevel,
        lat: item!.place.lat,
        lng: item!.place.lng,
        distanceMeters: haversineMeters(location!, {
          lat: item!.place.lat,
          lng: item!.place.lng,
        }),
        openNow: item!.place.openNow,
        address: item!.place.address,
        mapsUrl: item!.place.mapsUrl,
        rationale: item!.explanation,
      }));

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
    const result = await nearbySearch(args as NearbySearchArgs, context);
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
    const result = await recommendInternal(args as RecommendInternalArgs, context);
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
    const result = await geocodeLocation(args as GeocodeArgs, context);
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
    const results = toolResult.results as RecommendationCardData[] | undefined;
    if (!Array.isArray(results)) {
      return { primary: null, alternatives: [] };
    }
    return normalizeRecommendations(results);
  }

  return { primary: null, alternatives: [] };
};
