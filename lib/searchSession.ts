import { prisma } from "./db";
import { logger } from "./logger";

export type SearchSessionState = {
  sessionId: string;
  channel?: string | null;
  lastQuery: string;
  lastLat: number;
  lastLng: number;
  lastRadiusM: number;
  nextPageToken?: string | null;
};

export const loadSearchSession = async (sessionId: string) => {
  try {
    return await prisma.searchSession.findUnique({ where: { sessionId } });
  } catch (err) {
    logger.error({ err, sessionId }, "Failed to load search session");
    return null;
  }
};

export const upsertSearchSession = async (state: SearchSessionState) => {
  try {
    return await prisma.searchSession.upsert({
      where: { sessionId: state.sessionId },
      create: {
        sessionId: state.sessionId,
        channel: state.channel ?? null,
        lastQuery: state.lastQuery,
        lastLat: state.lastLat,
        lastLng: state.lastLng,
        lastRadiusM: state.lastRadiusM,
        nextPageToken: state.nextPageToken ?? null,
      },
      update: {
        channel: state.channel ?? null,
        lastQuery: state.lastQuery,
        lastLat: state.lastLat,
        lastLng: state.lastLng,
        lastRadiusM: state.lastRadiusM,
        nextPageToken: state.nextPageToken ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, sessionId: state.sessionId }, "Failed to upsert search session");
    return null;
  }
};
