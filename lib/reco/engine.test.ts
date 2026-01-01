import assert from "node:assert/strict";
import test from "node:test";

import { parseQuery } from "./engine";

test("parseQuery keeps keyword and location text", () => {
  const parsed = parseQuery("noodle in Thanlyin");
  assert.equal(parsed.keyword, "noodle");
  assert.equal(parsed.locationText, "Thanlyin");
});
