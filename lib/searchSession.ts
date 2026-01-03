import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { logger } from "./logger";

export type SearchSessionState = {
  sessionId: string;
  channel?: string | null;
  pendingAction?: string | null;
  pendingKeyword?: string | null;
  lastLat?: number | null;
  lastLng?: number | null;
  lastRadiusM?: number | null;
  lastQuery?: string | null;
  nextPageToken?: string | null;
};

let missingSearchSessionTableLogged = false;

const isMissingSearchSessionTableError = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021";

export const loadSearchSession = async (sessionId: string) => {
  try {
    return await prisma.searchSession.findUnique({ where: { sessionId } });
  } catch (err) {
    if (isMissingSearchSessionTableError(err)) {
      logger.warn(
        { sessionId },
        "SearchSession table missing. Run prisma migrate deploy.",
      );
      return null;
    }
    logger.error({ err, sessionId }, "Failed to load search session");
    return null;
  }
};

const buildSessionPayload = (state: SearchSessionState) => {
  const payload: Record<string, unknown> = {};
  if (state.channel !== undefined) {
    payload.channel = state.channel ?? null;
  }
  if (state.pendingAction !== undefined) {
    payload.pendingAction = state.pendingAction ?? null;
  }
  if (state.pendingKeyword !== undefined) {
    payload.pendingKeyword = state.pendingKeyword ?? null;
  }
  if (state.lastLat !== undefined) {
    payload.lastLat = state.lastLat ?? null;
  }
  if (state.lastLng !== undefined) {
    payload.lastLng = state.lastLng ?? null;
  }
  if (state.lastRadiusM !== undefined) {
    payload.lastRadiusM = state.lastRadiusM ?? null;
  }
  if (state.lastQuery !== undefined) {
    payload.lastQuery = state.lastQuery ?? null;
  }
  if (state.nextPageToken !== undefined) {
    payload.nextPageToken = state.nextPageToken ?? null;
  }
  return payload;
};

export const upsertSearchSession = async (state: SearchSessionState) => {
  try {
    const payload = buildSessionPayload(state);
    const result = await prisma.searchSession.upsert({
      where: { sessionId: state.sessionId },
      create: {
        sessionId: state.sessionId,
        channel: state.channel ?? null,
        pendingAction: state.pendingAction ?? null,
        pendingKeyword: state.pendingKeyword ?? null,
        lastLat: state.lastLat ?? null,
        lastLng: state.lastLng ?? null,
        lastRadiusM: state.lastRadiusM ?? null,
        lastQuery: state.lastQuery ?? null,
        nextPageToken: state.nextPageToken ?? null,
      },
      update: payload,
    });
    if (
      state.lastQuery !== undefined ||
      state.lastRadiusM !== undefined ||
      state.nextPageToken !== undefined
    ) {
      logger.info(
        {
          sessionId: state.sessionId,
          hasNextPageToken: Boolean(state.nextPageToken),
          lastQuery: state.lastQuery ?? result.lastQuery ?? undefined,
          radiusM: state.lastRadiusM ?? result.lastRadiusM ?? undefined,
        },
        "Stored session updated",
      );
    }
    return result;
  } catch (err) {
    if (isMissingSearchSessionTableError(err)) {
      if (!missingSearchSessionTableLogged) {
        missingSearchSessionTableLogged = true;
        logger.warn(
          { sessionId: state.sessionId },
          "SearchSession table missing. Run prisma migrate deploy.",
        );
      }
      return null;
    }
    logger.error({ err, sessionId: state.sessionId }, "Failed to upsert search session");
    return null;
  }
};

export const getOrCreateSession = async ({
  sessionId,
  channel,
}: {
  sessionId: string;
  channel?: string | null;
}) => {
  return upsertSearchSession({
    sessionId,
    channel: channel ?? null,
  });
};

export const setPending = async (
  sessionId: string,
  { action, keyword }: { action: string; keyword?: string | null },
) => {
  return upsertSearchSession({
    sessionId,
    pendingAction: action,
    pendingKeyword: keyword ?? null,
  });
};

export const clearPending = async (sessionId: string) => {
  return upsertSearchSession({
    sessionId,
    pendingAction: null,
    pendingKeyword: null,
  });
};

export const setLastLocation = async (
  sessionId: string,
  { lat, lng, radiusM }: { lat: number; lng: number; radiusM?: number | null },
) => {
  return upsertSearchSession({
    sessionId,
    lastLat: lat,
    lastLng: lng,
    lastRadiusM: radiusM ?? null,
  });
};

export const getFollowUpSession = async (sessionId: string) => {
  const stored = await loadSearchSession(sessionId);
  if (
    !stored ||
    stored.lastLat === null ||
    stored.lastLng === null ||
    !stored.lastQuery ||
    stored.lastRadiusM === null
  ) {
    return null;
  }
  return {
    id: stored.sessionId,
    lastQuery: stored.lastQuery,
    lat: stored.lastLat,
    lng: stored.lastLng,
    radius: stored.lastRadiusM,
    nextPageToken: stored.nextPageToken ?? null,
  };
};
