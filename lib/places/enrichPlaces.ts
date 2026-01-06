import type { Place, PlaceAggregate } from "@prisma/client";

import { prisma } from "../db";
import { haversineMeters } from "../reco/scoring";
import type { RecommendationCardData } from "../types/chat";

type FoodBuddySource = "foodbuddy_curated" | "google_enriched" | "google";

type RecommendationWithCoords = RecommendationCardData & { lat: number; lng: number };

export type EnrichedRecommendation = Omit<
  RecommendationCardData,
  | "rating"
  | "distanceMeters"
  | "openNow"
  | "address"
  | "mapsUrl"
  | "rationale"
  | "lat"
  | "lng"
> & {
  lat: number;
  lng: number;
  rating: number | undefined;
  distanceMeters: number | undefined;
  openNow: boolean | undefined;
  address: string | undefined;
  mapsUrl: string | undefined;
  rationale: string;
  sourceLabel: FoodBuddySource;
  foodbuddyRatingAvg?: number;
  foodbuddyRatingCount?: number;
  foodbuddySummary?: string | null;
};

const hasNumericCoords = <T extends { lat?: unknown; lng?: unknown }>(
  place: T,
): place is T & { lat: number; lng: number } =>
  typeof place.lat === "number" &&
  Number.isFinite(place.lat) &&
  typeof place.lng === "number" &&
  Number.isFinite(place.lng);

const normalizeTags = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const tags = value.filter((entry): entry is string => typeof entry === "string");
  return tags.length > 0 ? tags : undefined;
};

const buildAggregatePayload = (aggregate?: PlaceAggregate | null) =>
  aggregate
    ? {
        foodbuddyRatingAvg: aggregate.foodbuddyRatingAvg,
        foodbuddyRatingCount: aggregate.foodbuddyRatingCount,
        foodbuddySummary: aggregate.feedbackSummary ?? null,
      }
    : {};

const buildCuratedRecommendation = (
  place: Place & { lat: number; lng: number },
  aggregate?: PlaceAggregate | null,
  origin?: { lat: number; lng: number },
): EnrichedRecommendation => {
  const distanceMeters =
    origin && Number.isFinite(place.lat) && Number.isFinite(place.lng)
      ? haversineMeters(origin, { lat: place.lat, lng: place.lng })
      : undefined;

  return {
    placeId: place.placeId,
    name: place.name,
    rating: undefined,
    reviewCount: place.googleRatingsTotal ?? undefined,
    priceLevel: place.priceLevel ?? undefined,
    lat: place.lat,
    lng: place.lng,
    distanceMeters,
    openNow: undefined,
    address: place.address ?? undefined,
    mapsUrl: place.mapsUrl ?? undefined,
    rationale: "Meal Me pick",
    types: normalizeTags(place.types),
    sourceLabel: "foodbuddy_curated",
    ...buildAggregatePayload(aggregate),
  };
};

const buildEnrichedRecommendation = (
  place: RecommendationWithCoords,
  aggregate?: PlaceAggregate | null,
  origin?: { lat: number; lng: number },
): EnrichedRecommendation => {
  const aggregatePayload = buildAggregatePayload(aggregate);
  const hasFoodbuddyRating = (aggregate?.foodbuddyRatingCount ?? 0) > 0;
  const distanceMeters =
    typeof place.distanceMeters === "number"
      ? place.distanceMeters
      : origin
        ? haversineMeters(origin, { lat: place.lat, lng: place.lng })
        : undefined;
  return {
    placeId: place.placeId,
    name: place.name,
    rating: place.rating ?? undefined,
    reviewCount: place.reviewCount,
    priceLevel: place.priceLevel,
    lat: place.lat,
    lng: place.lng,
    distanceMeters,
    openNow: place.openNow ?? undefined,
    address: place.address ?? undefined,
    mapsUrl: place.mapsUrl ?? undefined,
    rationale:
      place.rationale ??
      (hasFoodbuddyRating ? "Community rated + Google nearby" : "Nearby option"),
    whyLine: place.whyLine,
    tryLine: place.tryLine,
    types: place.types,
    sourceLabel: hasFoodbuddyRating ? "google_enriched" : "google",
    ...aggregatePayload,
  };
};

export const enrichPlaces = async ({
  places,
  origin,
  includeCurated = true,
  curatedLimit = 3,
}: {
  places: RecommendationCardData[];
  origin?: { lat: number; lng: number };
  includeCurated?: boolean;
  curatedLimit?: number;
}): Promise<EnrichedRecommendation[]> => {
  const placesWithCoords = places.filter(hasNumericCoords);
  if (placesWithCoords.length === 0 && !includeCurated) {
    return [];
  }

  const placeIds = Array.from(
    new Set(placesWithCoords.map((place) => place.placeId)),
  );
  const dbPlaces = placeIds.length
    ? await prisma.place.findMany({
        where: {
          OR: [
            { externalPlaceId: { in: placeIds } },
            { placeId: { in: placeIds } },
          ],
        },
      })
    : [];
  const placeByExternalId = new Map<string, Place>();
  const placeIdsForAggregate: string[] = [];
  dbPlaces.forEach((place) => {
    placeByExternalId.set(place.externalPlaceId ?? place.placeId, place);
    placeByExternalId.set(place.placeId, place);
    placeIdsForAggregate.push(place.placeId);
  });

  const aggregates = placeIdsForAggregate.length
    ? await prisma.placeAggregate.findMany({
        where: { placeId: { in: placeIdsForAggregate } },
      })
    : [];
  const aggregateByPlaceId = new Map<string, PlaceAggregate>();
  aggregates.forEach((aggregate) => {
    aggregateByPlaceId.set(aggregate.placeId, aggregate);
  });

  const enriched = placesWithCoords.map((place) => {
    const matched = placeByExternalId.get(place.placeId);
    const aggregate = matched ? aggregateByPlaceId.get(matched.placeId) : undefined;
    return buildEnrichedRecommendation(place, aggregate, origin);
  });

  if (!includeCurated) {
    return enriched;
  }

  const curatedPlaces = await prisma.place.findMany({
    where: { source: "CURATED", isFeatured: true },
    take: curatedLimit,
    orderBy: { updatedAt: "desc" },
  });
  const curatedPlacesWithCoords = curatedPlaces.filter(hasNumericCoords);
  const curatedAggregates = curatedPlacesWithCoords.length
    ? await prisma.placeAggregate.findMany({
        where: {
          placeId: { in: curatedPlacesWithCoords.map((place) => place.placeId) },
        },
      })
    : [];
  const curatedAggregateMap = new Map<string, PlaceAggregate>();
  curatedAggregates.forEach((aggregate) => {
    curatedAggregateMap.set(aggregate.placeId, aggregate);
  });

  const curatedRecommendations = curatedPlacesWithCoords.map((place) =>
    buildCuratedRecommendation(place, curatedAggregateMap.get(place.placeId), origin),
  );

  const existingIds = new Set(enriched.map((place) => place.placeId));
  const combined = [...enriched];
  curatedRecommendations.forEach((place) => {
    if (!existingIds.has(place.placeId)) {
      combined.push(place);
    }
  });

  return combined;
};
