import assert from "node:assert/strict";
import test from "node:test";

import { mergePrefs, normalizeBudget } from "./prefs";

test("normalizeBudget maps messy inputs to canonical values", () => {
  assert.equal(normalizeBudget("Expensive"), "high");
  assert.equal(normalizeBudget("budget"), "cheap");
  assert.equal(normalizeBudget("midrange"), "mid");
  assert.equal(normalizeBudget("unknown"), undefined);
});

test("mergePrefs normalizes budget and rejects unknown values", () => {
  const existing = { cuisine: ["thai"], budget: "mid" as const };

  const normalized = mergePrefs(existing, { budget: "pricey" });
  assert.equal(normalized.budget, "high");

  const ignored = mergePrefs(existing, { budget: "whatever" });
  assert.equal(ignored.budget, "mid");
});
