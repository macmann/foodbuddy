import { logger } from "../logger";
import { listMcpTools, mcpCall } from "../mcp/client";
import { extractPlacesFromMcpResult } from "../mcp/placesExtractor";
import { resolveMcpPayloadFromResult } from "../mcp/resultParser";
import { resolveMcpTools } from "../mcp/toolResolver";
import type { ToolDefinition } from "../mcp/types";
import { extractExplicitLocation } from "./extractLocation";

export type ResolvedLocation = {
  lat: number;
  lng: number;
  formattedAddress?: string;
  confidence: "high" | "medium" | "low";
};

export type ExplicitLocationResolution = {
  cleanedQuery: string;
  explicitLocationText: string | null;
  coords: { lat: number; lng: number } | null;
  locationSource: "explicit_text" | "gps" | "none";
  resolvedLocation: ResolvedLocation | null;
};

type LocationResolver = (
  locationText: string,
  requestId: string,
) => Promise<ResolvedLocation | null>;

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

const getPlaceTypes = (place: Record<string, unknown>): string[] => {
  const typesValue = place.types;
  const types =
    Array.isArray(typesValue) && typesValue.length > 0
      ? typesValue.filter((item): item is string => typeof item === "string")
      : [];
  const primaryType =
    typeof place.primaryType === "string" ? [place.primaryType] : [];
  return [...types, ...primaryType].map((type) => type.toLowerCase());
};

const buildTextSearchArgs = (tool: ToolDefinition, query: string) => {
  const schema = tool.inputSchema;
  const args: Record<string, unknown> = {};
  const queryKey = matchSchemaKey(schema, ["query", "text", "input", "search"]);
  const fieldMaskKey = matchSchemaKey(schema, ["fieldmask", "field_mask", "fields"]);

  if (queryKey) {
    args[queryKey] = query;
  } else {
    args.query = query;
  }

  if (fieldMaskKey) {
    args[fieldMaskKey] =
      "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType";
  }

  if (hasSchemaProperty(schema, "query") && !queryKey) {
    args.query = query;
  }

  return args;
};

export const resolveLocationToLatLng = async (
  locationText: string,
  requestId: string,
): Promise<ResolvedLocation | null> => {
  const mcpUrl = (process.env.COMPOSIO_MCP_URL ?? "").trim().replace(/^"+|"+$/g, "");
  const composioApiKey = process.env.COMPOSIO_API_KEY ?? "";
  if (!mcpUrl) {
    return null;
  }

  try {
    const tools = await listMcpTools({
      url: mcpUrl,
      apiKey: composioApiKey,
      requestId,
    });
    const resolvedTools = resolveMcpTools(tools);
    const textSearchTool = resolvedTools.textSearch;
    if (!textSearchTool) {
      return null;
    }

    const payload = await mcpCall<unknown>({
      url: mcpUrl,
      apiKey: composioApiKey,
      method: "tools/call",
      params: {
        name: textSearchTool.name,
        arguments: buildTextSearchArgs(textSearchTool, locationText),
      },
      requestId,
    });

    const { payload: parsedPayload } = resolveMcpPayloadFromResult(payload);
    const { places } = extractPlacesFromMcpResult(parsedPayload ?? payload);
    if (places.length === 0) {
      return null;
    }

    const preferredTypes = new Set([
      "locality",
      "administrative_area_level_1",
      "administrative_area_level_2",
      "administrative_area_level_3",
      "sublocality",
      "geocode",
    ]);

    const scored = places
      .map((place) => {
        const coords = extractLatLng(place);
        if (coords.lat === undefined || coords.lng === undefined) {
          return null;
        }
        const types = getPlaceTypes(place);
        const hasPreferredType = types.some((type) => preferredTypes.has(type));
        const formattedAddress =
          pickFirstString(
            place.formattedAddress,
            place.formatted_address,
            place.address,
          ) ?? undefined;
        const score = (hasPreferredType ? 2 : 0) + (types.length > 0 ? 1 : 0);
        const confidence: ResolvedLocation["confidence"] = hasPreferredType
          ? "high"
          : types.length > 0
            ? "medium"
            : "low";
        return {
          score,
          confidence,
          coords: { lat: coords.lat, lng: coords.lng },
          formattedAddress,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best) {
      return null;
    }

    const resolved = {
      lat: best.coords.lat,
      lng: best.coords.lng,
      formattedAddress: best.formattedAddress,
      confidence: best.confidence,
    } satisfies ResolvedLocation;

    logger.info(
      {
        requestId,
        locationText,
        lat: resolved.lat,
        lng: resolved.lng,
        formattedAddress: resolved.formattedAddress,
      },
      "Resolved explicit location",
    );

    return resolved;
  } catch (err) {
    logger.warn({ err, requestId, locationText }, "Explicit location geocode failed");
    return null;
  }
};

export const resolveExplicitLocationForSearch = async ({
  message,
  requestId,
  gpsCoords,
  resolver = resolveLocationToLatLng,
}: {
  message: string;
  requestId: string;
  gpsCoords?: { lat: number; lng: number } | null;
  resolver?: LocationResolver;
}): Promise<ExplicitLocationResolution> => {
  const extracted = extractExplicitLocation(message);
  let coords = gpsCoords ?? null;
  let locationSource: ExplicitLocationResolution["locationSource"] = coords
    ? "gps"
    : "none";
  let resolvedLocation: ResolvedLocation | null = null;

  if (extracted.locationText) {
    resolvedLocation = await resolver(extracted.locationText, requestId);
    if (resolvedLocation) {
      coords = { lat: resolvedLocation.lat, lng: resolvedLocation.lng };
      locationSource = "explicit_text";
    }
  }

  return {
    cleanedQuery: extracted.cleanedQuery,
    explicitLocationText: extracted.locationText,
    coords,
    locationSource,
    resolvedLocation,
  };
};
