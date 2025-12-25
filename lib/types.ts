export type RecommendationCardData = {
  placeId: string;
  name: string;
  rating?: number;
  reviewCount?: number;
  distanceMeters?: number;
  openNow?: boolean;
  address?: string;
  mapsUrl?: string;
  rationale?: string;
};
