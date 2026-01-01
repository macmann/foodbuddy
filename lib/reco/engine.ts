import { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { logger } from "../logger";
import { getLocationCoords, type GeoLocation } from "../location";
import { resolvePlacesProvider } from "../places";
import type { PlaceCandidate, PlaceDetails } from "../places";
import {
  communityBoost,
  distanceScore,
  haversineMeters,
  openNowBoost,
  ratingScore,
  reviewConfidence,
} from "./scoring";
import { getRagEnrichmentForPlaces, upsertRagDocForPlace } from "../rag";
import { sanitizeToJson } from "../utils/json";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

type RecommendationInput = {
  channel: "WEB" | "TELEGRAM" | "VIBER" | "MESSENGER";
  userIdHash: string;
  location: { lat: number; lng: number };
  queryText: string;
  radiusMetersOverride?: number;
  requestId?: string;
};

type RecommendationResult = {
  place: PlaceDetails;
  explanation: string;
  score: number;
};

type RecommendationResponse = {
  primary: RecommendationResult | null;
  alternatives: RecommendationResult[];
  debug?: Record<string, unknown>;
};

type RecommendationStatus = "OK" | "ERROR" | "NO_RESULTS";

type ParsedQuery = {
  keyword?: string;
  radiusMeters: number;
  openNow: boolean;
  budget?: "cheap" | "mid" | "expensive";
  llm?: unknown | null;
  locationText?: string;
};

const DEFAULT_RADIUS_METERS = 1500;
const EXPANDED_RADIUS_METERS = 3000;
const MAX_DETAILS = 5;
const MIN_RADIUS_METERS = 500;
const MAX_RADIUS_METERS = 10_000;

const clampRadiusMeters = (radius?: number, fallback = DEFAULT_RADIUS_METERS) => {
  const candidate = typeof radius === "number" && Number.isFinite(radius) ? radius : fallback;
  return Math.min(MAX_RADIUS_METERS, Math.max(MIN_RADIUS_METERS, Math.round(candidate)));
};

type RecommendationMetadata = {
  status: RecommendationStatus;
  latencyMs: number;
  errorMessage?: string;
  resultCount: number;
  recommendedPlaceIds: string[];
  parsedConstraints: ParsedQuery;
  message?: string;
};

type RecommendationEventInput = {
  channel: "WEB" | "TELEGRAM" | "VIBER" | "MESSENGER";
  userIdHash: string;
  location?: GeoLocation | null;
  locationEnabled?: boolean;
  radiusMeters?: number | null;
  queryText: string;
  requestId?: string | null;
  source?: "agent" | "internal";
  agentEnabled?: boolean;
  llmModel?: string | null;
  toolCallCount?: number | null;
  fallbackUsed?: boolean | null;
  rawResponseJson?: string | null;
};

export const recommend = async (
  input: RecommendationInput,
): Promise<RecommendationResponse> => {
  const selection = resolvePlacesProvider();
  if (!selection.provider) {
    return {
      primary: null,
      alternatives: [],
      debug: {
        tool: {
          provider: selection.providerName,
          error_message: selection.reason ?? "Places provider unavailable.",
        },
      },
    };
  }
  const provider = selection.provider;
  const parsed = parseQuery(input.queryText);
  const baseRadius = clampRadiusMeters(input.radiusMetersOverride ?? parsed.radiusMeters);
  const radii = Array.from(new Set([baseRadius, 2500, 5000])).filter(
    (radius) => radius > 0,
  );
  const keywordVariants = buildKeywordVariants(input.queryText, parsed.keyword);

  let candidates: PlaceCandidate[] = [];
  let lastDebug: {
    endpoint?: string;
    googleStatus?: string;
    error_message?: string;
  } = {};
  const attempts: Array<{
    radius: number;
    keyword?: string;
    endpoint: string;
    resultsCount: number;
    googleStatus?: string;
  }> = [];

  for (const radiusMeters of radii) {
    for (const keyword of keywordVariants) {
      const response = await provider.nearbySearch({
        lat: input.location.lat,
        lng: input.location.lng,
        radiusMeters,
        keyword,
        openNow: parsed.openNow,
        requestId: input.requestId ?? undefined,
      });
      candidates = response.results;
      lastDebug = {
        endpoint: response.debug?.endpoint,
        googleStatus: response.debug?.googleStatus,
        error_message: response.debug?.error_message,
      };
      attempts.push({
        radius: radiusMeters,
        keyword,
        endpoint: response.debug?.endpoint ?? "nearby_search",
        resultsCount: response.results.length,
        googleStatus: response.debug?.googleStatus,
      });

      if (candidates.length > 0) {
        break;
      }
    }
    if (candidates.length > 0) {
      break;
    }
  }

  if (candidates.length === 0) {
    const cleanedKeyword =
      keywordVariants[keywordVariants.length - 1] ??
      parsed.keyword ??
      input.queryText;
    const query = `${cleanedKeyword} near (${input.location.lat},${input.location.lng})`;
    const response = await provider.textSearch({
      lat: input.location.lat,
      lng: input.location.lng,
      query,
      requestId: input.requestId ?? undefined,
    });
    candidates = response.results;
    lastDebug = {
      endpoint: response.debug?.endpoint,
      googleStatus: response.debug?.googleStatus,
      error_message: response.debug?.error_message,
    };
    attempts.push({
      radius: radii[radii.length - 1] ?? baseRadius,
      keyword: cleanedKeyword,
      endpoint: response.debug?.endpoint ?? "text_search",
      resultsCount: response.results.length,
      googleStatus: response.debug?.googleStatus,
    });
  }

  if (candidates.length === 0) {
    return {
      primary: null,
      alternatives: [],
      debug: {
        tool: {
          endpointUsed: lastDebug.endpoint,
          googleStatus: lastDebug.googleStatus,
          error_message: lastDebug.error_message,
          attempts,
        },
      },
    };
  }

  const topCandidates = candidates.slice(0, MAX_DETAILS);
  const enriched = await Promise.all(
    topCandidates.map((candidate) => provider.placeDetails(candidate.placeId)),
  );

  const mergedResults: PlaceDetails[] = topCandidates.map((candidate, index) => {
    const details = enriched[index];
    return details ?? candidate;
  });

  await upsertPlaces(mergedResults);

  const aggregates = await prisma.placeAggregate.findMany({
    where: { placeId: { in: mergedResults.map((item) => item.placeId) } },
  });
  const aggregateMap = new Map(aggregates.map((item) => [item.placeId, item]));

  await Promise.allSettled(
    mergedResults.map((place) => upsertRagDocForPlace(place.placeId)),
  );

  const scored = mergedResults
    .map((place) => {
      const distanceMeters = haversineMeters(input.location, {
        lat: place.lat,
        lng: place.lng,
      });
      const baseScore =
        distanceScore(distanceMeters, EXPANDED_RADIUS_METERS) * 0.4 +
        ratingScore(place.rating) * 0.35 +
        reviewConfidence(place.userRatingsTotal) * 0.15 +
        openNowBoost(place.openNow);

      const aggregate = aggregateMap.get(place.placeId);
      const communityScore = aggregate
        ? communityBoost(aggregate.communityRatingAvg, aggregate.communityRatingCount)
        : 0;

      const score = baseScore + communityScore;

      return {
        place,
        distanceMeters,
        score,
        communityScore,
      };
    })
    .sort((a, b) => b.score - a.score);

  const enrichment = await getRagEnrichmentForPlaces(
    scored.map((entry) => entry.place.placeId),
    input.queryText,
  );

  const results = scored.map((entry) => {
    const base = buildExplanation(entry.place, entry.distanceMeters, entry.communityScore);
    const mention = enrichment.get(entry.place.placeId);
    return {
      place: entry.place,
      score: entry.score,
      explanation: mention ? `${base} ${mention}` : base,
    };
  });

  const [primary, ...alternatives] = results;

  return {
    primary: primary ?? null,
    alternatives: alternatives.slice(0, 2),
    debug: {
      tool: {
        endpointUsed: lastDebug.endpoint,
        googleStatus: lastDebug.googleStatus,
        error_message: lastDebug.error_message,
        attempts,
      },
    },
  };
};

const buildKeywordVariants = (rawQuery: string, parsedKeyword?: string): string[] => {
  const normalized = rawQuery.toLowerCase();
  const original = normalized
    .replace(/(open|near|nearby|around|in|at)/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  const stripped = normalized
    .replace(/(cheap|budget|low price|affordable)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const noun = stripped.split(" ").filter(Boolean).slice(-1)[0];
  const variants = [original, parsedKeyword, stripped, noun].filter(
    (value): value is string => Boolean(value && value.trim().length > 0),
  );
  return Array.from(new Set(variants));
};

export const parseQuery = (queryText: string): ParsedQuery => {
  const lower = queryText.toLowerCase();
  const openNow = lower.includes("open");
  const locationMatch = lower.match(/\bin\s+(.+)$/);
  const locationText =
    locationMatch && locationMatch.index !== undefined
      ? queryText.slice(locationMatch.index + 3).trim()
      : undefined;
  const baseQuery =
    locationMatch && locationMatch.index !== undefined
      ? lower.slice(0, locationMatch.index).trim()
      : lower;

  let budget: ParsedQuery["budget"];
  if (/(cheap|budget|affordable|inexpensive)/.test(lower)) {
    budget = "cheap";
  } else if (/(expensive|fine dining|splurge|luxury)/.test(lower)) {
    budget = "expensive";
  } else if (/(mid|moderate|average|normal)/.test(lower)) {
    budget = "mid";
  }

  const keyword = baseQuery
    .replace(
      /(open|near|nearby|around|cheap|budget|affordable|inexpensive|expensive|fine dining|splurge|luxury|mid|moderate|average|normal)/g,
      "",
    )
    .trim();

  return {
    keyword: keyword.length > 0 ? keyword : undefined,
    radiusMeters: DEFAULT_RADIUS_METERS,
    openNow,
    budget,
    locationText: locationText && locationText.length > 0 ? locationText : undefined,
  };
};

const upsertPlaces = async (places: PlaceDetails[]): Promise<void> => {
  await Promise.all(
    places.map((place) =>
      prisma.place.upsert({
        where: { placeId: place.placeId },
        update: {
          name: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          googleRating: place.rating,
          googleRatingsTotal: place.userRatingsTotal,
          priceLevel: place.priceLevel,
          types: place.types,
          mapsUrl: place.mapsUrl,
        },
        create: {
          placeId: place.placeId,
          name: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          googleRating: place.rating,
          googleRatingsTotal: place.userRatingsTotal,
          priceLevel: place.priceLevel,
          types: place.types,
          mapsUrl: place.mapsUrl,
        },
      }),
    ),
  );
};

export const writeRecommendationEvent = async (
  input: RecommendationEventInput,
  metadata: RecommendationMetadata,
): Promise<void> => {
  try {
    const coords = getLocationCoords(input.location ?? undefined);
    await prisma.recommendationEvent.create({
      data: {
        channel: input.channel,
        userIdHash: input.userIdHash,
        userLat: coords?.lat ?? null,
        userLng: coords?.lng ?? null,
        queryText: input.queryText,
        recommendedPlaceIds: metadata.recommendedPlaceIds,
        status: metadata.status,
        latencyMs: metadata.latencyMs,
        errorMessage: metadata.errorMessage,
        resultCount: metadata.resultCount,
        parsedConstraints: sanitizeToJson(metadata.parsedConstraints),
        requestId: input.requestId ?? null,
        locationEnabled: input.locationEnabled ?? null,
        radiusMeters: input.radiusMeters ?? null,
        source: input.source ?? null,
        agentEnabled: input.agentEnabled ?? null,
        llmModel: input.llmModel ?? null,
        toolCallCount: input.toolCallCount ?? null,
        fallbackUsed: input.fallbackUsed ?? null,
        rawResponseJson: input.rawResponseJson ?? null,
      },
    });
  } catch (error) {
    const prismaError =
      error instanceof Prisma.PrismaClientKnownRequestError ? error : null;
    const meta = prismaError?.meta;
    const metaModel =
      isRecord(meta) && typeof meta.modelName === "string" ? meta.modelName : undefined;
    const metaTable =
      isRecord(meta) && typeof meta.table === "string" ? meta.table : undefined;
    logger.error(
      {
        error,
        prismaCode: prismaError?.code,
        prismaModel: metaModel ?? metaTable,
      },
      "Failed to persist recommendation event. Run `prisma migrate deploy` to ensure migrations are applied.",
    );
  }
};

export type { ParsedQuery, RecommendationMetadata, RecommendationStatus };

const buildExplanation = (
  place: PlaceDetails,
  distanceMeters: number,
  communityScore: number,
): string => {
  const parts: string[] = [];
  if (distanceMeters) {
    parts.push(`${Math.round(distanceMeters)}m away`);
  }
  if (place.rating) {
    parts.push(`${place.rating.toFixed(1)}★`);
  }
  if (place.openNow) {
    parts.push("open now");
  }
  if (communityScore > 0) {
    parts.push("popular with the community");
  }

  return `${place.name} is ${parts.join(", ")}.`;
};
