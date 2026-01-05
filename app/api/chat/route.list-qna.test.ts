import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { upsertSearchSession } from "../../../lib/searchSession";
import type { PlaceMini } from "../../../lib/chat/listQna";
import { POST } from "./route";

const seedPlaces = (): PlaceMini[] => [
  {
    placeId: "beer-project",
    name: "Beer Project",
    rating: 4.6,
    userRatingsTotal: 120,
    address: "Main Street",
    distanceMeters: 1500,
  },
  {
    placeId: "ginki-bar",
    name: "Ginki Bar",
    rating: 4.2,
    userRatingsTotal: 80,
    address: "Second Street",
    distanceMeters: 600,
  },
  {
    placeId: "sunset-grill",
    name: "Sunset Grill",
    rating: 4.8,
    userRatingsTotal: 4,
    address: "Third Street",
    distanceMeters: 800,
  },
  {
    placeId: "noodle-house",
    name: "Noodle House",
    rating: 4.1,
    userRatingsTotal: 200,
    address: "Fourth Street",
    distanceMeters: 500,
  },
  {
    placeId: "coffee-spot",
    name: "Coffee Spot",
    rating: 4.5,
    userRatingsTotal: 10,
    address: "Fifth Street",
  },
];

const buildRequest = (sessionId: string, message: string) =>
  new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      anonId: "anon",
      sessionId,
      message,
    }),
  });

const seedSession = async () => {
  const sessionId = randomUUID();
  await upsertSearchSession({
    sessionId,
    lastPlaces: seedPlaces(),
  });
  return sessionId;
};

test("POST answers highest rating from last places without MCP", async () => {
  const sessionId = await seedSession();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("MCP call should not happen");
  };

  try {
    const response = await POST(buildRequest(sessionId, "which one has the highest rating?"));
    const payload = (await response.json()) as {
      message: string;
      meta?: { mode?: string };
    };

    assert.equal(payload.meta?.mode, "list_qna");
    assert.match(payload.message, /Sunset Grill/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST answers closest from last places", async () => {
  const sessionId = await seedSession();
  const response = await POST(buildRequest(sessionId, "which is closest?"));
  const payload = (await response.json()) as { message: string; meta?: { mode?: string } };

  assert.equal(payload.meta?.mode, "list_qna");
  assert.match(payload.message, /Noodle House/i);
});

test("POST answers top 3 from last places", async () => {
  const sessionId = await seedSession();
  const response = await POST(buildRequest(sessionId, "top 3 options"));
  const payload = (await response.json()) as { message: string; meta?: { mode?: string } };

  assert.equal(payload.meta?.mode, "list_qna");
  assert.match(payload.message, /Sunset Grill/i);
  assert.match(payload.message, /Beer Project/i);
  assert.match(payload.message, /Coffee Spot/i);
});

test("POST answers recommendation from last places", async () => {
  const sessionId = await seedSession();
  const response = await POST(buildRequest(sessionId, "recommend one"));
  const payload = (await response.json()) as { message: string; meta?: { mode?: string } };

  assert.equal(payload.meta?.mode, "list_qna");
  assert.match(payload.message, /Beer Project/i);
});

test("POST compares two places from last places", async () => {
  const sessionId = await seedSession();
  const response = await POST(buildRequest(sessionId, "compare Beer Project vs Ginki Bar"));
  const payload = (await response.json()) as { message: string; meta?: { mode?: string } };

  assert.equal(payload.meta?.mode, "list_qna");
  assert.match(payload.message, /Beer Project/i);
  assert.match(payload.message, /Ginki Bar/i);
});
