import { logger } from "../logger";
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
  private requestId = 0;

  constructor(private readonly endpoint: string) {}

  async geocode(text: string): Promise<Coordinates | null> {
    try {
      const result = await this.call<Coordinates | null>("geocode", { text });
      return result ?? null;
    } catch (err) {
      logger.error({ err }, "MCP geocode failed");
      return null;
    }
  }

  async nearbySearch(params: NearbySearchParams): Promise<NearbySearchResponse> {
    try {
      const result = await this.call<PlaceCandidate[]>("nearbySearch", params);
      const results = Array.isArray(result) ? result : [];
      return { results };
    } catch (err) {
      logger.error({ err }, "MCP nearby search failed");
      return { results: [] };
    }
  }

  async textSearch(params: TextSearchParams): Promise<NearbySearchResponse> {
    try {
      const result = await this.call<PlaceCandidate[]>("textSearch", params);
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

  private async call<T>(method: string, params: Record<string, unknown>): Promise<T | null> {
    const payload = {
      jsonrpc: "2.0",
      id: ++this.requestId,
      method,
      params,
    };

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logger.error({ status: response.status }, "MCP request failed");
      return null;
    }

    const data = (await response.json()) as JsonRpcResponse<T>;
    if (data.error) {
      logger.error({ err: data.error }, "MCP response error");
      return null;
    }

    return data.result ?? null;
  }
}
