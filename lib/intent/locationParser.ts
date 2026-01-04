import { randomUUID } from "crypto";
import { callOpenAI, type LlmMessage } from "../agent/openaiClient";
import { logger } from "../logger";
import { getLLMSettings } from "../settings/llm";
import { buildFoodIncludedTypes, normalizeIncludedTypes } from "../places/foodFilter";
import { locationParseSchema, type LocationParse } from "./locationParseSchema";

export type LocationParserInput = {
  message: string;
  coords?: { lat: number; lng: number } | null;
  channel?: string;
  locale?: string | null;
  countryHint?: string | null;
  lastQuery?: string | null;
  lastRadiusM?: number | null;
  requestId?: string;
};

type LocationParserDeps = {
  callLlm?: typeof callOpenAI;
  getSettings?: typeof getLLMSettings;
};

const parserSystemPrompt = [
  "You are a parser. Output JSON ONLY that matches the schema. Do not include extra keys.",
  "Schema:",
  "{",
  '  "intent": "nearby_search | text_search | no_location_needed | clarify",',
  '  "query": "string",',
  '  "location_text": "string (only if explicitly stated)",',
  '  "use_device_location": "boolean",',
  '  "radius_m": "number",',
  '  "place_types": "string[]",',
  '  "confidence": "number between 0 and 1",',
  '  "warnings": "string[] (optional)"',
  "}",
  "Rules:",
  "- Only set location_text if explicitly mentioned by the user (e.g., 'in X', 'near X').",
  "- Do NOT output generic words as location_text (place/here/nearby/around/my area/area/this area).",
  "- If device coords are available and no explicit location is mentioned, set use_device_location=true.",
  "- Extract the user's POI keyword(s) to query (e.g., ramen, noodle, coffee).",
  '- Choose place_types based on query: food => ["restaurant"], coffee/tea => ["cafe"], bar => ["bar"], otherwise leave empty.',
].join("\n");

const fallbackPlaceTypes = (query: string): string[] | undefined =>
  buildFoodIncludedTypes(query);

const primaryFallbackKeywords = [
  "noodle",
  "ramen",
  "pizza",
  "coffee",
  "tea",
  "bbq",
  "burger",
];

const stopwords = new Set([
  "i",
  "im",
  "i'm",
  "me",
  "my",
  "near",
  "nearby",
  "around",
  "want",
  "need",
  "looking",
  "find",
  "show",
  "please",
  "a",
  "an",
  "the",
  "to",
  "for",
  "of",
  "place",
  "places",
]);

const LOCATION_DENYLIST = new Set([
  "place",
  "places",
  "here",
  "nearby",
  "around",
  "my area",
  "area",
  "this area",
]);

const normalizeLocationToken = (value: string) =>
  value.toLowerCase().replace(/[.,]/g, "").trim();

const isGenericLocation = (value: string) =>
  LOCATION_DENYLIST.has(normalizeLocationToken(value));

const isAbortError = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

export const sanitizeLocationText = (
  value: string | null | undefined,
): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const withoutQuotes = trimmed.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
  const withoutPunctuation = withoutQuotes.replace(/[?.,!;:]+$/g, "");
  const collapsed = withoutPunctuation.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : undefined;
};

export const fallbackExtractKeyword = (message: string): string => {
  const normalized = message.toLowerCase();
  const primaryMatch = primaryFallbackKeywords.find((keyword) =>
    normalized.includes(keyword),
  );
  if (primaryMatch) {
    return primaryMatch;
  }
  const tokens = normalized
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !stopwords.has(token));
  if (tokens.length === 0) {
    return "restaurant";
  }
  return tokens.slice(0, 2).join(" ");
};

const fallbackExtractLocation = (message: string): string | undefined => {
  const match = message.match(/\b(?:near|in)\s+([^,.\n]+)/i);
  const candidate = match?.[1]?.trim();
  if (!candidate) {
    return undefined;
  }
  if (isGenericLocation(candidate)) {
    return undefined;
  }
  return candidate;
};

