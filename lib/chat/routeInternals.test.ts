import assert from "node:assert/strict";
import test from "node:test";

import { buildNearbySearchArgs } from "./routeInternals";

const baseTool = {
  name: "google_maps_places_nearby_search",
  inputSchema: {
    properties: {
      keyword: { type: "string" },
      latitude: { type: "number" },
      longitude: { type: "number" },
      radius_m: { type: "number" },
      includedTypes: { type: "array" },
    },
  },
};

test("buildNearbySearchArgs uses restaurant includedTypes for food intent", () => {
  const { args } = buildNearbySearchArgs(baseTool, {
    lat: 1,
    lng: 2,
    radiusMeters: 1500,
    keyword: "hotpot",
  });

  assert.deepEqual(args.includedTypes, ["restaurant"]);
});

test("buildNearbySearchArgs omits includedTypes for general intent", () => {
  const { args } = buildNearbySearchArgs(baseTool, {
    lat: 1,
    lng: 2,
    radiusMeters: 1500,
    keyword: "parks",
  });

  assert.equal("includedTypes" in args, false);
});

test("buildNearbySearchArgs never sends point_of_interest", () => {
  const { args } = buildNearbySearchArgs(baseTool, {
    lat: 1,
    lng: 2,
    radiusMeters: 1500,
    keyword: "parks",
    includedTypesOverride: ["point_of_interest"],
  });

  assert.equal("includedTypes" in args, false);
});
