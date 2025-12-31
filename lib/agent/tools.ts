import { logger } from "../logger";
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
  const provider = getPlacesProvider();
  let location: Coordinates | null = null;

  if (context.location) {
    location = context.location;
  } else if (args.location) {
    location = await provider.geocode(args.location);
  }

  if (!location) {
    return { error: "Location is required for recommendations." };
  }

  const parsed = parseQuery(args.query);
  const initialRadiusMeters = context.radius_m ?? parsed.radiusMeters;
  const envHasGoogleKey = Boolean(
    process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY,
  );

  logger.info(
    {
      requestId: context.requestId,
      hasCoordinates: true,
      lat: location.lat,
      lng: location.lng,
      radius_m: initialRadiusMeters,
      keyword: parsed.keyword,
      rawMessage: context.rawMessage ?? args.query,
      locationEnabled: context.locationEnabled,
      envHasGoogleKey,
    },
    "recommend_places request",
  );

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