const buildFallbackParse = (input: LocationParserInput): LocationParse => {
  const query = fallbackExtractKeyword(input.message);
  const locationText = sanitizeLocationText(fallbackExtractLocation(input.message));
  return {
    intent: input.coords || locationText ? "nearby_search" : "clarify",
    query,
    location_text: locationText,
    use_device_location: Boolean(input.coords) && !locationText,
    radius_m: input.lastRadiusM ?? 1500,
    place_types: fallbackPlaceTypes(query),
    confidence: 0.2,
    warnings: ["llm_parse_fallback"],
  };
};

export const parseLocationWithLLM = async (
  input: LocationParserInput,
  deps: LocationParserDeps = {},
): Promise<LocationParse> => {
  const requestId = input.requestId ?? randomUUID();
  const messagePreview = input.message.slice(0, 200);
  logger.info(
    {
      requestId,
      messagePreview,
      channel: input.channel,
      locale: input.locale,
      hasCoords: Boolean(input.coords),
    },
    "Location parser request",
  );

  let settings: Awaited<ReturnType<typeof getLLMSettings>>;
  try {
    const settingsLoader = deps.getSettings ?? getLLMSettings;
    settings = await settingsLoader();
  } catch (err) {
    logger.warn({ err, requestId }, "Failed to load LLM settings for parser");
    return buildFallbackParse(input);
  }

  const parserEnabled = settings.llmEnabled || Boolean(process.env.OPENAI_API_KEY);
  if (!parserEnabled) {
    logger.info({ requestId }, "LLM parser disabled; using fallback");
    return buildFallbackParse(input);
  }

  const payload = {
    message: input.message,
    device_coords_available: Boolean(input.coords),
    coords: input.coords ?? null,
    channel: input.channel ?? null,
    locale: input.locale ?? null,
    country_hint: input.countryHint ?? null,
    last_query: input.lastQuery ?? null,
    last_radius_m: input.lastRadiusM ?? null,
  };

  const messages: LlmMessage[] = [
    { role: "system", content: parserSystemPrompt },
    { role: "user", content: JSON.stringify(payload) },
  ];

  const timeoutMs = Number(process.env.LOCATION_PARSER_TIMEOUT_MS ?? 5000);
  const parserController = new AbortController();
  const parserTimeout = setTimeout(() => parserController.abort(), timeoutMs);
  try {
    const caller = deps.callLlm ?? callOpenAI;
    const response = await caller({
      messages,
      toolsDisabled: true,
      settings: {
        ...settings,
        llmModel: "gpt-5-mini",
        reasoningEffort: "low",
        verbosity: "low",
      },
      requestId,
      timeoutMs,
      signal: parserController.signal,
      temperature: 0.2,
    });

    const parsedJson = JSON.parse(response.assistantText);
    const parsed = locationParseSchema.safeParse(parsedJson);
    if (!parsed.success) {
      logger.warn(
        { requestId, error: parsed.error.flatten() },
        "Location parser schema mismatch; using fallback",
      );
      return buildFallbackParse(input);
    }

    const normalized = {
      ...parsed.data,
      location_text: sanitizeLocationText(parsed.data.location_text),
      place_types: normalizeIncludedTypes(parsed.data.place_types ?? undefined) ?? undefined,
    } satisfies LocationParse;

    logger.info(
      {
        requestId,
        query: normalized.query,
        location_text: normalized.location_text ?? null,
        use_device_location: normalized.use_device_location,
        confidence: normalized.confidence,
      },
      "Location parser response",
    );

    return normalized;
  } catch (err) {
    if (isAbortError(err)) {
      const fallback = buildFallbackParse(input);
      logger.warn(
        { err, requestId, keyword: fallback.query, timeoutMs },
        "Location parser aborted; fallback keyword",
      );
      return fallback;
    }
    logger.warn({ err, requestId }, "Location parser failed; using fallback");
    return buildFallbackParse(input);
  } finally {
    clearTimeout(parserTimeout);
  }
};
