import assert from "node:assert/strict";
import test from "node:test";

import { resolvePlaceReference } from "./resolvePlaceReference";

test("resolvePlaceReference matches exact place name", () => {
  const result = resolvePlaceReference("beer project", [
    {
      placeId: "place-1",
      name: "Beer Project",
      rating: 4.5,
      reviews: 210,
      address: "123 Main St",
      lat: 1,
      lng: 2,
      distanceMeters: 300,
      mapsUrl: "https://maps.example.com/beer-project",
      types: ["bar"],
    },
  ]);

  assert.ok(result);
  assert.equal(result.place.name, "Beer Project");
  assert.ok(result.score >= 0.78);
});

test("resolvePlaceReference matches fuzzy abbreviations", () => {
  const result = resolvePlaceReference("B2O", [
    {
      placeId: "place-2",
      name: "B2O Bar and Restaurant",
      rating: 4.2,
      reviews: 98,
      address: "456 River Rd",
      lat: 3,
      lng: 4,
      distanceMeters: 1200,
      mapsUrl: "https://maps.example.com/b2o",
      types: ["bar"],
    },
  ]);

  assert.ok(result);
  assert.equal(result.place.placeId, "place-2");
  assert.ok(result.score >= 0.78);
});
