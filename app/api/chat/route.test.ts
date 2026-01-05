import assert from "node:assert/strict";
import test from "node:test";

import {
  resetExtractPlacesFromMcpResult,
  searchPlacesWithMcp,
  setExtractPlacesFromMcpResult,
} from "../../../lib/chat/routeInternals";

test("searchPlacesWithMcp retries with text search on nearby validation errors", async () => {
  const originalFetch = globalThis.fetch;
  const originalMcpUrl = process.env.COMPOSIO_MCP_URL;
  const originalApiKey = process.env.COMPOSIO_API_KEY;

  try {
    process.env.COMPOSIO_MCP_URL = "https://example.com";
    process.env.COMPOSIO_API_KEY = "test-api-key";

    const toolCalls: string[] = [];
    globalThis.fetch = (async (_input, init) => {
      const body = init?.body ? JSON.parse(init.body.toString()) : null;
      if (body?.method === "tools/list") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                {
                  name: "google_maps_places_nearby_search",
                  inputSchema: {
                    properties: {
                      keyword: { type: "string" },
                      latitude: { type: "number" },
                      longitude: { type: "number" },
                      radius_m: { type: "number" },
                    },
                  },
                },
                {
                  name: "google_maps_places_text_search",
                  inputSchema: {
                    properties: {
                      query: { type: "string" },
                      locationBias: { type: "object" },
                    },
                  },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (body?.method === "tools/call") {
        toolCalls.push(body.params?.name ?? "unknown");
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: { results: [] },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response("Unexpected request", { status: 500 });
    }) as typeof fetch;

    let extractorCalls = 0;
    setExtractPlacesFromMcpResult(() => {
      extractorCalls += 1;
      if (extractorCalls === 1) {
        return {
          places: [],
          successfull: false,
          error: "Invalid place type(s) for includedTypes",
        };
      }
      return {
        places: [
          {
            name: "Fallback Place",
            id: "place-1",
            location: { latitude: 1, longitude: 2 },
          },
        ],
        successfull: true,
      };
    });

    const result = await searchPlacesWithMcp({
      keyword: "sushi",
      coords: { lat: 1, lng: 2 },
      radiusMeters: 1000,
      requestId: "test-request",
    });

    assert.equal(extractorCalls, 2);
    assert.deepEqual(toolCalls, [
      "google_maps_places_nearby_search",
      "google_maps_places_text_search",
    ]);
    assert.equal(result.places.length, 1);
    assert.match(result.message, /searched by text/i);
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    process.env.COMPOSIO_MCP_URL = originalMcpUrl;
    process.env.COMPOSIO_API_KEY = originalApiKey;
    resetExtractPlacesFromMcpResult();
  }
});

test("searchPlacesWithMcp uses relevance ranker and keeps mapsUrl/placeId", async () => {
  const originalFetch = globalThis.fetch;
  const originalMcpUrl = process.env.COMPOSIO_MCP_URL;
  const originalApiKey = process.env.COMPOSIO_API_KEY;
  const originalRankFlag = process.env.LLM_RELEVANCE_RANKING_ENABLED;

  try {
    process.env.COMPOSIO_MCP_URL = "https://example.com";
    process.env.COMPOSIO_API_KEY = "test-api-key";
    process.env.LLM_RELEVANCE_RANKING_ENABLED = "true";

    globalThis.fetch = (async (_input, init) => {
      const body = init?.body ? JSON.parse(init.body.toString()) : null;
      if (body?.method === "tools/list") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                {
                  name: "google_maps_places_nearby_search",
                  inputSchema: {
                    properties: {
                      keyword: { type: "string" },
                      latitude: { type: "number" },
                      longitude: { type: "number" },
                      radius_m: { type: "number" },
                    },
                  },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (body?.method === "tools/call") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: { results: [] },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response("Unexpected request", { status: 500 });
    }) as typeof fetch;

    setExtractPlacesFromMcpResult(() => ({
      places: [
        {
          id: "place-1",
          name: "Alpha",
          location: { latitude: 1, longitude: 2 },
          googleMapsUri: "https://maps.example.com/alpha",
          types: ["restaurant"],
        },
        {
          id: "place-2",
          name: "Bravo",
          location: { latitude: 1.01, longitude: 2.01 },
          googleMapsUri: "https://maps.example.com/bravo",
          types: ["restaurant"],
        },
      ],
      successfull: true,
    }));

    const result = await searchPlacesWithMcp({
      keyword: "sushi",
      coords: { lat: 1, lng: 2 },
      radiusMeters: 1000,
      requestId: "test-request",
      relevanceRankerDeps: {
        getSettings: async () => ({
          llmEnabled: true,
          llmProvider: "openai",
          llmModel: "gpt-5-mini",
          llmSystemPrompt: "",
          reasoningEffort: "low",
          verbosity: "low",
        }),
        callLlm: async () => ({
          assistantText: JSON.stringify({
            ranked: ["place-2", "place-1"],
            rationale: "Top match.",
          }),
          toolCalls: [],
        }),
      },
    });

    assert.equal(result.places[0]?.placeId, "place-2");
    result.places.forEach((place) => {
      assert.ok(place.mapsUrl);
      assert.ok(place.placeId);
    });
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    process.env.COMPOSIO_MCP_URL = originalMcpUrl;
    process.env.COMPOSIO_API_KEY = originalApiKey;
    process.env.LLM_RELEVANCE_RANKING_ENABLED = originalRankFlag;
    resetExtractPlacesFromMcpResult();
  }
});

test("searchPlacesWithMcp keeps far results when explicit location disables distance filter", async () => {
  const originalFetch = globalThis.fetch;
  const originalMcpUrl = process.env.COMPOSIO_MCP_URL;
  const originalApiKey = process.env.COMPOSIO_API_KEY;

  try {
    process.env.COMPOSIO_MCP_URL = "https://example.com";
    process.env.COMPOSIO_API_KEY = "test-api-key";

    let capturedQuery: string | null = null;
    globalThis.fetch = (async (_input, init) => {
      const body = init?.body ? JSON.parse(init.body.toString()) : null;
      if (body?.method === "tools/list") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                {
                  name: "google_maps_places_text_search",
                  inputSchema: {
                    properties: {
                      query: { type: "string" },
                      locationBias: { type: "object" },
                    },
                  },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (body?.method === "tools/call") {
        capturedQuery = body.params?.arguments?.query ?? null;
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: { results: [] },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response("Unexpected request", { status: 500 });
    }) as typeof fetch;

    setExtractPlacesFromMcpResult(() => ({
      places: [
        {
          id: "place-1",
          name: "Far Place",
          location: { latitude: 40.7128, longitude: -74.006 },
        },
      ],
      successfull: true,
    }));

    const result = await searchPlacesWithMcp({
      keyword: "local food",
      coords: { lat: 16.8409, lng: 96.1735 },
      radiusMeters: 1000,
      requestId: "test-request",
      locationText: "Kalaw",
      disableDistanceFilter: true,
    });

    assert.equal(result.places.length, 1);
    assert.match(capturedQuery ?? "", /in Kalaw/i);
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    process.env.COMPOSIO_MCP_URL = originalMcpUrl;
    process.env.COMPOSIO_API_KEY = originalApiKey;
    resetExtractPlacesFromMcpResult();
  }
});

test("searchPlacesWithMcp applies distance filter for near-me queries", async () => {
  const originalFetch = globalThis.fetch;
  const originalMcpUrl = process.env.COMPOSIO_MCP_URL;
  const originalApiKey = process.env.COMPOSIO_API_KEY;

  try {
    process.env.COMPOSIO_MCP_URL = "https://example.com";
    process.env.COMPOSIO_API_KEY = "test-api-key";

    let capturedLat: number | null = null;
    let capturedLng: number | null = null;
    globalThis.fetch = (async (_input, init) => {
      const body = init?.body ? JSON.parse(init.body.toString()) : null;
      if (body?.method === "tools/list") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                {
                  name: "google_maps_places_text_search",
                  inputSchema: {
                    properties: {
                      query: { type: "string" },
                      latitude: { type: "number" },
                      longitude: { type: "number" },
                    },
                  },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (body?.method === "tools/call") {
        capturedLat = body.params?.arguments?.latitude ?? null;
        capturedLng = body.params?.arguments?.longitude ?? null;
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: { results: [] },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response("Unexpected request", { status: 500 });
    }) as typeof fetch;

    setExtractPlacesFromMcpResult(() => ({
      places: [
        {
          id: "place-1",
          name: "Far Place",
          location: { latitude: 40.7128, longitude: -74.006 },
        },
      ],
      successfull: true,
    }));

    const result = await searchPlacesWithMcp({
      keyword: "noodle near me",
      coords: { lat: 16.8409, lng: 96.1735 },
      radiusMeters: 1000,
      requestId: "test-request",
    });

    assert.equal(result.places.length, 0);
    assert.equal(capturedLat, 16.8409);
    assert.equal(capturedLng, 96.1735);
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    process.env.COMPOSIO_MCP_URL = originalMcpUrl;
    process.env.COMPOSIO_API_KEY = originalApiKey;
    resetExtractPlacesFromMcpResult();
  }
});
