import { logger } from "../logger";
import type { PlacesProvider } from "./provider";
import type {
  Coordinates,
  NearbySearchParams,
  NearbySearchResponse,
  PlaceCandidate,
  PlaceDetails,
  PlacesSearchDebug,
  TextSearchParams,
} from "./types";

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const NEARBY_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json";
const PLACE_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json";
const TEXT_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json";

const PLACE_DETAILS_FIELDS = [
  "place_id",
  "name",
  "geometry/location",
  "rating",
  "user_ratings_total",
  "price_level",
  "types",
  "formatted_address",
  "url",
  "opening_hours/open_now",
].join(",");

type GoogleResponse<T> = {
  status: string;
  error_message?: string;
  results?: T[];
  result?: T;
};

type GooglePlaceResult = {
  place_id: string;
  name: string;
  geometry?: { location?: { lat: number; lng: number } };
  rating?: number;
  user_ratings_total?: number;
  price_level?: number;
  types?: string[];
  vicinity?: string;
  formatted_address?: string;
  url?: string;
  opening_hours?: { open_now?: boolean };
};

export class GoogleApiProvider implements PlacesProvider {
  constructor(private readonly apiKey: string) {}

  async geocode(text: string): Promise<Coordinates | null> {
    try {
      const url = new URL(GEOCODE_URL);
      url.searchParams.set("address", text);
      url.searchParams.set("key", this.apiKey);

      const response = await fetch(url);
      const data = (await response.json()) as GoogleResponse<{
        geometry?: { location?: { lat: number; lng: number } };
      }>;

      if (data.status !== "OK" || !data.results?.length) {
        logger.error(
          { status: data.status, err: data.error_message },
          "Google geocode request failed",
        );
        return null;
      }

      const location = data.results[0]?.geometry?.location;
      if (!location) {
        return null;
      }

      return { lat: location.lat, lng: location.lng };
    } catch (err) {
      logger.error({ err }, "Google geocode request threw an error");
      return null;
    }
  }

  async nearbySearch(params: NearbySearchParams): Promise<NearbySearchResponse> {
    const debugBase = {
      endpoint: "nearby_search",
    } satisfies Pick<PlacesSearchDebug, "endpoint">;
    try {
      const url = new URL(NEARBY_SEARCH_URL);
      url.searchParams.set("location", `${params.lat},${params.lng}`);
      url.searchParams.set("radius", params.radiusMeters.toString());
      if (params.keyword) {
        url.searchParams.set("keyword", params.keyword);
      }
      if (params.openNow) {
        url.searchParams.set("opennow", "true");
      }
      url.searchParams.set("key", this.apiKey);

      const response = await fetch(url);
      const data = (await response.json()) as GoogleResponse<GooglePlaceResult>;
      const debug: PlacesSearchDebug = {
        ...debugBase,
        httpStatus: response.status,
        googleStatus: data.status,
        error_message: data.error_message,
        resultsCount: data.results?.length ?? 0,
      };

      logger.info(
        {
          requestId: params.requestId,
          endpoint: debug.endpoint,
          httpStatus: debug.httpStatus,
          googleStatus: debug.googleStatus,
          error_message: debug.error_message,
          resultsCount: debug.resultsCount,
        },
        "Google nearby search response",
      );

      if (data.status !== "OK" || !data.results) {
        logger.error(
          { status: data.status, err: data.error_message },
          "Google nearby search failed",
        );
        return { results: [], debug };
      }

      const results = data.results
        .map((result) => normalizePlaceResult(result))
        .filter((result): result is PlaceCandidate => result !== null);
      return { results, debug: { ...debug, resultsCount: results.length } };
    } catch (err) {
      logger.info(
        {
          requestId: params.requestId,
          endpoint: debugBase.endpoint,
          httpStatus: undefined,
          googleStatus: undefined,
          error_message: err instanceof Error ? err.message : String(err),
          resultsCount: 0,
        },
        "Google nearby search response",
      );
      logger.error({ err }, "Google nearby search threw an error");
      return { results: [], debug: { ...debugBase, resultsCount: 0 } };
    }
  }

  async textSearch(params: TextSearchParams): Promise<NearbySearchResponse> {
    const debugBase = {
      endpoint: "text_search",
    } satisfies Pick<PlacesSearchDebug, "endpoint">;
    try {
      const url = new URL(TEXT_SEARCH_URL);
      url.searchParams.set("query", params.query);
      url.searchParams.set("key", this.apiKey);

      const response = await fetch(url);
      const data = (await response.json()) as GoogleResponse<GooglePlaceResult>;
      const debug: PlacesSearchDebug = {
        ...debugBase,
        httpStatus: response.status,
        googleStatus: data.status,
        error_message: data.error_message,
        resultsCount: data.results?.length ?? 0,
      };

      logger.info(
        {
          requestId: params.requestId,
          endpoint: debug.endpoint,
          httpStatus: debug.httpStatus,
          googleStatus: debug.googleStatus,
          error_message: debug.error_message,
          resultsCount: debug.resultsCount,
        },
        "Google text search response",
      );

      if (data.status !== "OK" || !data.results) {
        logger.error(
          { status: data.status, err: data.error_message },
          "Google text search failed",
        );
        return { results: [], debug };
      }

      const results = data.results
        .map((result) => normalizePlaceResult(result))
        .filter((result): result is PlaceCandidate => result !== null);
      return { results, debug: { ...debug, resultsCount: results.length } };
    } catch (err) {
      logger.info(
        {
          requestId: params.requestId,
          endpoint: debugBase.endpoint,
          httpStatus: undefined,
          googleStatus: undefined,
          error_message: err instanceof Error ? err.message : String(err),
          resultsCount: 0,
        },
        "Google text search response",
      );
      logger.error({ err }, "Google text search threw an error");
      return { results: [], debug: { ...debugBase, resultsCount: 0 } };
    }
  }

  async placeDetails(placeId: string): Promise<PlaceDetails | null> {
    try {
      const url = new URL(PLACE_DETAILS_URL);
      url.searchParams.set("place_id", placeId);
      url.searchParams.set("fields", PLACE_DETAILS_FIELDS);
      url.searchParams.set("key", this.apiKey);

      const response = await fetch(url);
      const data = (await response.json()) as GoogleResponse<GooglePlaceResult>;

      if (data.status !== "OK" || !data.result) {
        logger.error(
          { status: data.status, err: data.error_message },
          "Google place details failed",
        );
        return null;
      }

      return normalizePlaceResult(data.result);
    } catch (err) {
      logger.error({ err }, "Google place details threw an error");
      return null;
    }
  }
}

const normalizePlaceResult = (result: GooglePlaceResult): PlaceCandidate | null => {
  const location = result.geometry?.location;
  if (!location) {
    return null;
  }

  return {
    placeId: result.place_id,
    name: result.name,
    lat: location.lat,
    lng: location.lng,
    rating: result.rating,
    userRatingsTotal: result.user_ratings_total,
    priceLevel: result.price_level,
    types: result.types,
    address: result.formatted_address ?? result.vicinity,
    mapsUrl: result.url,
    openNow: result.opening_hours?.open_now,
  };
};
