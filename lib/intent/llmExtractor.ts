import { randomUUID } from "crypto";
import { z } from "zod";
import { callOpenAI } from "../agent/openaiClient";
import { logger } from "../logger";
import { getLLMSettings } from "../settings/llm";

export type LlmExtract = {
  language: string;
  intent:
    | "search"
    | "refine"
    | "place_followup"
    | "list_qna"
    | "smalltalk"
    | "needs_location";
  keyword: string | null;
  keyword_en?: string | null;
  location_text: string | null;
  place_name: string | null;
  radius_m: number | null;
  followup_type?:
    | "highest_rating"
    | "closest"
    | "most_reviews"
    | "recommend_one"
    | "top_n"
    | "compare"
    | null;
  top_n?: number | null;
  confidence: number;
};

type LlmExtractorInput = {
  message: string;
  locale?: string;
  hasDeviceCoords: boolean;
  lastPlacesCount?: number;
};

type LlmExtractorDeps = {
  callLlm?: typeof callOpenAI;
  getSettings?: typeof getLLMSettings;
};

const extractSchema = z.object({
  language: z.string(),
  intent: z.enum([
    "search",
    "refine",
    "place_followup",
    "list_qna",
    "smalltalk",
    "needs_location",
  ]),
  keyword: z.string().nullable(),
  keyword_en: z.string().nullable().optional(),
  location_text: z.string().nullable(),
  place_name: z.string().nullable(),
  radius_m: z.number().nullable(),
  followup_type: z
    .enum([
      "highest_rating",
      "closest",
      "most_reviews",
      "recommend_one",
      "top_n",
      "compare",
    ])
    .nullable()
    .optional(),
  top_n: z.number().nullable().optional(),
  confidence: z.number().min(0).max(1),
});

const SYSTEM_PROMPT = [
  "You are a strict JSON extractor for food recommendations in ANY language (including Burmese).",
  "Return ONLY valid JSON. No markdown. No commentary.",
  "Schema:",
  "{",
  '  "language": "string ISO-ish, e.g. my,en,th,zh",',
  '  "intent": "search|refine|place_followup|list_qna|smalltalk|needs_location",',
  '  "keyword": "string|null (food/cuisine/place type)",',
  '  "keyword_en": "string|null (English translation if keyword is not English)",',
  '  "location_text": "string|null (explicit place name in text)",',
  '  "place_name": "string|null (explicit venue name)",',
  '  "radius_m": "number|null",',
  '  "followup_type": "highest_rating|closest|most_reviews|recommend_one|top_n|compare|null",',
  '  "top_n": "number|null",',
  '  "confidence": "number 0..1"',
  "}",
  "Rules:",
  "- Detect if the user is asking for food recommendations.",
  "- Extract location_text only if explicitly mentioned in any language (near/in/at ...).",
  "- If the user asks which is highest rated/closest/most reviews/recommend one/top N, set intent=list_qna and followup_type.",
  "- If the user is only refining previous results, set intent=refine.",
  "- If the user is asking about a specific place, set intent=place_followup and place_name.",
  "- If the user is chatting unrelated to food, set intent=smalltalk.",
  "- If the user wants recommendations but no location is provided and device coords are unavailable, set intent=needs_location.",
].join("\n");

const normalizeString = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const buildFallback = (message: string): LlmExtract => ({
  language: "unknown",
  intent: "search",
  keyword: message.trim().slice(0, 60) || null,
  location_text: null,
  place_name: null,
  radius_m: null,
  confidence: 0.2,
});

export async function extractWithLLM(
  input: LlmExtractorInput,
  deps: LlmExtractorDeps = {},
): Promise<LlmExtract> {
  const requestId = randomUUID();
  let settings: Awaited<ReturnType<typeof getLLMSettings>>;
  try {
    const settingsLoader = deps.getSettings ?? getLLMSettings;
    settings = await settingsLoader();
  } catch (err) {
    logger.warn({ err, requestId }, "Failed to load LLM settings for extractor");
    return buildFallback(input.message);
  }

  const extractorEnabled = settings.llmEnabled || Boolean(process.env.OPENAI_API_KEY);
  if (!extractorEnabled) {
    return buildFallback(input.message);
  }

  const payload = {
    message: input.message,
    locale: input.locale ?? null,
    has_device_coords: input.hasDeviceCoords,
    last_places_count: input.lastPlacesCount ?? 0,
  };

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: JSON.stringify(payload) },
  ];

  const timeoutMs = Number(process.env.LLM_EXTRACTOR_TIMEOUT_MS ?? 3000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (deps.callLlm ?? callOpenAI)({
      messages,
      toolsDisabled: true,
      settings: {
        ...settings,
        reasoningEffort: "low",
        verbosity: "low",
      },
      timeoutMs,
      signal: controller.signal,
      requestId,
      temperature: 0.1,
    });
    const parsedJson = JSON.parse(response.assistantText ?? "");
    const parsed = extractSchema.safeParse(parsedJson);
    if (!parsed.success) {
      logger.warn(
        { requestId, error: parsed.error.flatten() },
        "LLM extractor schema mismatch; using fallback",
      );
      return buildFallback(input.message);
    }

    const normalized: LlmExtract = {
      ...parsed.data,
      keyword: normalizeString(parsed.data.keyword),
      keyword_en: normalizeString(parsed.data.keyword_en),
      location_text: normalizeString(parsed.data.location_text),
      place_name: normalizeString(parsed.data.place_name),
      radius_m: parsed.data.radius_m ?? null,
      followup_type: parsed.data.followup_type ?? null,
      top_n: parsed.data.top_n ?? null,
    };

    return normalized;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.warn({ err, requestId }, "LLM extractor timed out; using fallback");
    } else {
      logger.warn({ err, requestId }, "LLM extractor failed; using fallback");
    }
    return buildFallback(input.message);
  } finally {
    clearTimeout(timeout);
  }
}
