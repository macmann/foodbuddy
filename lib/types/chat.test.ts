import assert from "node:assert/strict";
import test from "node:test";

import { ChatResponseSchema } from "./chat";

test("ChatResponseSchema validates response payload", () => {
  const result = ChatResponseSchema.safeParse({
    status: "ok",
    message: "Here are a few places you might like.",
    places: [],
    meta: {
      mode: "search",
      suggestedPrompts: ["cheap", "spicy"],
    },
  });

  assert.equal(result.success, true);
});

test("ChatResponseSchema requires meta.mode", () => {
  const result = ChatResponseSchema.safeParse({
    status: "ok",
    message: "Hello!",
    places: [],
    meta: {},
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.issues.some((issue) => issue.path.join(".") === "meta.mode"));
  }
});
