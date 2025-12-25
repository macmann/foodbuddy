export type DistanceInput = {
  lat: number;
  lng: number;
};

const EARTH_RADIUS_METERS = 6371_000;

export const haversineMeters = (from: DistanceInput, to: DistanceInput): number => {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
};

export const distanceScore = (distanceMeters: number, maxDistanceMeters: number): number => {
  if (maxDistanceMeters <= 0) {
    return 0;
  }
  const normalized = Math.min(distanceMeters / maxDistanceMeters, 1);
  return 1 - normalized;
};

export const ratingScore = (rating?: number): number => {
  if (!rating) {
    return 0;
  }
  return Math.min(rating / 5, 1);
};

export const reviewConfidence = (count?: number): number => {
  if (!count || count <= 0) {
    return 0;
  }
  return Math.min(Math.log10(count + 1) / 3, 1);
};

export const openNowBoost = (openNow?: boolean): number => (openNow ? 0.1 : 0);

export const communityBoost = (avgRating: number, count: number): number => {
  if (count <= 0) {
    return 0;
  }
  const avgScore = Math.min(avgRating / 5, 1);
  const confidence = Math.min(Math.log10(count + 1) / 2, 1);
  return avgScore * confidence * 0.3;
};
