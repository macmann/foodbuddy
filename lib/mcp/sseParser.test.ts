import assert from "node:assert/strict";

import { extractJsonFromSse } from "./sseParser";

const sample = `event: message
data: {"jsonrpc":"2.0","result":{"tools":[]}}

`;

const result = extractJsonFromSse(sample);

assert.equal(typeof result, "object");
assert.ok(result && "result" in result, "Expected JSON-RPC result payload");
