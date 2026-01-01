import { logger } from "../logger";
import { mcpCall } from "../mcp/client";
import type { PlacesProvider } from "./provider";
import type {
  Coordinates,
  NearbySearchParams,
  NearbySearchResponse,
  PlaceCandidate,
  PlaceDetails,
  TextSearchParams,
} from "./types";

type JsonRpcResponse<T> = {
  result?: T;
  error?: { message?: string };
};

export class McpPlacesProvider implements PlacesProvider {
  constructor(private readonly endpoint: string) {}

  async geocode(text: string, requestId?: string): Promise<Coordinates | null> {
    try {
      const result = await this.call<Coordinates | null>("geocode", { text }, requestId);
      return result ?? null;
    } catch (err) {
      logger.error({ err }, "MCP geocode failed");
      return null;
    }
  }

  async nearbySearch(params: NearbySearchParams): Promise<NearbySearchResponse> {
    try {
      const result = await this.call<PlaceCandidate[]>("nearbySearch", params, params.requestId);
      const results = Array.isArray(result) ? result : [];
      return { results };
    } catch (err) {
      logger.error({ err }, "MCP nearby search failed");
      return { results: [] };
    }
  }

  async textSearch(params: TextSearchParams): Promise<NearbySearchResponse> {
    try {
      const result = await this.call<PlaceCandidate[]>("textSearch", params, params.requestId);
      const results = Array.isArray(result) ? result : [];
      return { results };
    } catch (err) {
      logger.error({ err }, "MCP text search failed");
      return { results: [] };
    }
  }

  async placeDetails(placeId: string): Promise<PlaceDetails | null> {
    try {
      const result = await this.call<PlaceDetails | null>("placeDetails", { placeId });
      return result ?? null;
    } catch (err) {
      logger.error({ err }, "MCP place details failed");
      return null;
    }
  }

  private async call<T>(
    method: string,
    params: Record<string, unknown>,
    requestId?: string,
  ): Promise<T | null> {
    const data = await mcpCall<JsonRpcResponse<T>["result"]>({
      url: this.endpoint,
      apiKey: "",
      method,
      params,
      requestId,
    });
    return (data as T | null) ?? null;
  }
}
