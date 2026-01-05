import type { Budget, UserPrefs, UserPrefsUpdate } from "./types";

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

export const normalizeBudget = (
  input?: string | Budget | null,
): Budget | undefined => {
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
  current: UserPrefs | undefined,
  update: UserPrefsUpdate,
): UserPrefs => {
  const nextBudget =
    normalizeBudget(update.budget ?? undefined) ?? current?.budget;

  return {
    cuisine: mergeStringArrays(current?.cuisine, update.cuisine),
    vibe: mergeStringArrays(current?.vibe, update.vibe),
    dietary: mergeStringArrays(current?.dietary, update.dietary),
    budget: nextBudget,
  };
};
