import "server-only";

import { logger } from "../logger";
import { invalidateMcpToolsCache, listMcpTools, mcpCall } from "../mcp/client";
import { extractPlacesFromMcpResult } from "../mcp/placesExtractor";
import { resolveMcpPayloadFromResult } from "../mcp/resultParser";
import { resolveMcpTools } from "../mcp/toolResolver";
import type { ToolDefinition } from "../mcp/types";
import type { PlacesProvider } from "./provider";
import type {
  Coordinates,
  NearbySearchParams,
  NearbySearchResponse,
  PlaceCandidate,
  PlaceDetails,
  TextSearchParams,
} from "./types";

type ToolResolution = {
  geocode: ToolDefinition;
  nearbySearch: ToolDefinition;
  placeDetails: ToolDefinition;
  textSearch?: ToolDefinition;
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

const normalizeStringArray = (value: unknown): string[] | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : undefined;
  }
  if (Array.isArray(value)) {
    const normalized = value.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
    return normalized.length > 0 ? normalized : undefined;
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

const buildMapsUrl = (placeId?: string): string | undefined => {
  if (!placeId) {
    return undefined;
  }
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
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
    mapsUrl: mapsUrl ?? buildMapsUrl(placeId ?? undefined),
    openNow,
  };
};

export class ComposioMcpProvider implements PlacesProvider {
  constructor(
    private readonly url: string,
    private readonly apiKey: string,
  ) {
    void this.listTools().catch((err) => {
      logger.debug({ err }, "Composio MCP tool listing warmup failed");
    });
  }

  async geocode(text: string, requestId?: string): Promise<Coordinates | null> {
    const resolvedRequestId = requestId ?? buildRequestId();
    try {
      const tools = await this.resolveTools();
      const args = this.buildGeocodeArgs(tools.geocode, text);
      const result = await this.callTool(tools.geocode.name, args, resolvedRequestId);
      const { payload } = resolveMcpPayloadFromResult(result);
      const location = extractLatLng((payload ?? {}) as Record<string, unknown>);
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
      logger.error({ err, requestId: resolvedRequestId }, "Composio MCP geocode failed");
      return null;
    }
  }

  async nearbySearch(params: NearbySearchParams): Promise<NearbySearchResponse> {
    const requestId = params.requestId ?? buildRequestId();
    try {
      const tools = await this.resolveTools();
      const tool = tools.nearbySearch ?? tools.textSearch;
      if (!tool) {
        throw new Error("No MCP nearby/text search tool resolved.");
      }
      const args =
        tool.name === tools.nearbySearch?.name
          ? this.buildNearbySearchArgs(tool, params)
          : this.buildTextSearchArgs(tool, {
              query: params.keyword ?? "restaurants",
              locationText: undefined,
              location: { lat: params.lat, lng: params.lng },
              radiusMeters: params.radiusMeters,
              maxResultCount: 20,
            });
      const result = await this.callTool(tool.name, args, requestId);
      const { places: rawPlaces } = extractPlacesFromMcpResult(result);
      const places = rawPlaces.map(normalizePlace).filter(Boolean) as PlaceCandidate[];
      return { results: places.slice(0, 20) };
    } catch (err) {
      logger.error({ err, requestId }, "Composio MCP nearby search failed");
      return { results: [] };
    }
  }

  async textSearch(params: TextSearchParams): Promise<NearbySearchResponse> {
    const requestId = params.requestId ?? buildRequestId();
    try {
      const tools = await this.resolveTools();
      const tool = tools.textSearch ?? tools.nearbySearch;
      if (!tool) {
        throw new Error("No MCP text/nearby search tool resolved.");
      }
      const args =
        tool.name === tools.textSearch?.name
          ? this.buildTextSearchArgs(tool, {
              query: params.query,
              locationText: undefined,
              location: { lat: params.lat, lng: params.lng },
              radiusMeters: params.radiusMeters,
              maxResultCount: 20,
            })
          : this.buildNearbySearchArgs(tool, {
              lat: params.lat,
              lng: params.lng,
              radiusMeters: 5000,
              keyword: params.query,
              openNow: undefined,
            });
      const result = await this.callTool(tool.name, args, requestId);
      const { places: rawPlaces } = extractPlacesFromMcpResult(result);
      const places = rawPlaces.map(normalizePlace).filter(Boolean) as PlaceCandidate[];
      return { results: places.slice(0, 20) };
    } catch (err) {
      logger.error({ err, requestId }, "Composio MCP text search failed");
      return { results: [] };
    }
  }

