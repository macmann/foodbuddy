import assert from "node:assert/strict";
import test from "node:test";

import { resolveSearchCoords } from "../../../lib/chat/searchCoords";
import { POST } from "./route";

test("resolveSearchCoords prioritizes explicit location over request coords", async () => {
  let geocodeCalls = 0;
  const reqCoords = { lat: 16.769, lng: 96.178 };
  let geocodeInput: string | null = null;

  const result = await resolveSearchCoords({
    reqCoords,
    locationText: "Thanlyin",
    requestId: "test-request",
    locale: "en",
    countryHint: "MM",
    coords: null,
    geocode: async (locationText) => {
      geocodeCalls += 1;
      geocodeInput = locationText;
      return { coords: { lat: 21, lng: 96 }, formattedAddress: "Fallback" };
    },
  });

  assert.equal(geocodeCalls, 1);
  assert.equal(geocodeInput, "Thanlyin");
  assert.deepEqual(result.searchCoords, { lat: 21, lng: 96 });
  assert.equal(result.coordsSource, "geocoded_text");
});

test("resolveSearchCoords uses request coords when no explicit location is provided", async () => {
  let geocodeCalls = 0;
  const reqCoords = { lat: 16.769, lng: 96.178 };

  const result = await resolveSearchCoords({
    reqCoords,
    requestId: "test-request",
    locale: "en",
    countryHint: "MM",
    coords: null,
    geocode: async () => {
      geocodeCalls += 1;
      return { coords: { lat: 21, lng: 96 }, formattedAddress: "Fallback" };
    },
  });

  assert.equal(geocodeCalls, 0);
  assert.deepEqual(result.searchCoords, reqCoords);
  assert.equal(result.coordsSource, "request_coords");
});

test("POST preserves coordinate precision for MCP nearby search", async () => {
  const originalFetch = globalThis.fetch;
  const originalMcpUrl = process.env.COMPOSIO_MCP_URL;
  const originalApiKey = process.env.COMPOSIO_API_KEY;

  try {
    process.env.COMPOSIO_MCP_URL = "https://example.com";
    process.env.COMPOSIO_API_KEY = "test-api-key";

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
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (body?.method === "tools/call") {
        nearbyArgs = body.params?.arguments ?? null;
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              places: [
                {
                  id: "place-1",
                  displayName: { text: "Precision Place" },
                  formattedAddress: "Address",
                  location: { latitude: 16.7587537, longitude: 96.2312458 },
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response("Unexpected request", { status: 500 });
    }) as typeof fetch;

    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        anonId: "anon",
        message: "sushi",
        location: { lat: 16.7587537, lng: 96.2312458 },
      }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as { places: unknown[] };

    assert.ok(nearbyArgs);
    const latitude = (nearbyArgs as { latitude?: number }).latitude ?? 0;
    const longitude = (nearbyArgs as { longitude?: number }).longitude ?? 0;
    assert.ok(Math.abs(latitude - 16.7587537) < 0.000001);
    assert.ok(Math.abs(longitude - 96.2312458) < 0.000001);
    assert.equal(payload.places.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.COMPOSIO_MCP_URL = originalMcpUrl;
    process.env.COMPOSIO_API_KEY = originalApiKey;
  }
});
