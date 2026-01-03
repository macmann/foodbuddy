import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeMcpPlace } from "./normalizeMcpPlace";

test("normalizeMcpPlace returns data for a Google Places result shape", () => {
  const origin = { lat: 37.7749, lng: -122.4194 };
  const place = {
    place_id: "place_123",
    name: "Cafe Central",
    formatted_address: "123 Main St, San Francisco, CA",
    rating: 4.6,
    user_ratings_total: 128,
    geometry: {
      location: { lat: 37.775, lng: -122.419 },
    },
    types: ["cafe", "restaurant"],
    url: "https://maps.example.com",
  };

  const normalized = normalizeMcpPlace(place, origin);

  assert.ok(normalized);
  assert.equal(normalized.placeId, "place_123");
  assert.equal(normalized.name, "Cafe Central");
  assert.equal(normalized.address, "123 Main St, San Francisco, CA");
  assert.equal(normalized.lat, 37.775);
  assert.equal(normalized.lng, -122.419);
  assert.deepEqual(normalized.types, ["cafe", "restaurant"]);
});

test("normalizeMcpPlace returns null when name or coordinates are missing", () => {
  const origin = { lat: 37.7749, lng: -122.4194 };

  assert.equal(normalizeMcpPlace({ place_id: "missing-name" }, origin), null);
  assert.equal(
    normalizeMcpPlace({ name: "Missing coords", place_id: "missing-coords" }, origin),
    null,
  );
});
