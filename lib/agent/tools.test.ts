import assert from "node:assert/strict";
import test from "node:test";

import { toolHandlers } from "./tools";

test("recommend_places returns empty results on MCP failure", async () => {
  const originalFetch = globalThis.fetch;
  const originalProvider = process.env.GOOGLE_PROVIDER;
  const originalMcpUrl = process.env.COMPOSIO_MCP_URL;
  const originalApiKey = process.env.COMPOSIO_API_KEY;

  try {
    process.env.GOOGLE_PROVIDER = "MCP";
    process.env.COMPOSIO_MCP_URL = "https://example.com";
    process.env.COMPOSIO_API_KEY = "test-api-key";

    globalThis.fetch = (async () =>
      new Response("Not Acceptable", {
        status: 406,
        statusText: "Not Acceptable",
      })) as typeof fetch;

    const result = await toolHandlers.recommend_places(
      { query: "pizza" },
      { location: { kind: "coords", coords: { lat: 40.7128, lng: -74.006 } } },
    );

    const results = result.results as unknown[] | undefined;
    const meta = result.meta as { fallbackUsed?: boolean; errorMessage?: string } | undefined;

    assert.ok(Array.isArray(results));
    assert.equal((results ?? []).length, 0);
    assert.equal(meta?.fallbackUsed, true);
    assert.ok(meta?.errorMessage);
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    process.env.GOOGLE_PROVIDER = originalProvider;
    process.env.COMPOSIO_MCP_URL = originalMcpUrl;
    process.env.COMPOSIO_API_KEY = originalApiKey;
  }
});

