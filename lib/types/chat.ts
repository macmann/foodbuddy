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
  types?: string[];
};

export type Place = RecommendationCardData;

export type ChatResponse = {
  status: "ok" | "error";
  message: string;
  places: Place[];
  meta?: {
    sessionId?: string;
    nextPageToken?: string;
    needs_location?: boolean;
    mode?: "list_qna";
    highlights?: { title: string; details: string }[];
    referencedPlaceIds?: string[];
    source?: string;
  };
};
