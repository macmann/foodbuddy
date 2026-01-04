import { prisma } from "../db";
import { logger } from "../logger";
import { ALLOWED_MODELS, DEFAULT_MODEL, isAllowedModel } from "../agent/model";

const DEFAULT_SYSTEM_PROMPT = `You are FoodBuddy, a helpful local food assistant.

Required behavior:
- Ask one clarifying question if cuisine is given but location/radius is missing and no lat/lng is available.
- If lat/lng is present and the user asks for restaurants/food/cafes, call the nearby_search tool BEFORE answering.
- If nearby_search is unavailable or fails, call recommend_places to use internal rankings.
- Do not hallucinate places. Use tools for factual data.
- Always respond with JSON only, matching this schema:
  {
    "intent": "string (short intent summary)",
    "query": "string (search query to use)",
    "radius_m": number | null,
    "open_now": boolean | null,
    "cuisine": "string | null",
    "must_call_tools": boolean,
    "final_answer_text": "string (friendly response shown to the user)"
  }
- Set must_call_tools=true for food/restaurant requests.`;

const DEFAULT_LLM_ENABLED = false;
const DEFAULT_PROVIDER = "openai";
const DEFAULT_REASONING_EFFORT = "medium";
const DEFAULT_VERBOSITY = "medium";
const MAX_PROMPT_LENGTH = 10_000;

const CACHE_TTL_MS = 45_000;

const allowedReasoningEfforts = ["low", "medium", "high"] as const;
const allowedVerbosityLevels = ["low", "medium", "high"] as const;

export type ReasoningEffort = (typeof allowedReasoningEfforts)[number];
export type Verbosity = (typeof allowedVerbosityLevels)[number];

type ModelCapabilities = {
  supportsTemperature: boolean;
};

const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  "gpt-5-mini": { supportsTemperature: false },
  "gpt-5.2": { supportsTemperature: false },
};

type LLMSettingsValue = {
  llmEnabled: boolean;
  llmProvider: string;
  llmModel: string;
  llmSystemPrompt: string;
  reasoningEffort: ReasoningEffort;
  verbosity: Verbosity;
  isFallback?: boolean;
};

export const normalizeVerbosity = (input?: string): Verbosity | undefined => {
  if (input === undefined) {
    return undefined;
  }
  const normalized = input.trim().toLowerCase();
  if (allowedVerbosityLevels.includes(normalized as Verbosity)) {
    return normalized as Verbosity;
  }
  return undefined;
};

export const asReasoningEffort = (input?: string | null): ReasoningEffort | undefined => {
  if (!input) {
    return undefined;
  }
  const normalized = input.trim().toLowerCase();
  if (allowedReasoningEfforts.includes(normalized as ReasoningEffort)) {
    return normalized as ReasoningEffort;
  }
  return undefined;
};

export const asVerbosity = (input?: string | null): Verbosity | undefined => {
  if (!input) {
    return undefined;
  }
  const normalized = input.trim().toLowerCase();
  if (allowedVerbosityLevels.includes(normalized as Verbosity)) {
    return normalized as Verbosity;
  }
  return undefined;
};

export const modelSupportsTemperature = (model: string): boolean =>
  MODEL_CAPABILITIES[model]?.supportsTemperature ?? false;

let cachedSettings: { value: LLMSettingsValue; expiresAt: number } | null = null;

const envModel = (() => {
  const candidate = process.env.LLM_MODEL ?? process.env.OPENAI_MODEL;
  if (!candidate) {
    return undefined;
  }
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : undefined;
})();

const envSystemPrompt = (() => {
  const candidate = process.env.LLM_SYSTEM_PROMPT;
  if (!candidate) {
    return undefined;
  }
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : undefined;
})();

const normalizeSettings = (settings?: Partial<LLMSettingsValue>): LLMSettingsValue => {
  const llmEnabled =
    typeof settings?.llmEnabled === "boolean" ? settings.llmEnabled : DEFAULT_LLM_ENABLED;
  const llmProvider =
    typeof settings?.llmProvider === "string" && settings.llmProvider.trim().length > 0
      ? settings.llmProvider.trim()
      : DEFAULT_PROVIDER;
  const llmModel = settings?.llmModel ?? envModel ?? DEFAULT_MODEL;
  const candidatePrompt =
    typeof settings?.llmSystemPrompt === "string"
      ? settings.llmSystemPrompt.trim()
      : envSystemPrompt ?? "";
  const rawPrompt = candidatePrompt.length > 0 ? candidatePrompt : DEFAULT_SYSTEM_PROMPT;
  const llmSystemPrompt =
    rawPrompt.length <= MAX_PROMPT_LENGTH ? rawPrompt : DEFAULT_SYSTEM_PROMPT;
  const reasoningEffort =
    asReasoningEffort(settings?.reasoningEffort) ?? DEFAULT_REASONING_EFFORT;
  const verbosity = asVerbosity(settings?.verbosity) ?? DEFAULT_VERBOSITY;

  if (!isAllowedModel(llmModel)) {
    logger.error({ model: llmModel }, "Invalid LLM model configured; using default");
    return {
      llmEnabled,
      llmProvider,
      llmModel: DEFAULT_MODEL,
      llmSystemPrompt,
      reasoningEffort,
      verbosity,
      isFallback: true,
    };
  }

  return {
    llmEnabled,
    llmProvider,
    llmModel,
    llmSystemPrompt,
    reasoningEffort,
    verbosity,
  };
};

export const getLLMSettings = async (): Promise<LLMSettingsValue> => {
  const now = Date.now();
  if (cachedSettings && cachedSettings.expiresAt > now) {
    return cachedSettings.value;
  }

  try {
    const record = await prisma.lLMSettings.findUnique({
      where: { id: "default" },
    });

    const reasoningEffort = asReasoningEffort(record?.reasoningEffort);
    const verbosity = asVerbosity(record?.verbosity);

    const value = normalizeSettings({
      llmEnabled: record?.llmEnabled ?? undefined,
      llmProvider: record?.llmProvider ?? undefined,
      llmModel: record?.llmModel ?? undefined,
      llmSystemPrompt: record?.llmSystemPrompt ?? undefined,
      reasoningEffort,
      verbosity,
    });

    cachedSettings = { value, expiresAt: now + CACHE_TTL_MS };
    return value;
  } catch (err) {
    logger.error({ err }, "Failed to load LLM settings; using defaults");
    const value = normalizeSettings();
    cachedSettings = { value, expiresAt: now + CACHE_TTL_MS };
    return value;
  }
};

export const resetLLMSettingsCache = () => {
  cachedSettings = null;
};

export const LLM_SETTINGS_DEFAULTS = {
  llmEnabled: DEFAULT_LLM_ENABLED,
  llmProvider: DEFAULT_PROVIDER,
  llmModel: DEFAULT_MODEL,
  llmSystemPrompt: DEFAULT_SYSTEM_PROMPT,
  reasoningEffort: DEFAULT_REASONING_EFFORT,
  verbosity: DEFAULT_VERBOSITY,
};

export const LLM_MODEL_ALLOWLIST = [...ALLOWED_MODELS];
export const LLM_REASONING_ALLOWLIST = [...allowedReasoningEfforts];
export const LLM_VERBOSITY_ALLOWLIST = [...allowedVerbosityLevels];
export const LLM_PROMPT_MAX_LENGTH = MAX_PROMPT_LENGTH;
export const LLM_MODEL_CAPABILITIES = { ...MODEL_CAPABILITIES };
