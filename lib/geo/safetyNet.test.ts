import assert from "node:assert/strict";
import test from "node:test";
import { filterByMaxDistance } from "./safetyNet";
import { haversineMeters } from "../reco/scoring";

test("filterByMaxDistance keeps nearby items within max distance", () => {
  const origin = { lat: 16.8409, lng: 96.1735 };
  const items = [{ id: "near", lat: 16.85, lng: 96.18 }];
  const result = filterByMaxDistance(
    origin,
    items,
    (item) => ({ lat: item.lat, lng: item.lng }),
    5_000,
  );

  assert.equal(result.kept.length, 1);
  assert.equal(result.droppedCount, 0);
});

test("filterByMaxDistance drops far items", () => {
  const origin = { lat: 16.8409, lng: 96.1735 };
  const items = [{ id: "far", lat: 40.7128, lng: -74.006 }];
  const result = filterByMaxDistance(
    origin,
    items,
    (item) => ({ lat: item.lat, lng: item.lng }),
    5_000,
  );

  assert.equal(result.kept.length, 0);
  assert.equal(result.droppedCount, 1);
});

test("filterByMaxDistance drops items with missing coordinates", () => {
  const origin = { lat: 16.8409, lng: 96.1735 };
  const items = [{ id: "missing" }];
  const result = filterByMaxDistance(origin, items, () => null, 5_000);

  assert.equal(result.kept.length, 0);
  assert.equal(result.droppedCount, 1);
});

test("filterByMaxDistance keeps all items when origin is null", () => {
  const items = [{ id: "missing" }, { id: "near" }];
  const result = filterByMaxDistance(null, items, () => null, 5_000);

  assert.equal(result.kept.length, items.length);
  assert.equal(result.droppedCount, 0);
});

test("filterByMaxDistance returns max kept distance", () => {
  const origin = { lat: 16.8409, lng: 96.1735 };
  const items = [
    { id: "near", lat: 16.85, lng: 96.18 },
    { id: "mid", lat: 16.87, lng: 96.2 },
  ];
  const result = filterByMaxDistance(
    origin,
    items,
    (item) => ({ lat: item.lat, lng: item.lng }),
    50_000,
  );
  const expectedMax = Math.max(
    haversineMeters(origin, { lat: items[0].lat, lng: items[0].lng }),
    haversineMeters(origin, { lat: items[1].lat, lng: items[1].lng }),
  );

  assert.equal(result.kept.length, 2);
  assert.ok(result.maxKeptDistance !== undefined);
  assert.ok(Math.abs(result.maxKeptDistance - expectedMax) < 0.0001);
});
