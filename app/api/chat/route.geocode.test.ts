import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "./route";

test("POST uses geocoded coords for nearby search when location_text is present", async () => {
  const originalFetch = globalThis.fetch;
  const originalMcpUrl = process.env.COMPOSIO_MCP_URL;
  const originalApiKey = process.env.COMPOSIO_API_KEY;

  try {
    process.env.COMPOSIO_MCP_URL = "https://example.com";
    process.env.COMPOSIO_API_KEY = "test-api-key";

    let geocodeArgs: Record<string, unknown> | null = null;
    let nearbyArgs: Record<string, unknown> | null = null;

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
                  name: "google_maps_geocode_address_with_query",
                  inputSchema: {
                    properties: {
                      address_query: { type: "string" },
                    },
                  },
                },
                {
                  name: "google_maps_places_nearby_search",
                  inputSchema: {
                    properties: {
                      latitude: { type: "number" },
                      longitude: { type: "number" },
                      radius_m: { type: "number" },
                      keyword: { type: "string" },
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
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (body?.method === "tools/call") {
        if (body.params?.name === "google_maps_geocode_address_with_query") {
          geocodeArgs = body.params?.arguments ?? null;
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                lat: 16.76,
                lng: 96.2,
                formatted_address: "Thanlyin, Myanmar",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        if (body.params?.name === "google_maps_places_nearby_search") {
          nearbyArgs = body.params?.arguments ?? null;
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                places: [
                  {
                    id: "place-1",
                    displayName: { text: "Test Place" },
                    formattedAddress: "Address",
                    location: { latitude: 16.76, longitude: 96.2 },
                  },
                ],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
      }

      return new Response("Unexpected request", { status: 500 });
    }) as typeof fetch;

    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "accept-language": "my-MM" },
      body: JSON.stringify({
        anonId: "anon",
        message: "sushi in Thanlyin",
        location: { lat: 1, lng: 2 },
      }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as { places: unknown[]; meta?: { mode?: string } };

    assert.ok(geocodeArgs);
    assert.ok(nearbyArgs);
    assert.equal((nearbyArgs as { latitude?: number }).latitude, 16.76);
    assert.equal((nearbyArgs as { longitude?: number }).longitude, 96.2);
    assert.equal(payload.places.length, 1);
    assert.ok(payload.meta?.mode);
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    process.env.COMPOSIO_MCP_URL = originalMcpUrl;
    process.env.COMPOSIO_API_KEY = originalApiKey;
  }
});
