import { config } from "../config";
import type { PlacesProvider } from "./provider";
import { GoogleApiProvider } from "./googleApiProvider";
import { McpPlacesProvider } from "./mcpProvider";

export const getPlacesProvider = (): PlacesProvider => {
  if (config.GOOGLE_PROVIDER === "MCP") {
    return new McpPlacesProvider(config.MCP_GOOGLE_MAPS_URL!);
  }

  return new GoogleApiProvider(config.GOOGLE_MAPS_API_KEY!);
};

export type { Coordinates, NearbySearchParams, PlaceCandidate, PlaceDetails } from "./types";
export type { PlacesProvider } from "./provider";
