import { prisma } from "../db";
import { logger } from "../logger";
import { getPlacesProvider } from "../places";
import type { PlaceCandidate, PlaceDetails } from "../places";
import {
  communityBoost,
  distanceScore,
  haversineMeters,
  openNowBoost,
  ratingScore,
  reviewConfidence,
} from "./scoring";

type RecommendationInput = {
  channel: "WEB" | "TELEGRAM" | "VIBER" | "MESSENGER";
  userIdHash: string;
  location: { lat: number; lng: number };
  queryText: string;
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

type ParsedQuery = {
  keyword?: string;
  radiusMeters: number;
  openNow: boolean;
  budget?: "cheap" | "mid" | "expensive";
};

const DEFAULT_RADIUS_METERS = 1500;
const EXPANDED_RADIUS_METERS = 3000;
const MAX_DETAILS = 5;

export const recommend = async (
  input: RecommendationInput,
): Promise<RecommendationResponse> => {
  const provider = getPlacesProvider();
  const parsed = parseQuery(input.queryText);

  let candidates = await provider.nearbySearch({
    lat: input.location.lat,
    lng: input.location.lng,
    radiusMeters: parsed.radiusMeters,
    keyword: parsed.keyword,
    openNow: parsed.openNow,
  });

  if (candidates.length < 3 && parsed.radiusMeters === DEFAULT_RADIUS_METERS) {
    candidates = await provider.nearbySearch({
      lat: input.location.lat,
      lng: input.location.lng,
      radiusMeters: EXPANDED_RADIUS_METERS,
      keyword: parsed.keyword,
      openNow: parsed.openNow,
    });
  }

  if (candidates.length === 0) {
    await writeRecommendationEvent(input, []);
    return { primary: null, alternatives: [] };
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

  const results = scored.map((entry) => ({
    place: entry.place,
    score: entry.score,
    explanation: buildExplanation(entry.place, entry.distanceMeters, entry.communityScore),
  }));

  const [primary, ...alternatives] = results;

  await writeRecommendationEvent(
    input,
    results.map((result) => result.place.placeId),
  );

  return {
    primary: primary ?? null,
    alternatives: alternatives.slice(0, 2),
  };
};

const parseQuery = (queryText: string): ParsedQuery => {
  const lower = queryText.toLowerCase();
  const openNow = lower.includes("open");

  let budget: ParsedQuery["budget"];
  if (/(cheap|budget|affordable|inexpensive)/.test(lower)) {
    budget = "cheap";
  } else if (/(expensive|fine dining|splurge|luxury)/.test(lower)) {
    budget = "expensive";
  } else if (/(mid|moderate|average|normal)/.test(lower)) {
    budget = "mid";
  }

  const keyword = lower
    .replace(/(open|near|nearby|around|cheap|budget|affordable|inexpensive|expensive|fine dining|splurge|luxury|mid|moderate|average|normal)/g, "")
    .trim();

  return {
    keyword: keyword.length > 0 ? keyword : undefined,
    radiusMeters: DEFAULT_RADIUS_METERS,
    openNow,
    budget,
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

const writeRecommendationEvent = async (
  input: RecommendationInput,
  recommendedPlaceIds: string[],
): Promise<void> => {
  try {
    await prisma.recommendationEvent.create({
      data: {
        channel: input.channel,
        userIdHash: input.userIdHash,
        userLat: input.location.lat,
        userLng: input.location.lng,
        queryText: input.queryText,
        recommendedPlaceIds,
      },
    });
  } catch (error) {
    logger.error({ error }, "Failed to persist recommendation event");
  }
};

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
