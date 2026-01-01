import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeToJson } from "./json";

test("sanitizeToJson removes functions and handles unknown types", () => {
  const input: any = {
    name: "demo",
    count: 2,
    handler: () => "nope",
    nested: {
      value: Symbol("x"),
      date: new Date("2024-01-01T00:00:00Z"),
    },
    list: [1, undefined, BigInt(42)],
  };

  const result = sanitizeToJson(input) as Record<string, unknown>;
  assert.equal(result.name, "demo");
  assert.equal(result.count, 2);
  assert.equal(result.handler, null);
  assert.deepEqual(result.list, [1, null, "42"]);
  const nested = result.nested as Record<string, unknown>;
  assert.equal(nested.value, null);
  assert.equal(nested.date, "2024-01-01T00:00:00.000Z");
});
