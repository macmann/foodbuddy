import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "./route";

test("POST asks for location when no explicit location or coords are provided", async () => {
  const request = new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      anonId: "anon",
      message: "noodle",
    }),
  });

  const response = await POST(request);
  const payload = (await response.json()) as {
    message: string;
    meta?: { needs_location?: boolean; mode?: string };
  };

  assert.equal(payload.meta?.needs_location, true);
  assert.equal(payload.meta?.mode, "needs_location");
  assert.match(payload.message.toLowerCase(), /location/);
});
