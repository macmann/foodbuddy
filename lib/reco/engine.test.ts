import assert from "node:assert/strict";
import test from "node:test";

import { parseQuery } from "./engine";

test("parseQuery extracts location text from 'in' clause", () => {
  const parsed = parseQuery("noodle in thaketa");

  assert.equal(parsed.keyword, "noodle");
  assert.equal(parsed.locationText, "thaketa");
});