test("recommend_places sends JSON-RPC with required headers", async () => {
  const originalFetch = globalThis.fetch;
  const originalProvider = process.env.GOOGLE_PROVIDER;
  const originalMcpUrl = process.env.COMPOSIO_MCP_URL;
  const originalApiKey = process.env.COMPOSIO_API_KEY;

  try {
    process.env.GOOGLE_PROVIDER = "MCP";
    process.env.COMPOSIO_MCP_URL = "https://example.com";
    process.env.COMPOSIO_API_KEY = "test-api-key";

    let callCount = 0;
    globalThis.fetch = (async (_input, init) => {
      callCount += 1;
      const headers = init?.headers as Record<string, string>;
      const body = init?.body ? JSON.parse(init.body.toString()) : null;

      assert.equal(headers.Accept, "application/json, text/event-stream");
      assert.equal(headers["Content-Type"], "application/json");
      assert.equal(headers["Cache-Control"], "no-cache");
      assert.equal(headers["x-api-key"], "test-api-key");
      assert.equal(body?.jsonrpc, "2.0");
      assert.ok(body?.id);
      assert.ok(body?.method);

      if (body.method === "tools/list") {
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
                      query: { type: "string" },
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

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            results: [{ name: "Test Place", place_id: "abc123", lat: 1, lng: 2 }],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    const result = await toolHandlers.recommend_places(
      { query: "pizza" },
      { location: { kind: "coords", coords: { lat: 40.7128, lng: -74.006 } } },
    );

    const results = result.results as unknown[] | undefined;
    assert.ok(Array.isArray(results));
    assert.equal(results?.length, 1);
    assert.equal(callCount, 2);
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    process.env.GOOGLE_PROVIDER = originalProvider;
    process.env.COMPOSIO_MCP_URL = originalMcpUrl;
    process.env.COMPOSIO_API_KEY = originalApiKey;
  }
});

test("recommend_places sends keyword using textQuery schema key", async () => {
  const originalFetch = globalThis.fetch;
  const originalProvider = process.env.GOOGLE_PROVIDER;
  const originalMcpUrl = process.env.COMPOSIO_MCP_URL;
  const originalApiKey = process.env.COMPOSIO_API_KEY;

  try {
    process.env.GOOGLE_PROVIDER = "MCP";
    process.env.COMPOSIO_MCP_URL = "https://example.com";
    process.env.COMPOSIO_API_KEY = "test-api-key";

    let capturedArgs: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input, init) => {
      const body = init?.body ? JSON.parse(init.body.toString()) : null;

      if (body.method === "tools/list") {
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
                      textQuery: { type: "string" },
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

      capturedArgs = body?.params?.arguments ?? null;

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            results: [{ name: "Test Place", place_id: "abc123", lat: 1, lng: 2 }],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    await toolHandlers.recommend_places(
      { query: "sushi" },
      { location: { kind: "coords", coords: { lat: 40.7128, lng: -74.006 } } },
    );

    assert.equal(capturedArgs?.textQuery, "sushi");
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    process.env.GOOGLE_PROVIDER = originalProvider;
    process.env.COMPOSIO_MCP_URL = originalMcpUrl;
    process.env.COMPOSIO_API_KEY = originalApiKey;
  }
});

test("recommend_places biases text search toward provided coordinates", async () => {
  const originalFetch = globalThis.fetch;
  const originalProvider = process.env.GOOGLE_PROVIDER;
  const originalMcpUrl = process.env.COMPOSIO_MCP_URL;
  const originalApiKey = process.env.COMPOSIO_API_KEY;

  try {
    process.env.GOOGLE_PROVIDER = "MCP";
    process.env.COMPOSIO_MCP_URL = "https://example.com";
    process.env.COMPOSIO_API_KEY = "test-api-key";

    let capturedArgs: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input, init) => {
      const body = init?.body ? JSON.parse(init.body.toString()) : null;

      if (body.method === "tools/list") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                {
                  name: "google_maps_text_search",
                  inputSchema: {
                    properties: {
                      textQuery: { type: "string" },
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

      capturedArgs = body?.params?.arguments ?? null;
      const bias = capturedArgs?.locationBias as
        | { circle?: { center?: { latitude?: number; longitude?: number } } }
        | undefined;
      const isMyanmarBias =
        bias?.circle?.center?.latitude === 21 && bias?.circle?.center?.longitude === 96;

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            successfull: true,
            data: {
              places: [
                {
                  id: "mm-1",
                  displayName: { text: "Noodle House" },
                  formattedAddress: isMyanmarBias ? "Yangon, Myanmar" : "Seattle, USA",
                  location: { latitude: 21, longitude: 96 },
                },
              ],
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    const result = await toolHandlers.recommend_places(
      { query: "noodle" },
      {
        location: { kind: "coords", coords: { lat: 21, lng: 96 } },
        radius_m: 1500,
      },
    );

    const results = result.results as Array<{ address?: string; distanceMeters?: number }>;
    const first = results?.[0];
    const addressHasMyanmar = first?.address?.includes("Myanmar") ?? false;
    const withinRadius =
      typeof first?.distanceMeters === "number" ? first.distanceMeters <= 1500 : false;

    assert.ok(capturedArgs?.locationBias);
    assert.ok(first);
    assert.ok(addressHasMyanmar || withinRadius);
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    process.env.GOOGLE_PROVIDER = originalProvider;
    process.env.COMPOSIO_MCP_URL = originalMcpUrl;
    process.env.COMPOSIO_API_KEY = originalApiKey;
  }
});

test("recommend_places does not send food in includedTypes", async () => {
  const originalFetch = globalThis.fetch;
  const originalProvider = process.env.GOOGLE_PROVIDER;
  const originalMcpUrl = process.env.COMPOSIO_MCP_URL;
  const originalApiKey = process.env.COMPOSIO_API_KEY;

  try {
    process.env.GOOGLE_PROVIDER = "MCP";
    process.env.COMPOSIO_MCP_URL = "https://example.com";
    process.env.COMPOSIO_API_KEY = "test-api-key";

    let capturedArgs: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input, init) => {
      const body = init?.body ? JSON.parse(init.body.toString()) : null;

      if (body.method === "tools/list") {
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
                      includedTypes: { type: "array" },
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

      capturedArgs = body?.params?.arguments ?? null;

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            successfull: true,
            data: {
              places: [
                {
                  id: "mm-1",
                  displayName: { text: "Hotpot House" },
                  formattedAddress: "Yangon, Myanmar",
                  location: { latitude: 21, longitude: 96 },
                },
              ],
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    await toolHandlers.recommend_places(
      { query: "hotpot" },
      { location: { kind: "coords", coords: { lat: 21, lng: 96 } } },
    );

    const includedTypes = capturedArgs?.includedTypes as string[] | undefined;
    assert.ok(Array.isArray(includedTypes));
    assert.ok(includedTypes?.includes("restaurant"));
    assert.equal(includedTypes?.includes("food"), false);
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    process.env.GOOGLE_PROVIDER = originalProvider;
    process.env.COMPOSIO_MCP_URL = originalMcpUrl;
    process.env.COMPOSIO_API_KEY = originalApiKey;
  }
});
