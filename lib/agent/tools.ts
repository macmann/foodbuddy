import { logger } from "../logger";
import { listMcpTools, mcpCall } from "../mcp/client";
import type { ToolDefinition } from "../mcp/types";
import { getPlacesProvider } from "../places";
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

const buildMapsUrl = (name: string, lat?: number, lng?: number): string => {
  const query = lat !== undefined && lng !== undefined ? `${name} ${lat},${lng}` : name;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
};

const extractPlacesArray = (payload: unknown): Record<string, unknown>[] => {
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload)) {
    return payload.filter((item) => item && typeof item === "object") as Record<
      string,
      unknown
    >[];
  }
  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const listCandidates =
      record.results ?? record.places ?? record.candidates ?? record.items ?? record.data;
    if (Array.isArray(listCandidates)) {
      return listCandidates.filter((item) => item && typeof item === "object") as Record<
        string,
        unknown
      >[];
    }
    if (record.result && typeof record.result === "object") {
      return extractPlacesArray(record.result);
    }
  }
  return [];
};

const normalizeMcpPlace = (
  payload: Record<string, unknown>,
  origin: Coordinates,
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
    ) ?? buildMapsUrl(name ?? "place", lat, lng);
  const openNow =
    typeof payload.openNow === "boolean"
      ? payload.openNow
      : typeof payload.open_now === "boolean"
        ? payload.open_now
        : undefined;

  const distanceMeters =
    lat !== undefined && lng !== undefined ? haversineMeters(origin, { lat, lng }) : undefined;

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

const buildMcpFallbackResult = ({ errorMessage }: { errorMessage: string }): Record<
  string,
  unknown
> => {
  return {
    results: [],
    meta: {
      fallbackUsed: true,
      errorMessage,
    },
    debug: {
      error: "mcp_failed",
      tool: {
        provider: "MCP",
        error_message: errorMessage,
      },
    },
  };
};

const resolveNearbySearchTool = (tools: ToolDefinition[]): ToolDefinition | null => {
  const findTool = (requirements: string[]) => {
    const found = tools.find((tool) => {
      const name = tool.name.toLowerCase();
      return requirements.every((part) => name.includes(part));
    });
    return found ?? null;
  };

  return (
    findTool(["nearby", "search"]) ??
    findTool(["places", "nearby"]) ??
    findTool(["maps", "places", "search"]) ??
    findTool(["maps", "search"]) ??
    null
  );
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

const nearbySearch = async (
  args: NearbySearchArgs,
  context: AgentToolContext,
): Promise<Record<string, unknown>> => {
  const provider = getPlacesProvider();
  const latitude = args.latitude ?? context.location?.lat;
  const longitude = args.longitude ?? context.location?.lng;

  if (latitude == null || longitude == null) {
    return { error: "Location coordinates are required for nearby search." };
  }

  const parsed = parseQuery(args.query);
  const initialRadiusMeters = args.radius_m ?? context.radius_m ?? parsed.radiusMeters;
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
    const providerName = process.env.GOOGLE_PROVIDER ?? "GOOGLE_MAPS";
    const isMcpProvider = providerName === "MCP";
    const mcpUrl = (process.env.COMPOSIO_MCP_URL ?? "").trim().replace(/^"+|"+$/g, "");
    const composioApiKey = process.env.COMPOSIO_API_KEY;
    const hasComposioKey = Boolean(composioApiKey);
    const hasComposioUrl = mcpUrl.length > 0;
    const envHasGoogleKey = Boolean(
      process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY,
    );

    if (isMcpProvider && hasComposioUrl && !mcpUrl.startsWith("http")) {
      throw new Error("COMPOSIO_MCP_URL must start with http:// or https://");
    }

    let location: Coordinates | null = null;
    if (context.location) {
      location = context.location;
    } else if (args.location) {
      if (!isMcpProvider || (hasComposioKey && hasComposioUrl)) {
        const provider = getPlacesProvider();
        location = await provider.geocode(args.location);
      }
    }

    const parsed = parseQuery(args.query);
    const initialRadiusMeters = context.radius_m ?? parsed.radiusMeters;

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
        hasComposioKey,
        hasComposioUrl,
        hasGoogleMapsKey: envHasGoogleKey,
      },
      "recommend_places request",
    );

    if (isMcpProvider && (!hasComposioKey || !hasComposioUrl)) {
      return buildMcpFallbackResult({
        errorMessage: "Missing COMPOSIO_MCP_URL or COMPOSIO_API_KEY for MCP provider.",
      });
    }

    if (!location) {
      return {
        results: [],
        debug: { error: "Location is required for recommendations." },
      };
    }

    if (isMcpProvider) {
      const keyword = parsed.keyword ?? args.query;
      try {
        const tools = await listMcpTools({ url: mcpUrl, apiKey: composioApiKey! });
        const tool = resolveNearbySearchTool(tools);
        if (!tool) {
          throw new Error("Unable to resolve MCP nearby search tool.");
        }

        const toolArgs = buildNearbySearchArgs(tool, {
          lat: location.lat,
          lng: location.lng,
          radiusMeters: initialRadiusMeters,
          keyword,
        });

        const payload = await mcpCall<unknown>({
          url: mcpUrl,
          apiKey: composioApiKey!,
          method: "tools/call",
          params: { name: tool.name, arguments: toolArgs },
        });

        const places = extractPlacesArray(payload);
        const normalized = places
          .map((place) => normalizeMcpPlace(place, location!))
          .filter(Boolean) as RecommendationCardData[];

        return { results: normalized };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown MCP error.";
        logger.warn({ err, requestId: context.requestId }, "Composio MCP recommend_places failed");
        return buildMcpFallbackResult({ errorMessage });
      }
    }

    if (!envHasGoogleKey) {
      return {
        results: [],
        places: [],
        debug: { error: "Missing Google API key env var" },
      };
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
    if (process.env.GOOGLE_PROVIDER === "MCP") {
      return buildMcpFallbackResult({
        errorMessage,
      });
    }
    return { results: [], debug: { error: "recommend_places_failed" } };
  }
};

const geocodeLocation = async (
  args: GeocodeArgs,
  _context: AgentToolContext,
): Promise<Record<string, unknown>> => {
  const provider = getPlacesProvider();
  const coords = await provider.geocode(args.place);
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
