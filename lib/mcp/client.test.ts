import assert from "node:assert/strict";
import test from "node:test";

import { mcpCall } from "./client";

test("mcpCall builds JSON-RPC requests with required headers", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (_input, init) => {
      const headers = init?.headers as Record<string, string>;
      const body = init?.body ? JSON.parse(init.body.toString()) : null;

      assert.equal(headers.Accept, "application/json, text/event-stream");
      assert.equal(headers["Content-Type"], "application/json");
      assert.equal(headers["Cache-Control"], "no-cache");
      assert.equal(headers["x-api-key"], "test-key");
      assert.equal(body?.jsonrpc, "2.0");
      assert.ok(body?.id);
      assert.equal(body?.method, "tools/list");

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { tools: [] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await mcpCall<{ tools: unknown[] }>({
      url: "https://example.com",
      apiKey: "test-key",
      method: "tools/list",
      params: {},
    });

    assert.deepEqual(result, { tools: [] });
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
  }
});

test("mcpCall parses SSE responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"jsonrpc":"2.0","id":"1","result":{"value":42}}\n\n',
            ),
          );
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;

    const result = await mcpCall<{ value: number }>({
      url: "https://example.com",
      apiKey: "test-key",
      method: "tools/call",
      params: {},
    });

    assert.equal(result?.value, 42);
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
  }
});
