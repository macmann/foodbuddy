import { z } from "zod";

import { callOpenAI } from "../agent/openaiClient";
import { DEFAULT_MAX_DISTANCE_MULTIPLIER } from "../geo/constants";
import { filterByMaxDistance } from "../geo/safetyNet";
import { logger } from "../logger";
import { filterFoodPlaces } from "../places/foodFilter";
import { haversineMeters } from "../reco/scoring";
import { getLLMSettings } from "../settings/llm";

type PlaceRecord = Record<string, unknown>;

export type RelevanceRankerDeps = {
  callLlm?: typeof callOpenAI;
  getSettings?: typeof getLLMSettings;
};

export type RelevanceRankerResult = {
  rankedPlaces: PlaceRecord[];
  assistantMessage?: string;
  usedRanker: boolean;
};

const DEFAULT_MAX_RESULTS = 7;

const rankingResponseSchema = z
  .object({
    ranked: z.array(z.union([z.string(), z.number()])),
    rationale: z.string().optional().nullable(),
  })
  .strict();

const cuisineFilterResponseSchema = z
  .object({
    kept: z.array(z.union([z.string(), z.number()])),
  })
  .strict();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const coerceNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const coerceString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const extractLatLng = (payload: PlaceRecord): { lat?: number; lng?: number } => {
  const directLat = coerceNumber(payload.lat ?? payload.latitude ?? payload.y);
  const directLng = coerceNumber(payload.lng ?? payload.lon ?? payload.longitude ?? payload.x);
  if (directLat !== undefined && directLng !== undefined) {
    return { lat: directLat, lng: directLng };
  }

  const location =
    (isRecord(payload.location) ? payload.location : undefined) ??
    (isRecord(payload.geometry) ? payload.geometry : undefined);
  if (location) {
    const inner = isRecord(location.location) ? location.location : location;
    const lat = coerceNumber(inner.lat ?? inner.latitude);
    const lng = coerceNumber(inner.lng ?? inner.lon ?? inner.longitude);
    if (lat !== undefined && lng !== undefined) {
      return { lat, lng };
    }
  }

  return {};
};

const extractPlaceId = (place: PlaceRecord, index: number): string =>
  coerceString(place.placeId ?? place.place_id ?? place.id) ?? `index_${index}`;

const extractPlaceTypes = (place: PlaceRecord): string[] => {
  const types = Array.isArray(place.types)
    ? place.types.filter((item): item is string => typeof item === "string")
    : [];
  const primaryType = typeof place.primaryType === "string" ? [place.primaryType] : [];
  return [...types, ...primaryType];
};

const addHint = (hints: string[], value: unknown) => {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  hints.push(trimmed);
};

const extractMenuHints = (place: PlaceRecord): string[] => {
  const hints: string[] = [];
  if (Array.isArray(place.menuHighlights)) {
    place.menuHighlights.forEach((item) => addHint(hints, item));
  }
  if (Array.isArray(place.menuItems)) {
    place.menuItems.forEach((item) => {
      if (typeof item === "string") {
        addHint(hints, item);
      } else if (isRecord(item)) {
        addHint(hints, item.name ?? item.title ?? item.text);
      }
    });
  }
  if (isRecord(place.editorialSummary)) {
    addHint(hints, place.editorialSummary.text ?? place.editorialSummary.description);
  }
  addHint(hints, place.description);
  addHint(hints, place.summary);
  if (Array.isArray(place.servesCuisine)) {
    place.servesCuisine.forEach((item) => addHint(hints, item));
  } else {
    addHint(hints, place.servesCuisine);
  }

  return Array.from(new Set(hints)).slice(0, 3);
};

const buildFallbackRanking = ({
  places,
  query,
  coords,
  radiusMeters,
  maxResults,
}: {
  places: PlaceRecord[];
  query: string;
  coords?: { lat: number; lng: number };
  radiusMeters?: number;
  maxResults: number;
}): PlaceRecord[] => {
  const filtered = filterFoodPlaces(places, query);
  if (!coords || !radiusMeters || radiusMeters <= 0) {
    return filtered.slice(0, maxResults);
  }

  const maxDistanceMeters = Math.max(
    radiusMeters * DEFAULT_MAX_DISTANCE_MULTIPLIER,
    5_000,
  );
  const safety = filterByMaxDistance(
    coords,
    filtered,
    (place) => {
      const { lat, lng } = extractLatLng(place);
      if (lat === undefined || lng === undefined) {
        return null;
      }
      return { lat, lng };
    },
    maxDistanceMeters,
  );

  return safety.kept.slice(0, maxResults);
};

const normalizeResponseJson = (raw: string): unknown => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const candidate = trimmed.slice(start, end + 1);
    return JSON.parse(candidate);
  }
  return JSON.parse(trimmed);
};

