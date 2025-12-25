import { logger } from "../logger";
import type { PlacesProvider } from "./provider";
import type { Coordinates, NearbySearchParams, PlaceCandidate, PlaceDetails } from "./types";

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
    } catch (error) {
      logger.error({ error }, "MCP geocode failed");
      return null;
    }
  }

  async nearbySearch(params: NearbySearchParams): Promise<PlaceCandidate[]> {
    try {
      const result = await this.call<PlaceCandidate[]>("nearbySearch", params);
      return Array.isArray(result) ? result : [];
    } catch (error) {
      logger.error({ error }, "MCP nearby search failed");
      return [];
    }
  }

  async placeDetails(placeId: string): Promise<PlaceDetails | null> {
    try {
      const result = await this.call<PlaceDetails | null>("placeDetails", { placeId });
      return result ?? null;
    } catch (error) {
      logger.error({ error }, "MCP place details failed");
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
      logger.error({ error: data.error }, "MCP response error");
      return null;
    }

    return data.result ?? null;
  }
}
