import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "./route";
import { resetSessionMemory, updateSessionMemory } from "../../../lib/chat/sessionMemory";

test("list_qna answers highest rating without MCP", async () => {
  const originalFetch = globalThis.fetch;
  resetSessionMemory();

  const sessionId = "session-list-qna";
  updateSessionMemory(sessionId, {
    lastPlaces: [
      {
        placeId: "place-1",
        name: "Beer Project",
        rating: 4.2,
        reviews: 34,
        address: "123 Main St",
        lat: 1,
        lng: 2,
        distanceMeters: 1100,
        mapsUrl: "https://maps.example.com/beer",
        types: ["bar"],
      },
      {
        placeId: "place-2",
        name: "Ginki Bar",
        rating: 4.6,
        reviews: 12,
        address: "456 Market St",
        lat: 1,
        lng: 2,
        distanceMeters: 900,
        mapsUrl: "https://maps.example.com/ginki",
        types: ["bar"],
      },
      {
        placeId: "place-3",
        name: "Sunset Lounge",
        rating: 4.8,
        reviews: 5,
        address: "789 Sunset Blvd",
        lat: 1,
        lng: 2,
        distanceMeters: 2000,
        mapsUrl: "https://maps.example.com/sunset",
        types: ["bar"],
      },
      {
        placeId: "place-4",
        name: "Neighborhood Pub",
        rating: 4.5,
        reviews: 80,
        address: "101 Center Rd",
        lat: 1,
        lng: 2,
        distanceMeters: 400,
        mapsUrl: "https://maps.example.com/pub",
        types: ["bar"],
      },
    ],
    lastQuery: "bars",
    lastResolvedLocation: { lat: 1, lng: 2, label: "Downtown" },
    userPrefs: {},
    lastIntent: "search",
  });

  globalThis.fetch = (async () => {
    throw new Error("MCP should not be called for list_qna");
  }) as typeof fetch;

  const request = new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      anonId: "anon",
      sessionId,
      message: "which one has the highest rating?",
    }),
  });

  try {
    const response = await POST(request);
    const payload = (await response.json()) as {
      message: string;
      meta: { mode?: string };
    };
    assert.equal(payload.meta.mode, "list_qna");
    assert.match(payload.message, /Sunset Lounge/);
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    resetSessionMemory();
  }
});

test("list_qna answers closest, top 3, recommend, and compare", async () => {
  const originalFetch = globalThis.fetch;
  resetSessionMemory();

  const sessionId = "session-list-qna-2";
  updateSessionMemory(sessionId, {
    lastPlaces: [
      {
        placeId: "place-1",
        name: "Beer Project",
        rating: 4.2,
        reviews: 34,
        address: "123 Main St",
        lat: 1,
        lng: 2,
        distanceMeters: 1100,
        mapsUrl: "https://maps.example.com/beer",
        types: ["bar"],
      },
      {
        placeId: "place-2",
        name: "Ginki Bar",
        rating: 4.6,
        reviews: 12,
        address: "456 Market St",
        lat: 1,
        lng: 2,
        distanceMeters: 900,
        mapsUrl: "https://maps.example.com/ginki",
        types: ["bar"],
      },
      {
        placeId: "place-3",
        name: "Sunset Lounge",
        rating: 4.8,
        reviews: 5,
        address: "789 Sunset Blvd",
        lat: 1,
        lng: 2,
        distanceMeters: 2000,
        mapsUrl: "https://maps.example.com/sunset",
        types: ["bar"],
      },
      {
        placeId: "place-4",
        name: "Neighborhood Pub",
        rating: 4.5,
        reviews: 80,
        address: "101 Center Rd",
        lat: 1,
        lng: 2,
        distanceMeters: 400,
        mapsUrl: "https://maps.example.com/pub",
        types: ["bar"],
      },
    ],
    lastQuery: "bars",
    lastResolvedLocation: { lat: 1, lng: 2, label: "Downtown" },
    userPrefs: {},
    lastIntent: "search",
  });

  globalThis.fetch = (async () => {
    throw new Error("MCP should not be called for list_qna");
  }) as typeof fetch;

  try {
    const closestRequest = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        anonId: "anon",
        sessionId,
        message: "which is closest?",
      }),
    });
    const closestResponse = await POST(closestRequest);
    const closestPayload = (await closestResponse.json()) as {
      message: string;
      meta: { mode?: string };
    };
    assert.equal(closestPayload.meta.mode, "list_qna");
    assert.match(closestPayload.message, /Neighborhood Pub/);

    const topRequest = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        anonId: "anon",
        sessionId,
        message: "top 3 options",
      }),
    });
    const topResponse = await POST(topRequest);
    const topPayload = (await topResponse.json()) as {
      places: Array<{ placeId: string }>;
      meta: { mode?: string };
    };
    assert.equal(topPayload.meta.mode, "list_qna");
    assert.deepEqual(
      topPayload.places.map((place) => place.placeId),
      ["place-3", "place-2", "place-4"],
    );

    const recommendRequest = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        anonId: "anon",
        sessionId,
        message: "recommend one",
      }),
    });
    const recommendResponse = await POST(recommendRequest);
    const recommendPayload = (await recommendResponse.json()) as {
      message: string;
      meta: { mode?: string };
    };
    assert.equal(recommendPayload.meta.mode, "list_qna");
    assert.match(recommendPayload.message, /Neighborhood Pub/);

    const compareRequest = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        anonId: "anon",
        sessionId,
        message: "compare Beer Project vs Ginki Bar",
      }),
    });
    const compareResponse = await POST(compareRequest);
    const comparePayload = (await compareResponse.json()) as {
      message: string;
      meta: { mode?: string };
    };
    assert.equal(comparePayload.meta.mode, "list_qna");
    assert.match(comparePayload.message, /Beer Project/);
    assert.match(comparePayload.message, /Ginki Bar/);
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    resetSessionMemory();
  }
});
