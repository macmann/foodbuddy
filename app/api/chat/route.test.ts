import assert from "node:assert/strict";
import test from "node:test";

import { __test__ } from "./route";

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
    __test__.setExtractPlacesFromMcpResult(() => {
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

    const result = await __test__.searchPlacesWithMcp({
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
    __test__.resetExtractPlacesFromMcpResult();
  }
});
