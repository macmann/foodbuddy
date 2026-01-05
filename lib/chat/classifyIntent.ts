import { callOpenAI, type LlmMessage } from "../agent/openaiClient";
import { getLLMSettings } from "../settings/llm";
import { logger } from "../logger";
import type { SessionMemory } from "./sessionMemory";

export type ClassifiedIntent = {
  intent: "search" | "refine" | "place_followup" | "smalltalk" | "needs_location";
  extracted: {
    cuisine?: string;
    dish?: string;
    placeName?: string;
    vibe?: string;
    budget?: "cheap" | "mid" | "high";
    dietary?: string;
    radius?: number;
  };
};

type LlmExtractorDeps = {
  callLlm?: typeof callOpenAI;
};

const normalize = (message: string) => message.trim().toLowerCase();

const SMALLTALK_PATTERNS = [
  /\bthanks\b/,
  /\bthank you\b/,
  /\bhello\b/,
  /\bhi\b/,
  /\bhey\b/,
  /\bhow are you\b/,
  /\bwhat do you like\b/,
];

const REFINE_PATTERNS = [
  /\bcheaper\b/,
  /\bcloser\b/,
  /\bmore like\b/,
  /\bspicy\b/,
  /\bfamily\b/,
  /\bquiet\b/,
  /\bnot crowded\b/,
  /\bopen now\b/,
];

const FOLLOWUP_PATTERNS = [
  /\btell me about\b/,
  /\bhow about\b/,
  /\bis\s+.+\s+good\b/,
  /\bdetails on\b/,
];

const LOCATION_HINTS = [
  /\bnear\b/,
  /\bnearby\b/,
  /\baround\b/,
  /\bin\s+[a-z]/,
  /\bat\s+[a-z]/,
];

const CUISINE_TERMS = [
  "sushi",
  "pizza",
  "noodles",
  "ramen",
  "coffee",
  "cafe",
  "thai",
  "korean",
  "indian",
  "burmese",
  "dim sum",
  "hotpot",
  "burger",
];

const BUDGET_TERMS: Array<{ term: string; value: "cheap" | "mid" | "high" }> = [
  { term: "cheap", value: "cheap" },
  { term: "budget", value: "cheap" },
  { term: "affordable", value: "cheap" },
  { term: "mid", value: "mid" },
  { term: "moderate", value: "mid" },
  { term: "expensive", value: "high" },
  { term: "high-end", value: "high" },
];

const VIBE_TERMS = ["cozy", "quiet", "romantic", "family-friendly", "lively"];
const DIETARY_TERMS = ["vegan", "vegetarian", "halal", "gluten-free"];

const hasAny = (message: string, patterns: RegExp[]) =>
  patterns.some((pattern) => pattern.test(message));

const extractFirstMatch = (message: string, terms: string[]) =>
  terms.find((term) => message.includes(term));

const extractRadius = (message: string) => {
  const kmMatch = message.match(/(\d+(?:\.\d+)?)\s*km/);
  if (kmMatch) {
    return Math.round(Number(kmMatch[1]) * 1000);
  }
  const meterMatch = message.match(/(\d+)\s*m\b/);
  if (meterMatch) {
    return Number(meterMatch[1]);
  }
  return undefined;
};

const extractPlaceName = (message: string) => {
  const patterns = [
    /tell me about\s+(.+)/,
    /how about\s+(.+)/,
    /details on\s+(.+)/,
    /is\s+(.+)\s+good/,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) {
      return match[1].trim().replace(/[?.!]+$/, "");
    }
  }
  return undefined;
};

const extractBudget = (message: string) => {
  const match = BUDGET_TERMS.find((item) => message.includes(item.term));
  return match?.value;
};

const extractVibe = (message: string) => extractFirstMatch(message, VIBE_TERMS);
const extractDietary = (message: string) => extractFirstMatch(message, DIETARY_TERMS);
const extractCuisine = (message: string) => extractFirstMatch(message, CUISINE_TERMS);

const isSearchQuery = (message: string) =>
  /\b(find|recommend|suggest|where|best|top|good)\b/.test(message) ||
  CUISINE_TERMS.some((term) => message.includes(term));

const parseLlmJson = (payload: string) => {
  try {
    return JSON.parse(payload) as ClassifiedIntent;
  } catch {
    return null;
  }
};

const buildNeedsLocation = (session?: SessionMemory | null, message?: string) => {
  const normalized = message ? normalize(message) : "";
  const hasLocation = hasAny(normalized, LOCATION_HINTS);
  return !session?.lastResolvedLocation && !hasLocation;
};

export const classifyIntent = async (
  userMessage: string,
  session?: SessionMemory | null,
  deps?: LlmExtractorDeps,
): Promise<ClassifiedIntent> => {
  const normalized = normalize(userMessage);
  const extracted = {
    cuisine: extractCuisine(normalized),
    dish: undefined as string | undefined,
    placeName: extractPlaceName(normalized),
    vibe: extractVibe(normalized),
    budget: extractBudget(normalized),
    dietary: extractDietary(normalized),
    radius: extractRadius(normalized),
  };

  if (!normalized) {
    return { intent: "smalltalk", extracted: {} };
  }

  if (hasAny(normalized, SMALLTALK_PATTERNS)) {
    return { intent: "smalltalk", extracted };
  }

  if (hasAny(normalized, REFINE_PATTERNS)) {
    return { intent: "refine", extracted };
  }

  if (hasAny(normalized, FOLLOWUP_PATTERNS) || extracted.placeName) {
    return { intent: "place_followup", extracted };
  }

  if (isSearchQuery(normalized)) {
    const needsLocation = buildNeedsLocation(session, normalized);
    return { intent: needsLocation ? "needs_location" : "search", extracted };
  }

  const settings = await getLLMSettings();
  if (!settings.llmEnabled || settings.isFallback) {
    return { intent: "smalltalk", extracted };
  }

  const systemPrompt = [
    "Return JSON only that matches this schema:",
    '{ "intent": "search|refine|place_followup|smalltalk|needs_location",',
    '  "extracted": { "cuisine": string|null, "dish": string|null, "placeName": string|null,',
    '  "vibe": string|null, "budget": "cheap|mid|high"|null, "dietary": string|null, "radius": number|null } }',
    "Use needs_location when the user wants recommendations but no location is provided.",
  ].join("\n");

  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Message: ${userMessage}\nHas location on file: ${Boolean(
        session?.lastResolvedLocation,
      )}`,
    },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await (deps?.callLlm ?? callOpenAI)({
      messages,
      toolsDisabled: true,
      settings,
      signal: controller.signal,
      timeoutMs: 1500,
    });
    const parsed = parseLlmJson(response.assistantText ?? "");
    if (parsed) {
      return parsed;
    }
  } catch (err) {
    logger.warn({ err }, "Intent classifier LLM call failed");
  } finally {
    clearTimeout(timeout);
  }

  return { intent: "smalltalk", extracted };
};
