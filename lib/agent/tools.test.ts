import assert from "node:assert/strict";
import test from "node:test";

import { toolHandlers } from "./tools";

test("recommend_places returns fallback on MCP 406", async () => {
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
      { location: { lat: 40.7128, lng: -74.006 } },
    );

    const results = result.results as unknown[] | undefined;
    const meta = result.meta as { fallbackUsed?: boolean; errorMessage?: string } | undefined;

    assert.ok(Array.isArray(results));
    assert.ok((results ?? []).length >= 3);
    assert.equal(meta?.fallbackUsed, true);
    assert.ok(meta?.errorMessage?.includes("406"));
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    process.env.GOOGLE_PROVIDER = originalProvider;
    process.env.COMPOSIO_MCP_URL = originalMcpUrl;
    process.env.COMPOSIO_API_KEY = originalApiKey;
  }
});