const buildRankingPrompt = ({
  query,
  locationText,
  coords,
  places,
}: {
  query: string;
  locationText?: string;
  coords?: { lat: number; lng: number };
  places: PlaceRecord[];
}) => {
  const summarizedPlaces = places.map((place, index) => {
    const name = coerceString(place.name ?? place.title);
    const address = coerceString(
      place.formattedAddress ??
        place.shortFormattedAddress ??
        place.formatted_address ??
        place.vicinity ??
        place.address,
    );
    const types = Array.isArray(place.types)
      ? place.types.filter((item): item is string => typeof item === "string")
      : undefined;
    const rating = coerceNumber(place.rating ?? place.googleRating);
    const reviewCount = coerceNumber(place.userRatingCount ?? place.user_ratings_total);
    const { lat, lng } = extractLatLng(place);
    const distanceMeters =
      coords && lat !== undefined && lng !== undefined
        ? Math.round(haversineMeters(coords, { lat, lng }))
        : undefined;

    return {
      index,
      id: extractPlaceId(place, index),
      name,
      address,
      rating,
      reviewCount,
      types,
      distance_meters: distanceMeters,
    };
  });

  return {
    query,
    location: {
      text: locationText ?? null,
      coords: coords ?? null,
    },
    places: summarizedPlaces,
  };
};

const buildCuisineFilterPrompt = ({
  query,
  places,
}: {
  query: string;
  places: PlaceRecord[];
}) => {
  const summarizedPlaces = places.map((place, index) => {
    const name = coerceString(place.name ?? place.title);
    const address = coerceString(
      place.formattedAddress ??
        place.shortFormattedAddress ??
        place.formatted_address ??
        place.vicinity ??
        place.address,
    );
    const types = extractPlaceTypes(place);
    const menuHints = extractMenuHints(place);

    return {
      index,
      id: extractPlaceId(place, index),
      name,
      address,
      types,
      menu_hints: menuHints.length > 0 ? menuHints : null,
    };
  });

  return {
    cuisine_intent: query,
    places: summarizedPlaces,
  };
};

const filterPlacesByCuisineWithLlm = async ({
  query,
  places,
  settings,
  requestId,
  callLlm,
}: {
  query: string;
  places: PlaceRecord[];
  settings: Awaited<ReturnType<typeof getLLMSettings>>;
  requestId?: string;
  callLlm: typeof callOpenAI;
}): Promise<PlaceRecord[]> => {
  if (!query.trim() || places.length === 0) {
    return places;
  }

  const systemPrompt = [
    "You are a filtering assistant for cuisine-specific restaurant recommendations.",
    "Return JSON ONLY with this schema:",
    '{ "kept": ["placeId or index"] }',
    "Rules:",
    "- Keep only places that match the cuisine intent.",
    "- If a place might still match, keep it.",
    "- Only use the provided place ids or indices. Do not invent new values.",
    "- Indices are 0-based and correspond to the provided list order.",
  ].join("\n");

  const promptPayload = buildCuisineFilterPrompt({ query, places });

  try {
    const response = await callLlm({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(promptPayload) },
      ],
      toolsDisabled: true,
      settings: {
        ...settings,
        llmModel: settings.llmModel ?? "gpt-5-mini",
        reasoningEffort: "low",
        verbosity: "low",
      },
      requestId,
      temperature: 0,
    });

    const parsedJson = normalizeResponseJson(response.assistantText);
    const parsed = cuisineFilterResponseSchema.safeParse(parsedJson);
    if (!parsed.success) {
      logger.warn(
        { requestId, error: parsed.error.flatten() },
        "Cuisine filter schema mismatch; using original places",
      );
      return places;
    }

    const kept = parsed.data.kept;
    const byId = new Map<string, PlaceRecord>();
    places.forEach((place, index) => {
      byId.set(extractPlaceId(place, index), place);
    });

    const filtered: PlaceRecord[] = [];
    const seen = new Set<PlaceRecord>();
    kept.forEach((entry) => {
      if (typeof entry === "number") {
        const index = Math.trunc(entry);
        if (index >= 0 && index < places.length) {
          const place = places[index];
          if (place && !seen.has(place)) {
            filtered.push(place);
            seen.add(place);
          }
        }
        return;
      }
      const place = byId.get(entry);
      if (place && !seen.has(place)) {
        filtered.push(place);
        seen.add(place);
      }
    });

    return filtered;
  } catch (err) {
    logger.warn({ err, requestId }, "Cuisine filter LLM call failed; using original places");
    return places;
  }
};

