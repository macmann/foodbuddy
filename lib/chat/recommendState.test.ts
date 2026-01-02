import assert from "node:assert/strict";
import test from "node:test";

import { PENDING_ACTION_RECOMMEND, resolveRecommendDecision } from "./recommendState";

test("no coords + new keyword asks for location and sets pending", () => {
  const decision = resolveRecommendDecision({
    message: "sushi",
    radiusM: 1500,
    session: null,
  });

  assert.equal(decision?.action, "ask_location");
  assert.equal(decision?.keyword, "sushi");
});

test("pending + location text geocodes and searches", () => {
  const decision = resolveRecommendDecision({
    message: "Yangon",
    radiusM: 1500,
    session: {
      pendingAction: PENDING_ACTION_RECOMMEND,
      pendingKeyword: "ramen",
    },
  });

  assert.equal(decision?.action, "geocode");
  assert.equal(decision?.keyword, "ramen");
  assert.equal(decision?.locationText, "Yangon");
});

test("coords present searches directly", () => {
  const decision = resolveRecommendDecision({
    message: "coffee",
    radiusM: 1500,
    coords: { lat: 16.8, lng: 96.1 },
    session: null,
  });

  assert.equal(decision?.action, "search");
  assert.equal(decision?.source, "request");
});

test("last location exists searches without asking again", () => {
  const decision = resolveRecommendDecision({
    message: "noodles",
    radiusM: 1500,
    session: {
      lastLat: 16.8,
      lastLng: 96.1,
      lastRadiusM: 1800,
    },
  });

  assert.equal(decision?.action, "search");
  assert.equal(decision?.source, "session");
});
