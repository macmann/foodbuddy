import { getConfig } from "../config";
import type { PlacesProvider } from "./provider";
import { GoogleApiProvider } from "./googleApiProvider";
import { ComposioMcpProvider } from "./composioMcpProvider";

export const getPlacesProvider = (): PlacesProvider => {
  const config = getConfig();
  if (config.GOOGLE_PROVIDER === "MCP") {
    return new ComposioMcpProvider();
  }

  return new GoogleApiProvider(config.GOOGLE_MAPS_API_KEY!);
};

export type { Coordinates, NearbySearchParams, PlaceCandidate, PlaceDetails } from "./types";
export type { PlacesProvider } from "./provider";
