import { prisma } from "../db";
import { logger } from "../logger";

export type SearchSessionRecord = {
  id: string;
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

export const getOrCreateSession = async ({
  sessionId,
  channel,
}: {
  sessionId: string;
  channel?: string | null;
}): Promise<SearchSessionRecord | null> => {
  try {
    return await prisma.searchSession.upsert({
      where: { sessionId },
      create: {
        sessionId,
        channel: channel ?? null,
      },
      update: {
        channel: channel ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, sessionId }, "Failed to load or create search session");
    return null;
  }
};

export const setPending = async (
  sessionId: string,
  { action, keyword }: { action: string; keyword?: string | null },
): Promise<SearchSessionRecord | null> => {
  try {
    return await prisma.searchSession.upsert({
      where: { sessionId },
      create: {
        sessionId,
        pendingAction: action,
        pendingKeyword: keyword ?? null,
      },
      update: {
        pendingAction: action,
        pendingKeyword: keyword ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, sessionId }, "Failed to set pending search session");
    return null;
  }
};

export const clearPending = async (
  sessionId: string,
): Promise<SearchSessionRecord | null> => {
  try {
    return await prisma.searchSession.upsert({
      where: { sessionId },
      create: {
        sessionId,
        pendingAction: null,
        pendingKeyword: null,
      },
      update: {
        pendingAction: null,
        pendingKeyword: null,
      },
    });
  } catch (err) {
    logger.error({ err, sessionId }, "Failed to clear pending search session");
    return null;
  }
};

export const setLastLocation = async (
  sessionId: string,
  { lat, lng, radiusM }: { lat: number; lng: number; radiusM?: number | null },
): Promise<SearchSessionRecord | null> => {
  try {
    return await prisma.searchSession.upsert({
      where: { sessionId },
      create: {
        sessionId,
        lastLat: lat,
        lastLng: lng,
        lastRadiusM: radiusM ?? null,
      },
      update: {
        lastLat: lat,
        lastLng: lng,
        lastRadiusM: radiusM ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, sessionId }, "Failed to update last location for search session");
    return null;
  }
};
