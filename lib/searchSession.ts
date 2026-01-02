import { prisma } from "./db";

export type SearchSessionState = {
  id: string;
  lastQuery: string;
  lat: number;
  lng: number;
  radius: number;
  nextPageToken?: string | null;
};

export const loadSearchSession = async (id: string) => {
  return prisma.searchSession.findUnique({ where: { id } });
};

export const upsertSearchSession = async (state: SearchSessionState) => {
  return prisma.searchSession.upsert({
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
};
