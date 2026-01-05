export type Budget = "cheap" | "mid" | "high";

export type UserPrefs = {
  cuisine?: string[];
  budget?: Budget;
  vibe?: string[];
  dietary?: string[];
};
