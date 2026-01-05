import { haversineMeters } from "../reco/scoring";
import type { RecommendationCardData } from "../types/chat";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const coerceNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const coerceString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

const extractLatLng = (payload: Record<string, unknown>): { lat?: number; lng?: number } => {
  const directLat = coerceNumber(payload.lat ?? payload.latitude ?? payload.y);
  const directLng = coerceNumber(payload.lng ?? payload.lon ?? payload.longitude ?? payload.x);
  if (directLat !== undefined && directLng !== undefined) {
    return { lat: directLat, lng: directLng };
  }

  const location =
    (isRecord(payload.location) ? payload.location : undefined) ??
    (isRecord(payload.geometry) ? payload.geometry : undefined);
  if (location) {
    const inner = isRecord(location.location) ? location.location : location;
    const lat = coerceNumber(inner.lat ?? inner.latitude);
    const lng = coerceNumber(inner.lng ?? inner.lon ?? inner.longitude);
    if (lat !== undefined && lng !== undefined) {
      return { lat, lng };
    }
  }

  return {};
};

const buildFallbackPlaceId = (seed: string) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return `mcp_${Math.abs(hash)}`;
};

const normalizeTypes = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const filtered = value.filter((item): item is string => typeof item === "string");
  return filtered.length > 0 ? filtered : undefined;
};

export function normalizeMcpPlace(
  place: any,
  origin?: { lat: number; lng: number } | null,
): RecommendationCardData | null {
  if (!isRecord(place)) {
    return null;
  }

  const displayName = isRecord(place.displayName) ? place.displayName : undefined;
  const displayNameText = coerceString(displayName?.text ?? displayName?.value);
  const name =
    displayNameText ??
    coerceString(place.name) ??
    coerceString(place.display_name) ??
    coerceString(place.title);

  if (!name) {
    return null;
  }

  const address =
    coerceString(place.formattedAddress) ??
    coerceString(place.shortFormattedAddress) ??
    coerceString(place.formatted_address) ??
    coerceString(place.vicinity) ??
    coerceString(place.address);
  const { lat, lng } = extractLatLng(place);
  const rating = coerceNumber(place.rating ?? place.googleRating);
  const reviewCount = coerceNumber(
    place.userRatingCount ?? place.user_ratings_total ?? place.reviewsCount ?? place.googleRatingsTotal,
  );
  const mapsUrl = coerceString(place.googleMapsUri ?? place.mapsUri ?? place.url ?? place.maps_url);
  const priceLevel = coerceNumber(place.priceLevel ?? place.price_level);
  const types = normalizeTypes(place.types ?? place.categories);
  const placeId =
    coerceString(place.placeId ?? place.place_id ?? place.id) ??
    buildFallbackPlaceId(
      `${name}|${lat ?? "unknown"}|${lng ?? "unknown"}|${address ?? ""}`,
    );

  const distanceMeters =
    origin && lat !== undefined && lng !== undefined
      ? haversineMeters(origin, { lat, lng })
      : undefined;

  return {
    placeId,
    name,
    rating: rating ?? undefined,
    reviewCount: reviewCount ?? undefined,
    priceLevel: priceLevel ?? undefined,
    lat: lat ?? undefined,
    lng: lng ?? undefined,
    distanceMeters:
      distanceMeters !== undefined && Number.isFinite(distanceMeters)
        ? distanceMeters
        : undefined,
    address,
    mapsUrl,
    types,
  };
}
