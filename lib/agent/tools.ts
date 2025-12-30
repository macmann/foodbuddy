import { logger } from "../logger";
import { getPlacesProvider } from "../places";
import type { Coordinates, PlaceCandidate } from "../places";
import { haversineMeters } from "../reco/scoring";
import { parseQuery, recommend } from "../reco/engine";
import type { RecommendationCardData } from "../types";

export type ToolSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
};

export type AgentToolContext = {
  location?: { lat: number; lng: number } | null;
  requestId?: string;
  userIdHash?: string;
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
  const radiusMeters = args.radius_m ?? parsed.radiusMeters;

  const candidates = await provider.nearbySearch({
    lat: latitude,
    lng: longitude,
    radiusMeters,
    keyword: parsed.keyword,
    openNow: parsed.openNow,
  });

  const normalized = candidates.map((candidate) =>
    normalizeCandidate(candidate, { lat: latitude, lng: longitude }),
  );

  return {
    results: normalized,
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

  const response = await recommend({
    channel: "WEB",
    userIdHash: context.userIdHash ?? "unknown",
    location,
    queryText: args.query,
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
    function: {
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
  },
  {
    type: "function",
    function: {
      name: "recommend_internal",
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
  },
  {
    type: "function",
    function: {
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
  recommend_internal: async (args, context) => {
    const start = Date.now();
    const result = await recommendInternal(args as RecommendInternalArgs, context);
    logger.info(
      {
        requestId: context.requestId,
        tool: "recommend_internal",
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
  if (toolName === "nearby_search" || toolName === "recommend_internal") {
    const results = toolResult.results as RecommendationCardData[] | undefined;
    if (!Array.isArray(results)) {
      return { primary: null, alternatives: [] };
    }
    return normalizeRecommendations(results);
  }

  return { primary: null, alternatives: [] };
};

export type { ToolSchema } from "./llm";
