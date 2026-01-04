import { randomUUID } from "crypto";
import { logger } from "../logger";
import { listMcpTools, mcpCall } from "../mcp/client";
import { resolveMcpPayloadFromResult } from "../mcp/resultParser";
import { resolveMcpTools } from "../mcp/toolResolver";
import type { ToolDefinition } from "../mcp/types";

type GeocodeResult = {
  coords: { lat: number; lng: number } | null;
  formattedAddress: string | null;
  error: string | null;
};

type GeocodeContext = {
  locale?: string | null;
  countryHint?: string | null;
  coords?: { lat: number; lng: number } | null;
  requestId?: string;
};

type CacheEntry = { expiresAt: number; value: GeocodeResult };

const CACHE_TTL_MS = 10 * 60_000;
const geocodeCache = new Map<string, CacheEntry>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const coerceNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const pickFirstString = (...values: Array<unknown | undefined>) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
};

const extractLatLng = (payload: unknown): { lat?: number; lng?: number } => {
  if (!isRecord(payload)) {
    return {};
  }
  const record = payload;
  const lat = coerceNumber(record.lat ?? record.latitude ?? record.y);
  const lng = coerceNumber(record.lng ?? record.lon ?? record.longitude ?? record.x);
  if (lat !== undefined && lng !== undefined) {
    return { lat, lng };
  }
  const location = record.location ?? record.geometry;
  if (isRecord(location)) {
    return extractLatLng(location);
  }
  return {};
};

const OTHER_COUNTRY_REGEX =
  /\b(usa|united states|uk|united kingdom|germany|france|italy|spain|australia|canada|japan|korea|thailand|vietnam|singapore|malaysia|indonesia|philippines|china|india|berlin|paris|london|tokyo|new york|los angeles)\b/i;

const isMyanmarLocale = (locale?: string | null) => {
  if (!locale) {
    return false;
  }
  const normalized = locale.toLowerCase();
  return normalized.startsWith("my") || normalized.includes("mm");
};

const isCoordsInMyanmar = (coords?: { lat: number; lng: number } | null) => {
  if (!coords) {
    return false;
  }
  return coords.lat >= 9 && coords.lat <= 29 && coords.lng >= 92 && coords.lng <= 102.5;
};

export const buildGeocodeQuery = (locationText: string, ctx: GeocodeContext): string => {
  const trimmed = locationText.trim();
  if (!trimmed) {
    return trimmed;
  }
  const normalized = trimmed.toLowerCase();
  const mentionsOtherCountry = OTHER_COUNTRY_REGEX.test(normalized);
  if (mentionsOtherCountry) {
    return trimmed;
  }

  const countryHint = ctx.countryHint?.toLowerCase();
  const shouldBias =
    countryHint === "myanmar" ||
    countryHint === "mm" ||
    countryHint === "burma" ||
    isMyanmarLocale(ctx.locale) ||
    isCoordsInMyanmar(ctx.coords);

  if (!shouldBias) {
    return trimmed;
  }

  if (/myanmar|burma/i.test(trimmed)) {
    return trimmed;
  }

  if (/yangon/i.test(trimmed)) {
    return `${trimmed}, Myanmar`;
  }

  return `${trimmed}, Yangon, Myanmar`;
};

const buildGeocodeArgs = (tool: ToolDefinition, locationText: string) => {
  const schema = tool.inputSchema;
  const schemaProperties = isRecord(schema?.properties) ? schema.properties : undefined;
  const keys = schemaProperties ? Object.keys(schemaProperties) : [];
  const lowerKeys = keys.map((key) => key.toLowerCase());
  const matchSchemaKey = (candidates: string[]) => {
    for (const candidate of candidates) {
      const idx = lowerKeys.findIndex((key) => key.includes(candidate));
      if (idx >= 0) {
        return keys[idx];
      }
    }
    return undefined;
  };

  const addressKey =
    matchSchemaKey(["address_query"]) ??
    matchSchemaKey(["address", "query", "text", "input"]) ??
    "address_query";
  return { [addressKey]: locationText };
};

const getCachedResult = (key: string): GeocodeResult | null => {
  const cached = geocodeCache.get(key);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt < Date.now()) {
    geocodeCache.delete(key);
    return null;
  }
  return cached.value;
};

const setCachedResult = (key: string, value: GeocodeResult) => {
  geocodeCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
};

export const geocodeLocationText = async (
  locationText: string,
  ctx: GeocodeContext,
): Promise<GeocodeResult> => {
  const trimmed = locationText.trim();
  if (!trimmed) {
    return { coords: null, formattedAddress: null, error: "Missing location text." };
  }

  const query = buildGeocodeQuery(trimmed, ctx);
  const cacheKey = `${query.toLowerCase()}`;
  const cached = getCachedResult(cacheKey);
  if (cached) {
    return cached;
  }

  const requestId = ctx.requestId ?? randomUUID();
  const mcpUrl = (process.env.COMPOSIO_MCP_URL ?? "").trim().replace(/^"+|"+$/g, "");
  const composioApiKey = process.env.COMPOSIO_API_KEY ?? "";
  if (!mcpUrl) {
    return { coords: null, formattedAddress: null, error: "Missing MCP URL." };
  }

  const tools = await listMcpTools({
    url: mcpUrl,
    apiKey: composioApiKey,
    requestId,
  });
  const resolved = resolveMcpTools(tools);
  const directTool = tools.find(
    (tool) => tool.name.toLowerCase() === "google_maps_geocode_address_with_query",
  );
  const geocodeTool = directTool ?? resolved.geocode;
  if (!geocodeTool) {
    return { coords: null, formattedAddress: null, error: "No geocode tool found." };
  }

  const geocodePayload = await mcpCall<unknown>({
    url: mcpUrl,
    apiKey: composioApiKey,
    method: "tools/call",
    params: { name: geocodeTool.name, arguments: buildGeocodeArgs(geocodeTool, query) },
    requestId,
  });
  const { payload } = resolveMcpPayloadFromResult(geocodePayload);
  const coords = extractLatLng(payload ?? {});
  const formattedAddress =
    pickFirstString(
      (payload as { formatted_address?: string })?.formatted_address,
      (payload as { formattedAddress?: string })?.formattedAddress,
      (payload as { address?: string })?.address,
    ) ?? null;

  if (coords.lat === undefined || coords.lng === undefined) {
    const result = { coords: null, formattedAddress, error: "No coordinates returned." };
    setCachedResult(cacheKey, result);
    return result;
  }

  const result = {
    coords: { lat: coords.lat, lng: coords.lng },
    formattedAddress,
    error: null,
  };
  setCachedResult(cacheKey, result);
  logger.info(
    { requestId, locationText: query, lat: coords.lat, lng: coords.lng },
    "Geocoded location text",
  );
  return result;
};
