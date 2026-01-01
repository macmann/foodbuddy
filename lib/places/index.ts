import type { PlacesProvider } from "./provider";
import { GoogleApiProvider } from "./googleApiProvider";
import { ComposioMcpProvider } from "./composioMcpProvider";

export type PlacesProviderName = "MCP" | "GOOGLE" | "NONE";

export type PlacesProviderSelection = {
  provider: PlacesProvider | null;
  providerName: PlacesProviderName;
  reason?: string;
};

const getProviderEnv = () => {
  const mcpUrl = process.env.COMPOSIO_MCP_URL?.trim() ?? "";
  const mcpKey = process.env.COMPOSIO_API_KEY?.trim() ?? "";
  const googleKey =
    process.env.GOOGLE_MAPS_API_KEY?.trim() ??
    process.env.GOOGLE_API_KEY?.trim() ??
    "";
  return { mcpUrl, mcpKey, googleKey };
};

export const resolvePlacesProvider = (): PlacesProviderSelection => {
  const { mcpUrl, mcpKey, googleKey } = getProviderEnv();
  if (mcpUrl && mcpKey) {
    return {
      provider: new ComposioMcpProvider(mcpUrl, mcpKey),
      providerName: "MCP",
    };
  }
  if (googleKey) {
    return {
      provider: new GoogleApiProvider(googleKey),
      providerName: "GOOGLE",
    };
  }
  return {
    provider: null,
    providerName: "NONE",
    reason: "Missing COMPOSIO_MCP_URL/COMPOSIO_API_KEY and GOOGLE_MAPS_API_KEY.",
  };
};

export const getPlacesProvider = (): PlacesProvider => {
  const selection = resolvePlacesProvider();
  if (!selection.provider) {
    throw new Error(selection.reason ?? "Places provider is not configured.");
  }
  return selection.provider;
};

export type { Coordinates, NearbySearchParams, PlaceCandidate, PlaceDetails } from "./types";
export type { PlacesProvider } from "./provider";
