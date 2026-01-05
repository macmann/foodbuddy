import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "./route";
import {
  getSessionMemory,
  resetSessionMemory,
  updateSessionMemory,
} from "../../../lib/chat/sessionMemory";

test("set_pref normalizes budget preferences before storing", async () => {
  resetSessionMemory();
  const sessionId = "session-prefs-expensive";

  const request = new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      anonId: "anon",
      sessionId,
      message: "expensive please",
      action: "set_pref",
    }),
  });

  const response = await POST(request);
  assert.equal(response.status, 200);

  const stored = getSessionMemory(sessionId);
  assert.ok(stored);
  assert.equal(stored.userPrefs.budget, "high");
});

test("set_pref ignores unknown budget strings", async () => {
  resetSessionMemory();
  const sessionId = "session-prefs-unknown";
  updateSessionMemory(sessionId, { userPrefs: { budget: "mid" } });

  const request = new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      anonId: "anon",
      sessionId,
      message: "whatever",
      action: "set_pref",
    }),
  });

  const response = await POST(request);
  assert.equal(response.status, 200);

  const stored = getSessionMemory(sessionId);
  assert.ok(stored);
  assert.equal(stored.userPrefs.budget, "mid");
});
