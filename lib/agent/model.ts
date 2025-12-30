export const ALLOWED_MODELS = ["gpt-5-mini", "gpt-5.2"] as const;
export type AllowedModel = (typeof ALLOWED_MODELS)[number];

export const DEFAULT_MODEL: AllowedModel = "gpt-5-mini";

export function isAllowedModel(v: unknown): v is AllowedModel {
  return typeof v === "string" && (ALLOWED_MODELS as readonly string[]).includes(v);
}

/**
 * Runtime normalization: never crash at runtime due to a bad DB value.
 * Use this only at runtime (LLM call), not for admin save validation.
 */
export function normalizeModel(v: unknown): AllowedModel {
  if (isAllowedModel(v)) {
    return v;
  }
  return DEFAULT_MODEL;
}
