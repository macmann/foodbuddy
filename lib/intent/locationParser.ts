import { randomUUID } from "crypto";
import { callOpenAI, type LlmMessage } from "../agent/openaiClient";
import { logger } from "../logger";
import { parseQuery } from "../reco/engine";
import { getLLMSettings } from "../settings/llm";
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
  "- If device coords are available, set use_device_location=true.",
  "- Extract the user's POI keyword(s) to query (e.g., ramen, noodle, coffee).",
  '- Choose place_types based on query: food => ["restaurant"], coffee/tea => ["cafe"], else ["point_of_interest"].',
].join("\n");

const fallbackPlaceTypes = (query: string): string[] => {
  const normalized = query.toLowerCase();
  if (/(coffee|cafe|tea)/.test(normalized)) {
    return ["cafe"];
  }
  if (/(restaurant|food|noodle|ramen|sushi|bbq|pizza|burger|hotpot|dim sum)/.test(normalized)) {
    return ["restaurant"];
  }
  return ["point_of_interest"];
};

const inferKeyword = (message: string): string => {
  const parsed = parseQuery(message);
  const keyword = parsed.keyword?.trim();
  if (keyword && keyword.length > 0) {
    return keyword;
  }
  const cleaned = message.trim();
  return cleaned.length > 0 ? cleaned : "restaurant";
};

const buildFallbackParse = (input: LocationParserInput): LocationParse => {
  const query = inferKeyword(input.message);
  return {
    intent: "nearby_search",
    query,
    location_text: undefined,
    use_device_location: Boolean(input.coords),
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

  const timeoutMs = Number(process.env.LOCATION_PARSER_TIMEOUT_MS ?? 3500);
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
      location_text: parsed.data.location_text ?? undefined,
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
    logger.warn({ err, requestId }, "Location parser failed; using fallback");
    return buildFallbackParse(input);
  }
};
