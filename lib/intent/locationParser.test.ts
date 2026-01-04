import assert from "node:assert/strict";
import test from "node:test";

import {
  fallbackExtractKeyword,
  parseLocationWithLLM,
  sanitizeLocationText,
} from "./locationParser";

test("parseLocationWithLLM returns parsed query and location", async () => {
  const result = await parseLocationWithLLM(
    {
      message: "noodle in yangon",
      requestId: "test-request",
    },
    {
      getSettings: async () => ({
        llmEnabled: true,
        llmProvider: "openai",
        llmModel: "gpt-5-mini",
        llmSystemPrompt: "system",
        reasoningEffort: "low",
        verbosity: "low",
      }),
      callLlm: async () => ({
        assistantText: JSON.stringify({
          intent: "nearby_search",
          query: "noodle",
          location_text: "Yangon",
          use_device_location: false,
          radius_m: 1500,
          place_types: ["restaurant"],
          confidence: 0.9,
        }),
        toolCalls: [],
      }),
    },
  );

  assert.equal(result.query, "noodle");
  assert.equal(result.location_text, "Yangon");
  assert.equal(result.use_device_location, false);
});

test("fallbackExtractKeyword prefers known cuisine keywords", () => {
  assert.equal(
    fallbackExtractKeyword("i m near Thanlyin, i want noodle place"),
    "noodle",
  );
  assert.equal(fallbackExtractKeyword("nearby coffee"), "coffee");
});

test("fallbackExtractKeyword trims stopwords", () => {
  assert.equal(fallbackExtractKeyword("find food"), "food");
});

test("parseLocationWithLLM fallback captures explicit location text", async () => {
  const result = await parseLocationWithLLM(
    {
      message: "i m near Thanlyin, i want noodle place",
      requestId: "test-request",
    },
    {
      getSettings: async () => ({
        llmEnabled: false,
        llmProvider: "openai",
        llmModel: "gpt-5-mini",
        llmSystemPrompt: "system",
        reasoningEffort: "low",
        verbosity: "low",
      }),
    },
  );

  assert.equal(result.location_text, "Thanlyin");
  assert.equal(result.use_device_location, false);
});

test("sanitizeLocationText trims trailing punctuation", () => {
  assert.equal(sanitizeLocationText("thanlyin?"), "thanlyin");
});
