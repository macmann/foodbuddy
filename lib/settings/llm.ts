import { prisma } from "../db";
import { logger } from "../logger";
import { ALLOWED_MODELS, DEFAULT_MODEL, isAllowedModel } from "../agent/model";

const DEFAULT_SYSTEM_PROMPT = `You are FoodBuddy, a helpful local food assistant.

Required behavior:
- Ask one clarifying question if cuisine is given but location/radius is missing and no lat/lng is available.
- If lat/lng is present, call the nearby_search tool to find places.
- If nearby_search is unavailable or fails, call recommend_places to use internal rankings.
- Do not hallucinate places. Use tools for factual data.
- Always respond in this format:
  1) Short friendly intro (1-2 sentences).
  2) A numbered list of 3-7 places with Name, Distance (if available), Why it matches (1 line), Price level (if available).
  3) Optional follow-up question (e.g., filters for halal/budget/delivery).`;

const DEFAULT_LLM_ENABLED = false;
const DEFAULT_PROVIDER = "openai";
const DEFAULT_REASONING_EFFORT = "medium";
const DEFAULT_VERBOSITY = "medium";
const MAX_PROMPT_LENGTH = 10_000;

const CACHE_TTL_MS = 45_000;

export type ReasoningEffort = "none" | "medium" | "high" | "xhigh";
export type Verbosity = "low" | "medium" | "high";

type LLMSettingsValue = {
  llmEnabled: boolean;
  llmProvider: string;
  llmModel: string;
  llmSystemPrompt: string;
  reasoningEffort: ReasoningEffort;
  verbosity: Verbosity;
  isFallback?: boolean;
};

let cachedSettings: { value: LLMSettingsValue; expiresAt: number } | null = null;

const allowedReasoningEfforts: ReasoningEffort[] = ["none", "medium", "high", "xhigh"];
const allowedVerbosity: Verbosity[] = ["low", "medium", "high"];

const normalizeSettings = (settings?: Partial<LLMSettingsValue>): LLMSettingsValue => {
  const llmEnabled =
    typeof settings?.llmEnabled === "boolean" ? settings.llmEnabled : DEFAULT_LLM_ENABLED;
  const llmProvider =
    typeof settings?.llmProvider === "string" && settings.llmProvider.trim().length > 0
      ? settings.llmProvider.trim()
      : DEFAULT_PROVIDER;
  const llmModel = settings?.llmModel ?? DEFAULT_MODEL;
  const candidatePrompt =
    typeof settings?.llmSystemPrompt === "string" ? settings.llmSystemPrompt.trim() : "";
  const rawPrompt = candidatePrompt.length > 0 ? candidatePrompt : DEFAULT_SYSTEM_PROMPT;
  const llmSystemPrompt =
    rawPrompt.length <= MAX_PROMPT_LENGTH ? rawPrompt : DEFAULT_SYSTEM_PROMPT;
  const reasoningEffort =
    typeof settings?.reasoningEffort === "string" &&
    allowedReasoningEfforts.includes(settings.reasoningEffort as ReasoningEffort)
      ? (settings.reasoningEffort as ReasoningEffort)
      : DEFAULT_REASONING_EFFORT;
  const verbosity =
    typeof settings?.verbosity === "string" &&
    allowedVerbosity.includes(settings.verbosity as Verbosity)
      ? (settings.verbosity as Verbosity)
      : DEFAULT_VERBOSITY;

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

    const value = normalizeSettings({
      llmEnabled: record?.llmEnabled ?? undefined,
      llmProvider: record?.llmProvider ?? undefined,
      llmModel: record?.llmModel ?? undefined,
      llmSystemPrompt: record?.llmSystemPrompt ?? undefined,
      reasoningEffort: record?.reasoningEffort ?? undefined,
      verbosity: record?.verbosity ?? undefined,
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
export const LLM_VERBOSITY_ALLOWLIST = [...allowedVerbosity];
export const LLM_PROMPT_MAX_LENGTH = MAX_PROMPT_LENGTH;
