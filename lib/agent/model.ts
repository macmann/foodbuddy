export const ALLOWED_MODELS = ["gpt-5.2", "gpt-5-mini"] as const;

const DEFAULT_MODEL = "gpt-5-mini";

export const normalizeModel = (input?: string): string => {
  const trimmed = input?.trim() ?? "";
  if (!trimmed) {
    return DEFAULT_MODEL;
  }

  if (!ALLOWED_MODELS.includes(trimmed as (typeof ALLOWED_MODELS)[number])) {
    return DEFAULT_MODEL;
  }

  return trimmed;
};
