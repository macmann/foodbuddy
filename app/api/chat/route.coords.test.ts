import assert from "node:assert/strict";
import test from "node:test";

import { resolveSearchCoords } from "../../../lib/chat/searchCoords";

test("resolveSearchCoords prioritizes explicit location over request coords", async () => {
  let geocodeCalls = 0;
  const reqCoords = { lat: 16.769, lng: 96.178 };
  let geocodeInput: string | null = null;

  const result = await resolveSearchCoords({
    reqCoords,
    locationText: "Thanlyin",
    requestId: "test-request",
    locale: "en",
    countryHint: "MM",
    coords: null,
    geocode: async (locationText) => {
      geocodeCalls += 1;
      geocodeInput = locationText;
      return { coords: { lat: 21, lng: 96 }, formattedAddress: "Fallback" };
    },
  });

  assert.equal(geocodeCalls, 1);
  assert.equal(geocodeInput, "Thanlyin");
  assert.deepEqual(result.searchCoords, { lat: 21, lng: 96 });
  assert.equal(result.coordsSource, "geocoded_text");
});

test("resolveSearchCoords uses request coords when no explicit location is provided", async () => {
  let geocodeCalls = 0;
  const reqCoords = { lat: 16.769, lng: 96.178 };

  const result = await resolveSearchCoords({
    reqCoords,
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
