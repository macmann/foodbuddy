import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "./route";

test("POST treats simple greetings as smalltalk and skips MCP", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async () => {
      throw new Error("Unexpected fetch call");
    }) as typeof fetch;

    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        anonId: "anon",
        message: "hi",
      }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as { message: string; meta?: { mode?: string } };

    assert.equal(payload.meta?.mode, "smalltalk");
    assert.match(payload.message.toLowerCase(), /craving/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST handles Burmese greeting as smalltalk and skips MCP", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async () => {
      throw new Error("Unexpected fetch call");
    }) as typeof fetch;

    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "accept-language": "my-MM" },
      body: JSON.stringify({
        anonId: "anon",
        message: "မင်္ဂလာပါ",
      }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as { message: string; meta?: { mode?: string } };

    assert.equal(payload.meta?.mode, "smalltalk");
    assert.match(payload.message, /ဘာစားချင်/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST skips MCP when LLM extractor times out on greeting", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalTimeout = process.env.LLM_EXTRACTOR_TIMEOUT_MS;

  try {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.LLM_EXTRACTOR_TIMEOUT_MS = "1";

    globalThis.fetch = ((input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (!url.includes("/responses")) {
        throw new Error(`Unexpected fetch: ${url}`);
      }
      return new Promise((_resolve, reject) => {
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        if (init?.signal?.aborted) {
          reject(abortError);
          return;
        }
        init?.signal?.addEventListener("abort", () => reject(abortError));
      }) as Promise<Response>;
    }) as typeof fetch;

    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        anonId: "anon",
        message: "hi",
      }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as { message: string; meta?: { mode?: string } };

    assert.equal(payload.meta?.mode, "smalltalk");
    assert.match(payload.message.toLowerCase(), /craving/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.LLM_EXTRACTOR_TIMEOUT_MS = originalTimeout;
  }
});
