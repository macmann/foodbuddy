import "server-only";

import { getConfig } from "../config";
import { logger } from "../logger";
import { mcpCall } from "../mcp/client";
import type { ListToolsResult, ToolDefinition } from "../mcp/types";
import type { PlacesProvider } from "./provider";
import type { Coordinates, NearbySearchParams, PlaceCandidate, PlaceDetails } from "./types";

type ToolResolution = {
  geocode: ToolDefinition;
  nearbySearch: ToolDefinition;
  placeDetails: ToolDefinition;
};

type Cached<T> = {
  expiresAt: number;
  value: T;
};

const TOOLS_TTL_MS = 5 * 60 * 1000;
const RETRY_DELAY_MS = 400;
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const buildRequestId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let toolsCache: Cached<ToolDefinition[]> | null = null;
let toolResolutionCache: Cached<ToolResolution> | null = null;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getSchemaProperties = (schema?: Record<string, unknown>): string[] => {
  if (!schema) {
    return [];
  }
  const properties = (schema as { properties?: Record<string, unknown> }).properties;
  if (!properties || typeof properties !== "object") {
    return [];
  }
  return Object.keys(properties);
};

const matchSchemaKey = (schema: Record<string, unknown> | undefined, candidates: string[]) => {
  const keys = getSchemaProperties(schema);
  const lowerKeys = keys.map((key) => key.toLowerCase());
  for (const candidate of candidates) {
    const candidateLower = candidate.toLowerCase();
    const index = lowerKeys.findIndex((key) => key.includes(candidateLower));
    if (index >= 0) {
      return keys[index];
    }
  }
  return undefined;
};

const hasSchemaProperty = (schema: Record<string, unknown> | undefined, name: string) => {
  const keys = getSchemaProperties(schema);
  return keys.some((key) => key.toLowerCase() === name.toLowerCase());
};

const pickFirstString = (...values: Array<unknown | undefined>) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
};

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const extractLatLng = (payload: unknown): { lat?: number; lng?: number } => {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  const record = payload as Record<string, unknown>;
  const lat = toNumber(record.lat ?? record.latitude ?? record.y);
  const lng = toNumber(record.lng ?? record.lon ?? record.longitude ?? record.x);
  if (lat !== undefined && lng !== undefined) {
    return { lat, lng };
  }

  const location = record.location ?? record.geometry;
  if (location && typeof location === "object") {
    const locationRecord = location as Record<string, unknown>;
    const nestedLocation =
      (locationRecord.location as Record<string, unknown> | undefined) ?? locationRecord;
    return extractLatLng(nestedLocation);
  }

  return {};
};

const buildMapsUrl = (name: string, lat?: number, lng?: number): string => {
  const query = lat !== undefined && lng !== undefined ? `${name} ${lat},${lng}` : name;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
};

const normalizePlace = (payload: Record<string, unknown>): PlaceCandidate | null => {
  const placeId = pickFirstString(
    payload.placeId,
    payload.place_id,
    payload.id,
    payload.placeid,
    (payload as { place?: Record<string, unknown> }).place?.place_id,
  );

  const name = pickFirstString(
    payload.name,
    (payload as { displayName?: { text?: string } }).displayName?.text,
    (payload as { display_name?: string }).display_name,
  );

  const coordinates = extractLatLng(payload);
  const lat = coordinates.lat;
  const lng = coordinates.lng;

  if (!placeId && !name) {
    return null;
  }

  const rating = toNumber(payload.rating ?? payload.google_rating ?? payload.score);
  const userRatingsTotal = toNumber(
    payload.userRatingsTotal ?? payload.user_ratings_total ?? payload.rating_count,
  );
  const priceLevel = toNumber(payload.priceLevel ?? payload.price_level);
  const types = Array.isArray(payload.types)
    ? (payload.types.filter((item) => typeof item === "string") as string[])
    : undefined;
  const address = pickFirstString(
    payload.address,
    payload.formatted_address,
    payload.formattedAddress,
    payload.vicinity,
  );
  const mapsUrl = pickFirstString(payload.mapsUrl, payload.url, payload.googleMapsUri);
  const openNowValue =
    payload.openNow ??
    (payload.open_now as unknown) ??
    (payload.opening_hours as { open_now?: boolean } | undefined)?.open_now ??
    (payload.currentOpeningHours as { openNow?: boolean } | undefined)?.openNow;
  const openNow = typeof openNowValue === "boolean" ? openNowValue : undefined;

  const normalizedPlaceId =
    placeId ?? `${name ?? "place"}-${lat ?? ""}-${lng ?? ""}`.replace(/\s+/g, "-");

  return {
    placeId: normalizedPlaceId,
    name: name ?? "Unknown",
    lat: lat ?? 0,
    lng: lng ?? 0,
    rating,
    userRatingsTotal,
    priceLevel,
    types,
    address,
    mapsUrl: mapsUrl ?? buildMapsUrl(name ?? "place", lat, lng),
    openNow,
  };
};

