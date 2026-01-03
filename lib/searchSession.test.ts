import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "./db";
import {
  clearPending,
  getFollowUpSession,
  getOrCreateSession,
  loadSearchSession,
  setLastLocation,
  setPending,
  upsertSearchSession,
} from "./searchSession";
import { PENDING_ACTION_RECOMMEND, resolveRecommendDecision } from "./chat/recommendState";

const hasDatabase = Boolean(process.env.DATABASE_URL);

test("SearchSession CRUD (integration)", { skip: !hasDatabase }, async () => {
  const sessionId = `test-session-${Date.now()}`;

  const created = await getOrCreateSession({ sessionId, channel: "TEST" });
  assert.equal(created?.sessionId, sessionId);

  const pending = await setPending(sessionId, {
    action: "RECOMMEND_PLACES",
    keyword: "coffee",
  });
  assert.equal(pending?.pendingAction, "RECOMMEND_PLACES");
  assert.equal(pending?.pendingKeyword, "coffee");

  const updated = await setLastLocation(sessionId, {
    lat: 16.8,
    lng: 96.1,
    radiusM: 2000,
  });
  assert.equal(updated?.lastLat, 16.8);
  assert.equal(updated?.lastLng, 96.1);
  assert.equal(updated?.lastRadiusM, 2000);

  const cleared = await clearPending(sessionId);
  assert.equal(cleared?.pendingAction, null);
  assert.equal(cleared?.pendingKeyword, null);

  await prisma.searchSession.delete({ where: { sessionId } });
});

test("SearchSession pending flow and follow-up guards", { skip: !hasDatabase }, async () => {
  const sessionId = `test-session-flow-${Date.now()}`;

  await getOrCreateSession({ sessionId, channel: "TEST" });

  const decisionAsk = resolveRecommendDecision({
    message: "noodle",
    radiusM: 1500,
    session: null,
  });
  assert.equal(decisionAsk?.action, "ask_location");

  await setPending(sessionId, {
    action: PENDING_ACTION_RECOMMEND,
    keyword: "noodle",
  });

  const pendingSession = await loadSearchSession(sessionId);
  const decisionGeocode = resolveRecommendDecision({
    message: "Yangon",
    radiusM: 1500,
    session: pendingSession ?? undefined,
  });
  assert.equal(decisionGeocode?.action, "geocode");
  assert.equal(decisionGeocode?.keyword, "noodle");

  await clearPending(sessionId);
  const cleared = await loadSearchSession(sessionId);
  assert.equal(cleared?.pendingAction, null);
  assert.equal(cleared?.pendingKeyword, null);

  const missingFollowUp = await getFollowUpSession(`missing-${sessionId}`);
  assert.equal(missingFollowUp, null);

  await upsertSearchSession({
    sessionId,
    lastQuery: "noodle",
    lastLat: 16.8,
    lastLng: 96.1,
    lastRadiusM: 1500,
  });

  const followUp = await getFollowUpSession(sessionId);
  assert.equal(followUp?.lastQuery, "noodle");
  assert.equal(followUp?.radius, 1500);

  await prisma.searchSession.delete({ where: { sessionId } });
});
