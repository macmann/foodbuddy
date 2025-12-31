import type {
  Coordinates,
  NearbySearchParams,
  NearbySearchResponse,
  PlaceDetails,
  TextSearchParams,
} from "./types";

export interface PlacesProvider {
  geocode(text: string): Promise<Coordinates | null>;
  nearbySearch(params: NearbySearchParams): Promise<NearbySearchResponse>;
  textSearch(params: TextSearchParams): Promise<NearbySearchResponse>;
  placeDetails(placeId: string): Promise<PlaceDetails | null>;
}
