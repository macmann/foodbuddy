import assert from "node:assert/strict";
import test from "node:test";

import { applyGuardrails } from "./locationGuardrails";
import type { LocationParse } from "./locationParseSchema";

const baseParse = (overrides: Partial<LocationParse> = {}): LocationParse => ({
  intent: "nearby_search",
  query: "noodle",
  location_text: undefined,
  use_device_location: false,
  radius_m: 1500,
  place_types: ["restaurant"],
  confidence: 0.9,
  ...overrides,
});

test("guardrails keep explicit location and prefer device coords", () => {
  const result = applyGuardrails(baseParse({ location_text: "Thanlyin" }), {
    coords: { lat: 16.0, lng: 96.0 },
    requestId: "test-request",
  });

  assert.equal(result.location_text, "Thanlyin");
  assert.equal(result.use_device_location, true);
});

test("guardrails discard generic location tokens", () => {
  const result = applyGuardrails(baseParse({ location_text: "place" }), {
    coords: { lat: 16.0, lng: 96.0 },
    requestId: "test-request",
  });

  assert.equal(result.location_text, undefined);
  assert.equal(result.use_device_location, true);
  assert.equal(result.discardedLocationReason, "generic_location");
});

test("guardrails require clarification when no coords or location", () => {
  const result = applyGuardrails(baseParse({ location_text: undefined }), {
    coords: null,
    requestId: "test-request",
  });

  assert.equal(result.intent, "clarify");
});

test("guardrails use device location when coords exist and no location text", () => {
  const result = applyGuardrails(baseParse({ location_text: undefined }), {
    coords: { lat: 16.0, lng: 96.0 },
    requestId: "test-request",
  });

  assert.equal(result.use_device_location, true);
  assert.equal(result.intent, "nearby_search");
});

test("guardrails skip low confidence location without coords", () => {
  const result = applyGuardrails(
    baseParse({ location_text: "Yangon", confidence: 0.4 }),
    {
      coords: null,
      requestId: "test-request",
    },
  );

  assert.equal(result.location_text, undefined);
  assert.equal(result.intent, "clarify");
  assert.equal(result.discardedLocationReason, "low_confidence_location");
});
