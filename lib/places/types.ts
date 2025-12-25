export type Coordinates = {
  lat: number;
  lng: number;
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
  openNow?: boolean;
};
