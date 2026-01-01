import assert from "node:assert/strict";
import test from "node:test";

import { extractPlacesFromMcpResult } from "./placesExtractor";
import { extractJsonFromSse } from "./sseParser";

const buildSse = (lines: string[]) => `${lines.join("\n")}\n\n`;

test("extractJsonFromSse parses final JSON-RPC payload and yields places", () => {
  const ssePayload = buildSse([
    'data: {"jsonrpc":"2.0","id":"1","result":{"content":[{"type":"text","text":"working..."}]}}',
    'data: {"jsonrpc":"2.0","id":"2","result":{"content":[{"type":"text","text":"{\\"results\\":[{\\"name\\":\\"Noodle Hut\\",\\"place_id\\":\\"abc123\\",\\"lat\\":16.6,\\"lng\\":96.1}]}"}]}}',
  ]);

  const parsed = extractJsonFromSse(ssePayload) as { result?: unknown };
  const { places } = extractPlacesFromMcpResult(parsed.result);

  assert.ok(Array.isArray(places));
  assert.equal(places.length, 1);
});
