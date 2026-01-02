import { Prisma } from "@prisma/client";

import { prisma } from "./db";
import { logger } from "./logger";

export type SearchSessionState = {
  id: string;
  lastQuery: string;
  lat: number;
  lng: number;
  radius: number;
  nextPageToken?: string | null;
};

export const loadSearchSession = async (id: string) => {
  try {
    return await prisma.searchSession.findUnique({ where: { id } });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2021" &&
      String((err.meta as { table?: string } | undefined)?.table ?? "").includes(
        "SearchSession",
      )
    ) {
      logger.warn({ err }, "SearchSession table missing; skipping session load");
      return null;
    }
    throw err;
  }
};

export const upsertSearchSession = async (state: SearchSessionState) => {
  try {
    return await prisma.searchSession.upsert({
      where: { id: state.id },
      create: {
        id: state.id,
        lastQuery: state.lastQuery,
        lat: state.lat,
        lng: state.lng,
        radius: state.radius,
        nextPageToken: state.nextPageToken ?? null,
      },
      update: {
        lastQuery: state.lastQuery,
        lat: state.lat,
        lng: state.lng,
        radius: state.radius,
        nextPageToken: state.nextPageToken ?? null,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2021" &&
      String((err.meta as { table?: string } | undefined)?.table ?? "").includes(
        "SearchSession",
      )
    ) {
      logger.warn({ err }, "SearchSession table missing; skipping session upsert");
      return null;
    }
    throw err;
  }
};
