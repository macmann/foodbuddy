import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@prisma/client";

import { sanitizeToJson } from "./json";

const assertIsRecord = (value: unknown): asserts value is Record<string, unknown> => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
};

test("sanitizeToJson removes functions and handles unknown types", () => {
  const input = {
    name: "demo",
    count: 2,
    handler: () => "nope",
    nested: {
      value: Symbol("x"),
      date: new Date("2024-01-01T00:00:00Z"),
    },
    list: [1, undefined, BigInt(42)],
  };

  const result = sanitizeToJson(input);
  assertIsRecord(result);
  assert.equal(result.name, "demo");
  assert.equal(result.count, 2);
  assert.equal(result.handler, Prisma.DbNull);
  assert.deepEqual(result.list, [1, Prisma.DbNull, "42"]);
  const nested = result.nested;
  assertIsRecord(nested);
  assert.equal(nested.value, Prisma.DbNull);
  assert.equal(nested.date, "2024-01-01T00:00:00.000Z");
});
