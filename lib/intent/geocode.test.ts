import assert from "node:assert/strict";
import test from "node:test";

import { buildGeocodeQuery, resolveLocationTextToCoords } from "./geocode";

test("geocode query adds Myanmar bias for Yangon", () => {
  const query = buildGeocodeQuery("Yangon", { locale: "my-MM" });
  assert.equal(query, "Yangon, Myanmar");
});

test("geocode query adds Myanmar bias for Thanlyin", () => {
  const query = buildGeocodeQuery("Thanlyin", { locale: "my-MM" });
  assert.equal(query, "Thanlyin, Yangon, Myanmar");
});

test("geocode query avoids Myanmar bias for Berlin", () => {
  const query = buildGeocodeQuery("Berlin", { locale: "my-MM" });
  assert.equal(query, "Berlin");
});

test("resolveLocationTextToCoords applies Myanmar bias and uses MCP geocode", async () => {
  const originalFetch = globalThis.fetch;
  const originalMcpUrl = process.env.COMPOSIO_MCP_URL;
  const originalApiKey = process.env.COMPOSIO_API_KEY;

  try {
    process.env.COMPOSIO_MCP_URL = "https://example.com";
    process.env.COMPOSIO_API_KEY = "test-api-key";

    let geocodeQuery: string | null = null;
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
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (body?.method === "tools/call") {
        geocodeQuery =
          body.params?.arguments?.address_query ??
          body.params?.arguments?.query ??
          null;
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

      return new Response("Unexpected request", { status: 500 });
    }) as typeof fetch;

    const result = await resolveLocationTextToCoords("Thanlyin", {
      locale: "my-MM",
      countryHint: "Myanmar",
      requestId: "test-request",
    });

    assert.ok(geocodeQuery);
    assert.match(geocodeQuery ?? "", /Myanmar/);
    assert.deepEqual(result, {
      lat: 16.76,
      lng: 96.2,
      formattedAddress: "Thanlyin, Myanmar",
    });
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    process.env.COMPOSIO_MCP_URL = originalMcpUrl;
    process.env.COMPOSIO_API_KEY = originalApiKey;
  }
});
