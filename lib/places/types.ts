export type Coordinates = {
  lat: number;
  lng: number;
  formattedAddress?: string;
};

export type PlaceCandidate = {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  rating?: number;
  userRatingsTotal?: number;
  priceLevel?: number;
  types?: string[];
  address?: string;
  mapsUrl?: string;
  openNow?: boolean;
};

export type PlaceDetails = PlaceCandidate & {
  address?: string;
};

export type NearbySearchParams = {
  lat: number;
  lng: number;
  radiusMeters: number;
  keyword?: string;
  includedTypes?: string | string[];
  excludedTypes?: string | string[];
  openNow?: boolean;
  requestId?: string;
};

export type TextSearchParams = {
  lat: number;
  lng: number;
  query: string;
  radiusMeters?: number;
  requestId?: string;
};

export type PlacesSearchDebug = {
  endpoint: "nearby_search" | "text_search";
  httpStatus?: number;
  googleStatus?: string;
  error_message?: string;
  resultsCount: number;
};

export type NearbySearchResponse = {
  results: PlaceCandidate[];
  debug?: PlacesSearchDebug;
};
