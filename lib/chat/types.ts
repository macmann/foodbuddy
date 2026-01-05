export type Budget = "cheap" | "mid" | "high";

export type UserPrefs = {
  cuisine?: string[];
  budget?: Budget;
  vibe?: string[];
  dietary?: string[];
};

export type UserPrefsUpdate = {
  cuisine?: string[] | undefined;
  budget?: string | Budget | undefined;
  vibe?: string[] | undefined;
  dietary?: string[] | undefined;
};
