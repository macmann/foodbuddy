import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "./route";
import { resetSessionMemory, updateSessionMemory } from "../../../lib/chat/sessionMemory";

test("refine uses local list without calling MCP when enough results exist", async () => {
  const originalFetch = globalThis.fetch;
  resetSessionMemory();

  const sessionId = "session-refine";
  updateSessionMemory(sessionId, {
    lastPlaces: [
      {
        placeId: "place-1",
        name: "Near Spot",
        rating: 4.2,
        reviews: 20,
        address: "123 Main St",
        lat: 1,
        lng: 2,
        distanceMeters: 200,
        mapsUrl: "https://maps.example.com/near",
        types: ["restaurant"],
      },
      {
        placeId: "place-2",
        name: "Far Spot",
        rating: 4.8,
        reviews: 120,
        address: "456 Side St",
        lat: 1,
        lng: 2,
        distanceMeters: 1200,
        mapsUrl: "https://maps.example.com/far",
        types: ["restaurant"],
      },
      {
        placeId: "place-3",
        name: "Mid Spot",
        rating: 4.1,
        reviews: 55,
        address: "789 Market St",
        lat: 1,
        lng: 2,
        distanceMeters: 600,
        mapsUrl: "https://maps.example.com/mid",
        types: ["restaurant"],
      },
    ],
    lastQuery: "noodles",
    lastResolvedLocation: { lat: 1, lng: 2, label: "Downtown" },
    userPrefs: {},
    lastIntent: "search",
  });

  globalThis.fetch = (async () => {
    throw new Error("MCP should not be called for local refine");
  }) as typeof fetch;

  const request = new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      anonId: "anon",
      sessionId,
      message: "closer options",
    }),
  });

  try {
    const response = await POST(request);
    const payload = (await response.json()) as { places: Array<{ placeId: string }> };
    assert.equal(payload.places[0]?.placeId, "place-1");
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    resetSessionMemory();
  }
});
