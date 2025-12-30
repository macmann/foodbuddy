import { prisma } from "../db";
import { logger } from "../logger";
import { ALLOWED_MODELS, DEFAULT_MODEL, isAllowedModel } from "../agent/model";

const DEFAULT_SYSTEM_PROMPT = `You are FoodBuddy, a helpful local food assistant.

Your responsibilities:
- Understand natural language food requests
- Ask for location if missing
- Use tools to find real nearby places
- Explain results conversationally

Rules:
- Do not hallucinate places
- Use tools for factual data
- Ask clarifying questions when needed`;
const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_MAX_TOKENS = 800;

const CACHE_TTL_MS = 45_000;

type LLMSettingsValue = {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  isFallback?: boolean;
};

let cachedSettings: { value: LLMSettingsValue; expiresAt: number } | null = null;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const normalizeSettings = (settings?: Partial<LLMSettingsValue>): LLMSettingsValue => {
  const model = settings?.model ?? DEFAULT_MODEL;
  const systemPrompt = settings?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const temperature =
    typeof settings?.temperature === "number"
      ? clamp(settings.temperature, 0, 1)
      : DEFAULT_TEMPERATURE;
  const maxTokens =
    typeof settings?.maxTokens === "number"
      ? Math.round(clamp(settings.maxTokens, 100, 2000))
      : DEFAULT_MAX_TOKENS;

  if (!isAllowedModel(model)) {
    logger.error({ model }, "Invalid LLM model configured; using default");
    return {
      model: DEFAULT_MODEL,
      systemPrompt,
      temperature,
      maxTokens,
      isFallback: true,
    };
  }

  return {
    model,
    systemPrompt,
    temperature,
    maxTokens,
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
      model: record?.model,
      systemPrompt: record?.systemPrompt,
      temperature: record?.temperature ?? undefined,
      maxTokens: record?.maxTokens ?? undefined,
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
  model: DEFAULT_MODEL,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  temperature: DEFAULT_TEMPERATURE,
  maxTokens: DEFAULT_MAX_TOKENS,
};

export const LLM_MODEL_ALLOWLIST = [...ALLOWED_MODELS];
