import type { Budget, UserPrefs } from "./types";

export type UserPrefsUpdate = Omit<UserPrefs, "budget"> & { budget?: string | null };

const budgetMap: Record<string, Budget> = {
  cheap: "cheap",
  budget: "cheap",
  low: "cheap",
  affordable: "cheap",
  inexpensive: "cheap",
  mid: "mid",
  midrange: "mid",
  moderate: "mid",
  normal: "mid",
  average: "mid",
  high: "high",
  expensive: "high",
  pricey: "high",
  premium: "high",
  luxury: "high",
};

export const normalizeBudget = (input?: string | null): Budget | undefined => {
  if (!input) {
    return undefined;
  }
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return budgetMap[normalized];
};

const mergeStringArrays = (current?: string[], next?: string[]) => {
  const merged = new Set([...(current ?? []), ...(next ?? [])]);
  return merged.size > 0 ? [...merged] : undefined;
};

export const mergePrefs = (
  existing: UserPrefs | undefined,
  update: UserPrefsUpdate,
): UserPrefs => {
  const normalizedExisting = normalizeBudget(existing?.budget ?? null);
  const normalizedUpdate = normalizeBudget(update.budget ?? null);

  return {
    cuisine: mergeStringArrays(existing?.cuisine, update.cuisine),
    vibe: mergeStringArrays(existing?.vibe, update.vibe),
    dietary: mergeStringArrays(existing?.dietary, update.dietary),
    budget: normalizedUpdate ?? normalizedExisting,
  };
};
