export type SessionPlace = {
  placeId: string;
  name: string;
  rating?: number;
  reviews?: number;
  address?: string;
  lat?: number;
  lng?: number;
  distanceMeters?: number;
  mapsUrl?: string;
  types?: string[];
};

type SessionLocation = {
  lat: number;
  lng: number;
  label: string;
} | null;

export type SessionMemory = {
  lastPlaces: SessionPlace[];
  lastQuery: string;
  lastResolvedLocation: SessionLocation;
  userPrefs: {
    cuisine?: string[];
    budget?: "cheap" | "mid" | "high";
    vibe?: string[];
    dietary?: string[];
  };
  lastIntent: "search" | "refine" | "place_followup" | "smalltalk";
};

type SessionRecord = {
  data: SessionMemory;
  updatedAt: number;
};

const SESSION_TTL_MS = 30 * 60 * 1000;
const sessionStore = new Map<string, SessionRecord>();

const isExpired = (record: SessionRecord, now: number) =>
  now - record.updatedAt > SESSION_TTL_MS;

const pruneExpiredSessions = (now: number) => {
  for (const [sessionId, record] of sessionStore.entries()) {
    if (isExpired(record, now)) {
      sessionStore.delete(sessionId);
    }
  }
};

const buildDefaultMemory = (): SessionMemory => ({
  lastPlaces: [],
  lastQuery: "",
  lastResolvedLocation: null,
  userPrefs: {},
  lastIntent: "smalltalk",
});

export const getSessionMemory = (sessionId: string, now = Date.now()) => {
  const record = sessionStore.get(sessionId);
  if (!record) {
    return null;
  }
  if (isExpired(record, now)) {
    sessionStore.delete(sessionId);
    return null;
  }
  return record.data;
};

export const updateSessionMemory = (
  sessionId: string,
  update: Partial<SessionMemory>,
  now = Date.now(),
) => {
  pruneExpiredSessions(now);
  const existing = sessionStore.get(sessionId)?.data ?? buildDefaultMemory();
  const data: SessionMemory = {
    ...existing,
    ...update,
    userPrefs: {
      ...existing.userPrefs,
      ...(update.userPrefs ?? {}),
    },
  };
  sessionStore.set(sessionId, { data, updatedAt: now });
  return data;
};

export const resetSessionMemory = () => {
  sessionStore.clear();
};
