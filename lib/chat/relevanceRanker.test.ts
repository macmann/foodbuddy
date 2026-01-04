import assert from "node:assert/strict";
import test from "node:test";

import { rankMcpPlacesByRelevance } from "./relevanceRanker";

const baseSettings = {
  llmEnabled: true,
  llmProvider: "openai",
  llmModel: "gpt-5-mini",
  llmSystemPrompt: "",
  reasoningEffort: "low",
  verbosity: "low",
};

test("rankMcpPlacesByRelevance returns ranked places and rationale", async () => {
  const originalFlag = process.env.LLM_RELEVANCE_RANKING_ENABLED;
  process.env.LLM_RELEVANCE_RANKING_ENABLED = "true";

  try {
    let callCount = 0;
    const places = [
      {
        id: "place-1",
        name: "Alpha Noodle",
        location: { latitude: 1, longitude: 2 },
        types: ["restaurant"],
      },
      {
        id: "place-2",
        name: "Bravo Sushi",
        location: { latitude: 1.01, longitude: 2.01 },
        types: ["restaurant"],
      },
    ];

    const result = await rankMcpPlacesByRelevance(
      {
        query: "sushi",
        places,
        coords: { lat: 1, lng: 2 },
        radiusMeters: 1500,
        requestId: "test-rank",
      },
      {
        getSettings: async () => baseSettings,
        callLlm: async () => ({
          assistantText:
            callCount++ === 0
              ? JSON.stringify({ kept: ["place-1", "place-2"] })
              : JSON.stringify({
                  ranked: ["place-2", "place-1"],
                  rationale: "Closer to your sushi craving.",
                }),
          toolCalls: [],
        }),
      },
    );

    assert.equal(result.usedRanker, true);
    assert.equal(result.rankedPlaces[0]?.id, "place-2");
    assert.equal(result.assistantMessage, "Closer to your sushi craving.");
  } finally {
    process.env.LLM_RELEVANCE_RANKING_ENABLED = originalFlag;
  }
});

test("rankMcpPlacesByRelevance falls back when JSON is invalid", async () => {
  const originalFlag = process.env.LLM_RELEVANCE_RANKING_ENABLED;
  process.env.LLM_RELEVANCE_RANKING_ENABLED = "true";

  try {
    let callCount = 0;
    const places = [
      {
        id: "nearby",
        name: "Near Cafe",
        location: { latitude: 0, longitude: 0 },
        types: ["restaurant"],
      },
      {
        id: "faraway",
        name: "Far Grill",
        location: { latitude: 10, longitude: 10 },
        types: ["restaurant"],
      },
    ];

    const result = await rankMcpPlacesByRelevance(
      {
        query: "coffee",
        places,
        coords: { lat: 0, lng: 0 },
        radiusMeters: 1000,
        requestId: "test-fallback",
      },
      {
        getSettings: async () => baseSettings,
        callLlm: async () => ({
          assistantText: callCount++ === 0 ? JSON.stringify({ kept: ["nearby"] }) : "not-json",
          toolCalls: [],
        }),
      },
    );

    assert.equal(result.usedRanker, false);
    assert.equal(result.rankedPlaces.length, 1);
    assert.equal(result.rankedPlaces[0]?.id, "nearby");
  } finally {
    process.env.LLM_RELEVANCE_RANKING_ENABLED = originalFlag;
  }
});

test("rankMcpPlacesByRelevance filters places by cuisine before fallback", async () => {
  const originalFlag = process.env.LLM_RELEVANCE_RANKING_ENABLED;
  process.env.LLM_RELEVANCE_RANKING_ENABLED = "false";

  try {
    const places = [
      {
        id: "thai-1",
        name: "Thai Garden",
        location: { latitude: 1, longitude: 2 },
        types: ["restaurant"],
      },
      {
        id: "italian-1",
        name: "Pasta House",
        location: { latitude: 1.01, longitude: 2.01 },
        types: ["restaurant"],
      },
    ];

    const result = await rankMcpPlacesByRelevance(
      {
        query: "thai",
        places,
        coords: { lat: 1, lng: 2 },
        radiusMeters: 5000,
        requestId: "test-cuisine-filter",
      },
      {
        getSettings: async () => baseSettings,
        callLlm: async () => ({
          assistantText: JSON.stringify({ kept: ["thai-1"] }),
          toolCalls: [],
        }),
      },
    );

    assert.equal(result.usedRanker, false);
    assert.deepEqual(
      result.rankedPlaces.map((place) => place.id),
      ["thai-1"],
    );
  } finally {
    process.env.LLM_RELEVANCE_RANKING_ENABLED = originalFlag;
  }
});

test("rankMcpPlacesByRelevance keeps original places when cuisine filter fails", async () => {
  const originalFlag = process.env.LLM_RELEVANCE_RANKING_ENABLED;
  process.env.LLM_RELEVANCE_RANKING_ENABLED = "false";

  try {
    const places = [
      {
        id: "thai-2",
        name: "Thai Plaza",
        location: { latitude: 1, longitude: 2 },
        types: ["restaurant"],
      },
      {
        id: "korean-1",
        name: "Seoul Kitchen",
        location: { latitude: 1.02, longitude: 2.02 },
        types: ["restaurant"],
      },
    ];

    const result = await rankMcpPlacesByRelevance(
      {
        query: "thai",
        places,
        coords: { lat: 1, lng: 2 },
        radiusMeters: 5000,
        requestId: "test-cuisine-filter-failure",
      },
      {
        getSettings: async () => baseSettings,
        callLlm: async () => {
          throw new Error("LLM unavailable");
        },
      },
    );

    assert.equal(result.usedRanker, false);
    assert.deepEqual(
      result.rankedPlaces.map((place) => place.id),
      ["thai-2", "korean-1"],
    );
  } finally {
    process.env.LLM_RELEVANCE_RANKING_ENABLED = originalFlag;
  }
});