const extractPlacesArray = (payload: unknown): Record<string, unknown>[] => {
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload)) {
    return payload.filter((item) => item && typeof item === "object") as Record<
      string,
      unknown
    >[];
  }
  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const listCandidates =
      record.results ?? record.places ?? record.candidates ?? record.items ?? record.data;
    if (Array.isArray(listCandidates)) {
      return listCandidates.filter((item) => item && typeof item === "object") as Record<
        string,
        unknown
      >[];
    }
    if (record.result && typeof record.result === "object") {
      return extractPlacesArray(record.result);
    }
  }
  return [];
};

export class ComposioMcpProvider implements PlacesProvider {
  constructor(
    private readonly url = getConfig().COMPOSIO_MCP_URL!,
    private readonly apiKey = getConfig().COMPOSIO_API_KEY!,
  ) {}

  async geocode(text: string): Promise<Coordinates | null> {
    const requestId = buildRequestId();
    try {
      const tools = await this.resolveTools();
      const args = this.buildGeocodeArgs(tools.geocode, text);
      const result = await this.callTool(tools.geocode.name, args, requestId);
      const location = extractLatLng(result ?? {});
      if (location.lat === undefined || location.lng === undefined) {
        return null;
      }
      return {
        lat: location.lat,
        lng: location.lng,
        formattedAddress: pickFirstString(
          (result as { formatted_address?: string })?.formatted_address,
          (result as { formattedAddress?: string })?.formattedAddress,
        ),
      };
    } catch (err) {
      logger.error({ err, requestId }, "Composio MCP geocode failed");
      return null;
    }
  }

  async nearbySearch(params: NearbySearchParams): Promise<PlaceCandidate[]> {
    const requestId = buildRequestId();
    try {
      const tools = await this.resolveTools();
      const args = this.buildNearbySearchArgs(tools.nearbySearch, params);
      const result = await this.callTool(tools.nearbySearch.name, args, requestId);
      const places = extractPlacesArray(result).map(normalizePlace).filter(Boolean) as PlaceCandidate[];
      return places.slice(0, 20);
    } catch (err) {
      logger.error({ err, requestId }, "Composio MCP nearby search failed");
      return [];
    }
  }

  async placeDetails(placeId: string): Promise<PlaceDetails | null> {
    const requestId = buildRequestId();
    try {
      const tools = await this.resolveTools();
      const args = this.buildPlaceDetailsArgs(tools.placeDetails, placeId);
      const result = await this.callTool(tools.placeDetails.name, args, requestId);
      const payload =
        (result as Record<string, unknown> | undefined) ??
        ((result as { result?: Record<string, unknown> })?.result ?? result);
      if (!payload || typeof payload !== "object") {
        return null;
      }
      const normalized = normalizePlace(payload as Record<string, unknown>);
      return normalized ? { ...normalized } : null;
    } catch (err) {
      logger.error({ err, requestId }, "Composio MCP place details failed");
      return null;
    }
  }

