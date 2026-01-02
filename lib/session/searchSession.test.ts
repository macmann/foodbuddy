import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../db";
import {
  clearPending,
  getOrCreateSession,
  setLastLocation,
  setPending,
} from "./searchSession";

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