const buildRankedList = ({
  places,
  order,
  maxResults,
}: {
  places: PlaceRecord[];
  order: Array<string | number>;
  maxResults: number;
}): PlaceRecord[] => {
  const byId = new Map<string, PlaceRecord>();
  places.forEach((place, index) => {
    byId.set(extractPlaceId(place, index), place);
  });

  const ranked: PlaceRecord[] = [];
  const seen = new Set<PlaceRecord>();

  order.forEach((entry) => {
    if (typeof entry === "number") {
      const index = Math.trunc(entry);
      if (index >= 0 && index < places.length) {
        const place = places[index];
        if (place && !seen.has(place)) {
          ranked.push(place);
          seen.add(place);
        }
      }
      return;
    }
    const place = byId.get(entry);
    if (place && !seen.has(place)) {
      ranked.push(place);
      seen.add(place);
    }
  });

  if (ranked.length < maxResults) {
    places.forEach((place) => {
      if (ranked.length >= maxResults) {
        return;
      }
      if (!seen.has(place)) {
        ranked.push(place);
        seen.add(place);
      }
    });
  }

  return ranked.slice(0, maxResults);
};

export const rankMcpPlacesByRelevance = async (
  {
    query,
    places,
    coords,
    locationText,
    radiusMeters,
    requestId,
    maxResults = DEFAULT_MAX_RESULTS,
  }: {
    query: string;
    places: PlaceRecord[];
    coords?: { lat: number; lng: number };
    locationText?: string;
    radiusMeters?: number;
    requestId?: string;
    maxResults?: number;
  },
  deps: RelevanceRankerDeps = {},
): Promise<RelevanceRankerResult> => {
  if (places.length === 0) {
    const fallbackPlaces = buildFallbackRanking({
      places,
      query,
      coords,
      radiusMeters,
      maxResults,
    });
    return { rankedPlaces: fallbackPlaces, usedRanker: false };
  }

  let settings: Awaited<ReturnType<typeof getLLMSettings>>;
  try {
    settings = await (deps.getSettings ?? getLLMSettings)();
  } catch (err) {
    logger.warn({ err, requestId }, "Failed to load LLM settings for relevance ranker");
    const fallbackPlaces = buildFallbackRanking({
      places,
      query,
      coords,
      radiusMeters,
      maxResults,
    });
    return { rankedPlaces: fallbackPlaces, usedRanker: false };
  }

  const llmAvailable = settings.llmEnabled && (!!deps.callLlm || !!process.env.OPENAI_API_KEY);
  const canCallLlm = deps.callLlm ?? callOpenAI;
  let cuisineFilteredPlaces = places;
  if (llmAvailable) {
    cuisineFilteredPlaces = await filterPlacesByCuisineWithLlm({
      query,
      places,
      settings,
      requestId,
      callLlm: canCallLlm,
    });
  }

  const fallbackPlaces = buildFallbackRanking({
    places: cuisineFilteredPlaces,
    query,
    coords,
    radiusMeters,
    maxResults,
  });

  const rankingEnabled =
    settings.llmEnabled && process.env.LLM_RELEVANCE_RANKING_ENABLED === "true";
  if (!rankingEnabled) {
    return { rankedPlaces: fallbackPlaces, usedRanker: false };
  }

  if (!llmAvailable) {
    logger.warn({ requestId }, "LLM relevance ranker disabled; missing OPENAI_API_KEY");
    return { rankedPlaces: fallbackPlaces, usedRanker: false };
  }

  const systemPrompt = [
    "You are a ranking assistant for restaurant recommendations.",
    "Return JSON ONLY with this schema:",
    '{ "ranked": ["placeId or index"], "rationale": "optional short sentence" }',
    "Rules:",
    "- Rank the places by relevance to the user's question and location context.",
    "- Only use the provided place ids or indices. Do not invent new values.",
    "- If you use indices, they are 0-based and correspond to the provided list order.",
    "- Keep rationale short (max 1 sentence).",
  ].join("\n");

  const promptPayload = buildRankingPrompt({
    query,
    locationText,
    coords,
    places: cuisineFilteredPlaces,
  });

  try {
    const response = await canCallLlm({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(promptPayload) },
      ],
      toolsDisabled: true,
      settings: {
        ...settings,
        llmModel: settings.llmModel ?? "gpt-5-mini",
        reasoningEffort: "low",
        verbosity: "low",
      },
      requestId,
      temperature: 0.2,
    });

    const parsedJson = normalizeResponseJson(response.assistantText);
    const parsed = rankingResponseSchema.safeParse(parsedJson);
    if (!parsed.success) {
      logger.warn(
        { requestId, error: parsed.error.flatten() },
        "Relevance ranker schema mismatch; using fallback",
      );
      return { rankedPlaces: fallbackPlaces, usedRanker: false };
    }

    const rankedPlaces = buildRankedList({
      places: cuisineFilteredPlaces,
      order: parsed.data.ranked,
      maxResults,
    });
    const rationale =
      typeof parsed.data.rationale === "string" ? parsed.data.rationale.trim() : "";

    return {
      rankedPlaces,
      assistantMessage: rationale.length > 0 ? rationale : undefined,
      usedRanker: true,
    };
  } catch (err) {
    logger.warn({ err, requestId }, "Relevance ranker LLM call failed; using fallback");
    return { rankedPlaces: fallbackPlaces, usedRanker: false };
  }
};
