import assert from "node:assert/strict";
import test from "node:test";

import { classifyIntent } from "./classifyIntent";
import type { SessionMemory } from "./sessionMemory";

const sessionWithLocation: SessionMemory = {
  lastPlaces: [],
  lastQuery: "",
  lastResolvedLocation: { lat: 1, lng: 2, label: "Downtown" },
  userPrefs: {},
  lastIntent: "search",
};

test("classifyIntent detects smalltalk", async () => {
  const result = await classifyIntent("Thanks for the help!", null);
  assert.equal(result.intent, "smalltalk");
});

test("classifyIntent detects refine", async () => {
  const result = await classifyIntent("Something cheaper and closer", sessionWithLocation);
  assert.equal(result.intent, "refine");
  assert.equal(result.extracted.budget, "cheap");
});

test("classifyIntent detects place follow-up", async () => {
  const result = await classifyIntent("Tell me about Sushi House", sessionWithLocation);
  assert.equal(result.intent, "place_followup");
  assert.equal(result.extracted.placeName, "sushi house");
});

test("classifyIntent detects needs_location", async () => {
  const result = await classifyIntent("Any sushi spots?", null);
  assert.equal(result.intent, "needs_location");
});

test("classifyIntent detects search with location hint", async () => {
  const result = await classifyIntent("sushi near downtown", null);
  assert.equal(result.intent, "search");
});

test("classifyIntent falls back to LLM extractor when ambiguous", async () => {
  const result = await classifyIntent(
    "Surprise me",
    sessionWithLocation,
    {
      callLlm: async () => ({
        assistantText: JSON.stringify({
          intent: "smalltalk",
          extracted: { cuisine: null, dish: null, placeName: null, vibe: null, budget: null },
        }),
        toolCalls: [],
      }),
    },
  );
  assert.equal(result.intent, "smalltalk");
});
