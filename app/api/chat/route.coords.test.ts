import assert from "node:assert/strict";
import test from "node:test";

import { resolveSearchCoords } from "../../../lib/chat/searchCoords";

test("resolveSearchCoords prioritizes request coords over geocoding", async () => {
  let geocodeCalls = 0;
  const reqCoords = { lat: 16.769, lng: 96.178 };

  const result = await resolveSearchCoords({
    reqCoords,
    locationText: "Yangon",
    sessionCoords: { lat: 21, lng: 96 },
    requestId: "test-request",
    locale: "en",
    countryHint: "MM",
    coords: null,
    geocode: async () => {
      geocodeCalls += 1;
      return { coords: { lat: 21, lng: 96 }, formattedAddress: "Fallback" };
    },
  });

  assert.equal(geocodeCalls, 0);
  assert.deepEqual(result.searchCoords, reqCoords);
  assert.equal(result.coordsSource, "request_coords");
});
