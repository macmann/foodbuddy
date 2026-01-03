import assert from "node:assert/strict";
import test from "node:test";

import { resolveExplicitLocationForSearch } from "./resolveLocation";

test("explicit location overrides gps coords", async () => {
  const result = await resolveExplicitLocationForSearch({
    message: "Chinese food in yangon",
    requestId: "test-request",
    gpsCoords: { lat: 21, lng: 96 },
    resolver: async () => ({
      lat: 16.8,
      lng: 96.15,
      formattedAddress: "Yangon, Myanmar",
      confidence: "high",
    }),
  });

  assert.equal(result.locationSource, "explicit_text");
  assert.deepEqual(result.coords, { lat: 16.8, lng: 96.15 });
  assert.match(result.cleanedQuery.toLowerCase(), /chinese food/);
});