  async placeDetails(placeId: string): Promise<PlaceDetails | null> {
    const requestId = buildRequestId();
    try {
      const tools = await this.resolveTools();
      const args = this.buildPlaceDetailsArgs(tools.placeDetails, placeId);
      const result = await this.callTool(tools.placeDetails.name, args, requestId);
      const { payload } = resolveMcpPayloadFromResult(result);
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
    const resolved = resolveMcpTools(tools);
    const geocode = resolved.geocode ?? null;
    const nearbySearch = resolved.nearbySearch ?? resolved.textSearch ?? null;
    const placeDetails = resolved.placeDetails ?? null;

    if (!geocode || !nearbySearch || !placeDetails) {
      const availableNames = tools.map((tool) => tool.name).join(", ");
      throw new Error(
        `Unable to resolve required MCP tools. Available tools: ${availableNames || "(none)"}`,
      );
    }

    const resolution = {
      geocode,
      nearbySearch,
      placeDetails,
      textSearch: resolved.textSearch,
    };
    toolResolutionCache = { value: resolution, expiresAt: now + TOOLS_TTL_MS };
    return resolution;
  }

  private async listTools(): Promise<ToolDefinition[]> {
    const now = Date.now();
    if (toolsCache && toolsCache.expiresAt > now) {
      return toolsCache.value;
    }

    let tools: ToolDefinition[] = [];
    try {
      tools = await listMcpTools({ url: this.url, apiKey: this.apiKey });
    } catch (err) {
      logger.error({ err }, "Composio MCP tool listing failed");
    }

    toolsCache = { value: tools, expiresAt: now + TOOLS_TTL_MS };
    logger.debug(
      { toolCount: tools.length, toolNames: tools.map((tool) => tool.name) },
      "Composio MCP tools listed",
    );
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
    const keywordKey = matchSchemaKey(schema, [
      "keyword",
      "query",
      "textquery",
      "searchterm",
      "text",
      "search",
    ]);
    const includedTypesKey = matchSchemaKey(schema, [
      "includedtypes",
      "included_types",
      "included",
    ]);
    const excludedTypesKey = matchSchemaKey(schema, [
      "excludedtypes",
      "excluded_types",
      "excluded",
    ]);
    const typeKey = matchSchemaKey(schema, ["type", "types"]);
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

    const requestedIncludedTypes = normalizeStringArray(params.includedTypes);
    const fallbackIncludedTypes =
      requestedIncludedTypes ?? normalizeStringArray("restaurant");
    if (includedTypesKey && fallbackIncludedTypes) {
      args[includedTypesKey] = fallbackIncludedTypes;
    } else if (typeKey && fallbackIncludedTypes) {
      args[typeKey] =
        fallbackIncludedTypes.length === 1
          ? fallbackIncludedTypes[0]
          : fallbackIncludedTypes;
    }

    const excludedTypes = normalizeStringArray(params.excludedTypes);
    if (excludedTypesKey && excludedTypes) {
      args[excludedTypesKey] = excludedTypes;
    }

    if (openNowKey && typeof params.openNow === "boolean") {
      args[openNowKey] = params.openNow;
    }

    return args;
  }

  private buildTextSearchArgs(
    tool: ToolDefinition,
    params: {
      query: string;
      locationText?: string;
      location?: { lat: number; lng: number };
      radiusMeters?: number;
      maxResultCount?: number;
    },
  ): Record<string, unknown> {
    const schema = tool.inputSchema;
    const args: Record<string, unknown> = {};
    const queryKey = matchSchemaKey(schema, ["query", "text", "input", "search"]);
    const locationKey = matchSchemaKey(schema, ["location", "near", "bias"]);
    const locationBiasKey = matchSchemaKey(schema, ["locationbias", "location_bias"]);
    const latKey = matchSchemaKey(schema, ["lat", "latitude"]);
    const lngKey = matchSchemaKey(schema, ["lng", "lon", "longitude"]);
    const maxResultsKey = matchSchemaKey(schema, ["maxresultcount", "maxresults", "limit"]);
    const fieldMaskKey = matchSchemaKey(schema, ["fieldmask", "field_mask", "fields"]);

    const queryValue = params.locationText
      ? `${params.query} in ${params.locationText}`
      : params.query;

    if (queryKey) {
      args[queryKey] = queryValue;
    } else {
      args.query = queryValue;
    }

    if (params.location && (latKey || lngKey)) {
      if (latKey) {
        args[latKey] = params.location.lat;
      }
      if (lngKey) {
        args[lngKey] = params.location.lng;
      }
    } else if (params.location && hasSchemaProperty(schema, "location")) {
      args.location = { lat: params.location.lat, lng: params.location.lng };
    } else if (locationKey && params.locationText) {
      args[locationKey] = params.locationText;
    }

    if (params.location && typeof params.radiusMeters === "number" && locationBiasKey) {
      args[locationBiasKey] = {
        circle: {
          center: {
            latitude: params.location.lat,
            longitude: params.location.lng,
          },
          radius: params.radiusMeters,
        },
      };
    }

    if (maxResultsKey && params.maxResultCount) {
      args[maxResultsKey] = params.maxResultCount;
    }

    if (fieldMaskKey) {
      args[fieldMaskKey] =
        "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.googleMapsUri";
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
        requestId,
      });

    try {
      return await call();
    } catch (err) {
      const message = err instanceof Error ? err.message.toLowerCase() : "";
      if (message.includes("unknown tool") || message.includes("tool not found")) {
        invalidateMcpToolsCache({ url: this.url, apiKey: this.apiKey });
        toolsCache = null;
        toolResolutionCache = null;
      }
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
