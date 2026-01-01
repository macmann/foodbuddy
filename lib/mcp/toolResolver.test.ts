import assert from "node:assert/strict";
import test from "node:test";

import { resolveMcpTools, selectSearchTool } from "./toolResolver";

const tools = [
  {
    name: "google_maps_places_nearby_search",
    description: "Nearby search",
    inputSchema: { properties: { latitude: {}, longitude: {}, radius_m: {}, keyword: {} } },
  },
  {
    name: "google_maps_places_text_search",
    description: "Text search",
    inputSchema: { properties: { query: {} } },
  },
  {
    name: "google_maps_geocode",
    description: "Geocode",
    inputSchema: { properties: { address: {} } },
  },
  {
    name: "google_maps_place_details",
    description: "Details",
    inputSchema: { properties: { place_id: {} } },
  },
];

test("resolveMcpTools prefers nearby search and exposes text search", () => {
  const resolved = resolveMcpTools(tools);
  assert.equal(resolved.nearbySearch?.name, "google_maps_places_nearby_search");
  assert.equal(resolved.textSearch?.name, "google_maps_places_text_search");
  assert.equal(resolved.geocode?.name, "google_maps_geocode");
  assert.equal(resolved.placeDetails?.name, "google_maps_place_details");
});

test("selectSearchTool prefers nearby when coordinates exist", () => {
  const resolved = resolveMcpTools(tools);
  const selection = selectSearchTool(resolved, { hasCoordinates: true });
  assert.equal(selection.tool?.name, "google_maps_places_nearby_search");
  assert.equal(selection.strategy, "nearby");
});
