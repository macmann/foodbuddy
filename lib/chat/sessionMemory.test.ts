import assert from "node:assert/strict";
import test from "node:test";

import { getSessionMemory, resetSessionMemory, updateSessionMemory } from "./sessionMemory";

test("session memory persists lastPlaces and lastResolvedLocation across calls", () => {
  resetSessionMemory();
  const sessionId = "session-1";

  updateSessionMemory(sessionId, {
    lastResolvedLocation: { lat: 1.23, lng: 4.56, label: "Downtown" },
  });

  updateSessionMemory(sessionId, {
    lastPlaces: [
      {
        placeId: "place-1",
        name: "Cafe One",
        rating: 4.7,
        reviews: 120,
        address: "123 Main St",
        lat: 1.23,
        lng: 4.56,
        distanceMeters: 250,
        mapsUrl: "https://maps.example.com/place-1",
        types: ["cafe"],
      },
    ],
    lastQuery: "coffee",
    lastIntent: "search",
  });

  const stored = getSessionMemory(sessionId);
  assert.ok(stored);
  assert.equal(stored.lastResolvedLocation?.label, "Downtown");
  assert.equal(stored.lastPlaces.length, 1);
  assert.equal(stored.lastPlaces[0]?.placeId, "place-1");
});
