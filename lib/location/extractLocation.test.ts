import assert from "node:assert/strict";
import test from "node:test";

import { extractExplicitLocation } from "./extractLocation";

test("extractExplicitLocation strips explicit city", () => {
  const result = extractExplicitLocation("Chinese food in yangon");

  assert.equal(result.locationText, "yangon");
  assert.match(result.cleanedQuery.toLowerCase(), /chinese food/);
});
