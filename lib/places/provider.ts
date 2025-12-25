import type { Coordinates, NearbySearchParams, PlaceCandidate, PlaceDetails } from "./types";

export interface PlacesProvider {
  geocode(text: string): Promise<Coordinates | null>;
  nearbySearch(params: NearbySearchParams): Promise<PlaceCandidate[]>;
  placeDetails(placeId: string): Promise<PlaceDetails | null>;
}
