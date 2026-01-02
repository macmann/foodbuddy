export type RecommendationCardData = {
  placeId: string;
  name: string;
  rating?: number;
  reviewCount?: number;
  priceLevel?: number;
  lat?: number;
  lng?: number;
  distanceMeters?: number;
  openNow?: boolean;
  address?: string;
  mapsUrl?: string;
  rationale?: string;
};

export type Place = RecommendationCardData;

export type ChatResponse = {
  status: "ok" | "error";
  message: string;
  places: Place[];
  meta?: {
    sessionId?: string;
    nextPageToken?: string;
  };
};
