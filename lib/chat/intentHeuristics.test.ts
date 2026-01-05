import assert from "node:assert/strict";
import test from "node:test";

import { extractLocationTextFallback } from "./intentHeuristics";

test("extractLocationTextFallback finds explicit locations after prepositions", () => {
  assert.equal(extractLocationTextFallback("local food in Kalaw"), "Kalaw");
  assert.equal(extractLocationTextFallback("BBQ around Bagan"), "Bagan");
});

test("extractLocationTextFallback ignores near-me phrasing", () => {
  assert.equal(extractLocationTextFallback("noodle near me"), null);
});