  private async resolveTools(): Promise<ToolResolution> {
    const now = Date.now();
    if (toolResolutionCache && toolResolutionCache.expiresAt > now) {
      return toolResolutionCache.value;
    }

    const tools = await this.listTools();
    const findTool = (requirements: string[]) => {
      const found = tools.find((tool) => {
        const name = tool.name.toLowerCase();
        return requirements.every((part) => name.includes(part));
      });
      return found ?? null;
    };

    const geocode =
      findTool(["geocode"]) ??
      tools.find((tool) => tool.name.toLowerCase().includes("geo")) ??
      null;
    const nearbySearch = findTool(["nearby", "search"]) ?? findTool(["maps", "search"]);
    const placeDetails =
      findTool(["place", "details"]) ??
      findTool(["details", "place"]) ??
      tools.find((tool) => tool.name.toLowerCase().includes("details")) ??
      null;

    if (!geocode || !nearbySearch || !placeDetails) {
      const availableNames = tools.map((tool) => tool.name).join(", ");
      throw new Error(
        `Unable to resolve required MCP tools. Available tools: ${availableNames || "(none)"}`,
      );
    }

    const resolution = { geocode, nearbySearch, placeDetails };
    toolResolutionCache = { value: resolution, expiresAt: now + TOOLS_TTL_MS };
    return resolution;
  }

  private async listTools(): Promise<ToolDefinition[]> {
    const now = Date.now();
    if (toolsCache && toolsCache.expiresAt > now) {
      return toolsCache.value;
    }

    const result = await mcpCall<ListToolsResult>({
      url: this.url,
      apiKey: this.apiKey,
      method: "tools/list",
      params: {},
    });

    const tools = Array.isArray(result?.tools) ? result.tools : [];
    toolsCache = { value: tools, expiresAt: now + TOOLS_TTL_MS };
    if (process.env.NODE_ENV === "development") {
      logger.info({ toolCount: tools.length }, "Composio MCP tools listed");
    }
    return tools;
  }

  private buildGeocodeArgs(tool: ToolDefinition, text: string): Record<string, unknown> {
    const schema = tool.inputSchema;
    const textKey =
      matchSchemaKey(schema, ["text", "address", "query", "input"]) ?? "text";
    return { [textKey]: text };
  }

  private buildNearbySearchArgs(
    tool: ToolDefinition,
    params: NearbySearchParams,
  ): Record<string, unknown> {
    const schema = tool.inputSchema;
    const args: Record<string, unknown> = {};

    const latKey = matchSchemaKey(schema, ["lat", "latitude"]);
    const lngKey = matchSchemaKey(schema, ["lng", "lon", "longitude"]);
    const radiusKey = matchSchemaKey(schema, ["radius", "radius_m", "distance"]);
    const keywordKey = matchSchemaKey(schema, ["keyword", "query", "text", "search"]);
    const typeKey = matchSchemaKey(schema, ["type", "types", "included"]);
    const openNowKey = matchSchemaKey(schema, ["open_now", "open", "isopen"]);

    if (hasSchemaProperty(schema, "location") && (!latKey || !lngKey)) {
      args.location = { lat: params.lat, lng: params.lng };
    } else {
      if (latKey) {
        args[latKey] = params.lat;
      }
      if (lngKey) {
        args[lngKey] = params.lng;
      }
    }

    if (radiusKey) {
      args[radiusKey] = params.radiusMeters;
    }

    if (keywordKey && params.keyword) {
      args[keywordKey] = params.keyword;
    }

    if (typeKey) {
      args[typeKey] = "restaurant";
    }

    if (openNowKey && typeof params.openNow === "boolean") {
      args[openNowKey] = params.openNow;
    }

    return args;
  }

  private buildPlaceDetailsArgs(tool: ToolDefinition, placeId: string): Record<string, unknown> {
    const schema = tool.inputSchema;
    const idKey = matchSchemaKey(schema, ["place_id", "placeid", "place", "id"]) ?? "placeId";
    return { [idKey]: placeId };
  }

  private async callTool(
    name: string,
    args: Record<string, unknown>,
    requestId: string,
  ): Promise<unknown | null> {
    const call = () =>
      mcpCall<unknown>({
        url: this.url,
        apiKey: this.apiKey,
        method: "tools/call",
        params: { name, arguments: args },
      });

    try {
      return await call();
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      const isRetryable =
        status !== undefined && RETRYABLE_STATUS.has(status)
          ? true
          : ["AbortError", "TypeError"].includes((err as Error).name);

      if (isRetryable) {
        logger.warn({ requestId, status }, "Composio MCP call retrying once");
        await delay(RETRY_DELAY_MS);
        return call();
      }

      logger.error({ err, requestId }, "Composio MCP call failed");
      throw err;
    }
  }
}
