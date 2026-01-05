import type { Place } from "@prisma/client";

import { prisma } from "../db";
import type { RecommendationCardData } from "../types/chat";

export type NormalizedPlace = Pick<
  RecommendationCardData,
  | "placeId"
  | "name"
  | "lat"
  | "lng"
  | "address"
  | "mapsUrl"
  | "priceLevel"
  | "types"
  | "rating"
  | "reviewCount"
>;

const coerceNumber = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const ensurePlaceFromNormalizedMcpPlace = async (
  mcpPlace: NormalizedPlace,
): Promise<Place> => {
  const externalPlaceId = mcpPlace.placeId;
  const existing = await prisma.place.findFirst({
    where: {
      OR: [{ externalPlaceId }, { placeId: externalPlaceId }],
    },
  });

  if (existing) {
    const updateData: Record<string, unknown> = {};

    if (!existing.externalPlaceId) {
      updateData.externalPlaceId = externalPlaceId;
    }
    if (!existing.name && mcpPlace.name) {
      updateData.name = mcpPlace.name;
    }
    if (!existing.address && mcpPlace.address) {
      updateData.address = mcpPlace.address;
    }
    if (!existing.mapsUrl && mcpPlace.mapsUrl) {
      updateData.mapsUrl = mcpPlace.mapsUrl;
    }
    if (existing.priceLevel === null && mcpPlace.priceLevel !== undefined) {
      updateData.priceLevel = mcpPlace.priceLevel;
    }
    if (existing.types === null && mcpPlace.types) {
      updateData.types = mcpPlace.types;
    }
    if (existing.googleRating === null && mcpPlace.rating !== undefined) {
      updateData.googleRating = mcpPlace.rating;
    }
    if (existing.googleRatingsTotal === null && mcpPlace.reviewCount !== undefined) {
      updateData.googleRatingsTotal = mcpPlace.reviewCount;
    }

    if (Object.keys(updateData).length > 0) {
      return prisma.place.update({
        where: { placeId: existing.placeId },
        data: updateData,
      });
    }

    return existing;
  }

  const lat = coerceNumber(mcpPlace.lat);
  const lng = coerceNumber(mcpPlace.lng);
  if (lat === undefined || lng === undefined) {
    throw new Error("Normalized place requires lat/lng.");
  }

  return prisma.place.create({
    data: {
      placeId: externalPlaceId,
      externalPlaceId,
      name: mcpPlace.name,
      address: mcpPlace.address ?? null,
      lat,
      lng,
      googleRating: mcpPlace.rating ?? null,
      googleRatingsTotal: mcpPlace.reviewCount ?? null,
      priceLevel: mcpPlace.priceLevel ?? null,
      types: mcpPlace.types ?? undefined,
      mapsUrl: mcpPlace.mapsUrl ?? null,
      source: "GOOGLE",
    },
  });
};
