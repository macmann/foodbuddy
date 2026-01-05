import assert from "node:assert/strict";
import test from "node:test";

import { extractWithLLM } from "./llmExtractor";

const baseSettings = {
  llmEnabled: true,
  llmProvider: "openai",
  llmModel: "gpt-5-mini",
  llmSystemPrompt: "system",
  reasoningEffort: "low",
  verbosity: "low",
};

test("extractWithLLM handles Burmese search intent with location", async () => {
  const result = await extractWithLLM(
    {
      message: "သက္ကေတာ မြို့နယ်အနီးမှာ ဟော့ပေါ့ဆိုင် ရှိလား",
      locale: "my",
      hasDeviceCoords: false,
    },
    {
      getSettings: async () => baseSettings,
      callLlm: async () => ({
        assistantText: JSON.stringify({
          language: "my",
          intent: "search",
          keyword: "ဟော့ပေါ့",
          keyword_en: "hotpot",
          location_text: "သက္ကေတာ",
          place_name: null,
          radius_m: null,
          followup_type: null,
          top_n: null,
          confidence: 0.82,
        }),
        toolCalls: [],
      }),
    },
  );

  assert.equal(result.intent, "search");
  assert.ok(result.keyword?.includes("ဟော့ပေါ့") || result.keyword_en === "hotpot");
  assert.ok(result.location_text?.includes("သက္ကေတာ"));
});

test("extractWithLLM captures Burmese location text with keyword", async () => {
  const result = await extractWithLLM(
    {
      message: "သန်လျင်နားမှာ စားသောက်ဆိုင်",
      locale: "my",
      hasDeviceCoords: false,
    },
    {
      getSettings: async () => baseSettings,
      callLlm: async () => ({
        assistantText: JSON.stringify({
          language: "my",
          intent: "search",
          keyword: "စားသောက်ဆိုင်",
          keyword_en: "restaurant",
          location_text: "သန်လျင်",
          place_name: null,
          radius_m: null,
          followup_type: null,
          top_n: null,
          confidence: 0.76,
        }),
        toolCalls: [],
      }),
    },
  );

  assert.equal(result.intent, "search");
  assert.ok(result.location_text?.includes("သန်လျင်"));
  assert.ok(result.keyword);
});

test("extractWithLLM handles Burmese list Q&A followup", async () => {
  const result = await extractWithLLM(
    {
      message: "အမြင့်ဆုံး rating ရှိတာဘယ်ဆိုင်လဲ",
      locale: "my",
      hasDeviceCoords: false,
      lastPlacesCount: 3,
    },
    {
      getSettings: async () => baseSettings,
      callLlm: async () => ({
        assistantText: JSON.stringify({
          language: "my",
          intent: "list_qna",
          keyword: null,
          keyword_en: null,
          location_text: null,
          place_name: null,
          radius_m: null,
          followup_type: "highest_rating",
          top_n: null,
          confidence: 0.84,
        }),
        toolCalls: [],
      }),
    },
  );

  assert.equal(result.intent, "list_qna");
  assert.equal(result.followup_type, "highest_rating");
});
