import { parseQuery } from "../reco/engine";

export const PENDING_ACTION_RECOMMEND = "RECOMMEND_PLACES";

export type SessionSnapshot = {
  pendingAction?: string | null;
  pendingKeyword?: string | null;
  lastLat?: number | null;
  lastLng?: number | null;
  lastRadiusM?: number | null;
};

export type RecommendDecision =
  | {
      action: "ask_location";
      keyword: string;
    }
  | {
      action: "geocode";
      keyword: string;
      locationText: string;
    }
  | {
      action: "search";
      keyword: string;
      coords: { lat: number; lng: number };
      radiusM: number;
      source: "request" | "session" | "geocoded";
      locationText?: string;
    };

export type RecommendDecisionInput = {
  message: string;
  action?: string;
  coords?: { lat: number; lng: number };
  locationText?: string;
  radiusM: number;
  session?: SessionSnapshot | null;
  allowSessionLocation?: boolean;
};

const normalizeKeyword = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeLocationText = (value?: string | null): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const resolveRecommendDecision = (
  input: RecommendDecisionInput,
): RecommendDecision | null => {
  const allowSessionLocation = input.allowSessionLocation ?? true;
  const parsed = parseQuery(input.message);
  const parsedKeyword = normalizeKeyword(parsed.keyword);
  const parsedLocationText = normalizeLocationText(parsed.locationText);
  const actionKeyword =
    input.action === "recommend_places" ? normalizeKeyword(input.message) : undefined;
  const session = input.session ?? undefined;
  const pendingKeyword =
    session?.pendingAction === PENDING_ACTION_RECOMMEND
      ? normalizeKeyword(session.pendingKeyword ?? undefined)
      : undefined;
  const keyword = pendingKeyword ?? parsedKeyword ?? actionKeyword;

  if (!keyword) {
    return null;
  }

  const requestLocationText = normalizeLocationText(input.locationText) ?? parsedLocationText;
  const pendingLocationText =
    session?.pendingAction === PENDING_ACTION_RECOMMEND && !requestLocationText
      ? normalizeLocationText(input.message)
      : undefined;
  const locationText = requestLocationText ?? pendingLocationText;

  if (input.coords) {
    return {
      action: "search",
      keyword,
      coords: input.coords,
      radiusM: input.radiusM,
      source: "request",
    };
  }

  if (
    allowSessionLocation &&
    typeof session?.lastLat === "number" &&
    typeof session?.lastLng === "number"
  ) {
    return {
      action: "search",
      keyword,
      coords: { lat: session.lastLat, lng: session.lastLng },
      radiusM: typeof session.lastRadiusM === "number" ? session.lastRadiusM : input.radiusM,
      source: "session",
    };
  }

  if (locationText) {
    return {
      action: "geocode",
      keyword,
      locationText,
    };
  }

  return {
    action: "ask_location",
    keyword,
  };
};
