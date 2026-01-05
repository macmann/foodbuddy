import type { RecommendationCardData } from "../types/chat";

export type PlaceMini = {
  placeId: string;
  name: string;
  rating?: number;
  userRatingsTotal?: number;
  address?: string;
  distanceMeters?: number;
  mapsUrl?: string;
  types?: string[];
};

export type ListQnaHighlight = {
  title: string;
  details: string;
};

export type ListQnaIntent =
  | "highest_rating"
  | "closest"
  | "most_reviews"
  | "top_n"
  | "recommend"
  | "compare"
  | "vibe"
  | "unknown";

export type ListQnaResult = {
  summary: string;
  rankedPlaces?: PlaceMini[];
  highlights?: ListQnaHighlight[];
  referencedPlaceIds?: string[];
  detectedIntent?: ListQnaIntent;
  needsLocation?: boolean;
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

const normalizeMessage = (message: string) =>
  message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isListQuestion = (message: string) => {
  const normalized = normalizeMessage(message);
  if (!normalized) {
    return false;
  }
  const patterns = [
    /\bhighest rating\b/,
    /\bbest rating\b/,
    /\btop rated\b/,
    /\bclosest\b/,
    /\bnearest\b/,
    /\bnear me\b/,
    /\bmost reviews\b/,
    /\bmost review\b/,
    /\bpopular\b/,
    /\bmost people\b/,
    /\brecommend\b/,
    /\bwhich one should i choose\b/,
    /\bpick one\b/,
    /\btop\s+\d+\b/,
    /\btop\s+(one|two|three|four|five|six)\b/,
    /\bbest\s+\d+\b/,
    /\bcompare\b/,
    /\bvs\b/,
    /\bversus\b/,
    /\bbetween\b/,
    /\bwhich is better\b/,
    /\bbetter one\b/,
    /\bdate\b/,
    /\bfamily\b/,
    /\bkids\b/,
    /\bworking\b/,
    /\bwork\b/,
    /\bquiet\b/,
  ];
  return patterns.some((pattern) => pattern.test(normalized));
};

const detectIntent = (message: string): ListQnaIntent => {
  const normalized = normalizeMessage(message);
  if (!normalized) {
    return "unknown";
  }
  if (/\bcompare\b|\bvs\b|\bversus\b|\bbetween\b/.test(normalized)) {
    return "compare";
  }
  if (/\btop\s+(\d+|one|two|three|four|five|six)\b|\bbest\s+\d+\b/.test(normalized)) {
    return "top_n";
  }
  if (/\bhighest rating\b|\bbest rating\b|\btop rated\b/.test(normalized)) {
    return "highest_rating";
  }
  if (/\bclosest\b|\bnearest\b|\bnear me\b/.test(normalized)) {
    return "closest";
  }
  if (/\bmost reviews\b|\bmost review\b|\bpopular\b|\bmost people\b/.test(normalized)) {
    return "most_reviews";
  }
  if (
    /\brecommend\b|\bwhich one should i choose\b|\bpick one\b|\bbetter one\b|\bwhich is better\b/.test(
      normalized,
    )
  ) {
    return "recommend";
  }
  if (/\bdate\b|\bfamily\b|\bkids\b|\bworking\b|\bwork\b|\bquiet\b/.test(normalized)) {
    return "vibe";
  }
  return "unknown";
};

const parseTopN = (message: string, fallback = 3) => {
  const normalized = normalizeMessage(message);
  const match =
    normalized.match(/\btop\s+(\d+|one|two|three|four|five|six)\b/) ??
    normalized.match(/\bbest\s+(\d+)\b/);
  if (!match) {
    return fallback;
  }
  const token = match[1];
  const number = Number(token);
  if (Number.isFinite(number)) {
    return Math.max(1, number);
  }
  return NUMBER_WORDS[token] ?? fallback;
};

const normalizeName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const resolvePlaceReference = (reference: string, places: PlaceMini[]) => {
  const normalizedRef = normalizeName(reference);
  if (!normalizedRef) {
    return null;
  }
  const exact = places.find((place) => normalizeName(place.name) === normalizedRef);
  if (exact) {
    return exact;
  }
  const matches = places.filter((place) =>
    normalizeName(place.name).includes(normalizedRef),
  );
  if (matches.length === 0) {
    return null;
  }
  return matches.sort(
    (a, b) => normalizeName(a.name).length - normalizeName(b.name).length,
  )[0];
};

const extractComparisonTargets = (message: string) => {
  const trimmed = message.trim();
  const patterns = [
    /compare\s+(.+?)\s+(?:vs|versus)\s+(.+)/i,
    /between\s+(.+?)\s+and\s+(.+)/i,
    /(.+?)\s+vs\.?\s+(.+)/i,
    /better.*?(.+?)\s+or\s+(.+)/i,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      return {
        left: match[1].trim(),
        right: match[2].trim(),
      };
    }
  }
  return null;
};

const formatRating = (rating?: number) =>
  typeof rating === "number" && Number.isFinite(rating) ? rating.toFixed(1) : "—";

const formatReviews = (total?: number) => {
  if (typeof total !== "number" || !Number.isFinite(total)) {
    return "";
  }
  return ` (${total} reviews)`;
};

const formatDistance = (distanceMeters?: number) => {
  if (typeof distanceMeters !== "number" || !Number.isFinite(distanceMeters)) {
    return "distance unavailable";
  }
  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`;
  }
  const km = Math.round((distanceMeters / 1000) * 10) / 10;
  return `${km.toFixed(1).replace(/\.0$/, "")} km`;
};

const buildPlaceDetails = (place: PlaceMini) => {
  const rating = formatRating(place.rating);
  const reviews = formatReviews(place.userRatingsTotal);
  const distance = formatDistance(place.distanceMeters);
  return `${place.name} — ${rating}★${reviews}, ${distance}`;
};

const rankBy = (
  places: PlaceMini[],
  compareFn: (a: PlaceMini, b: PlaceMini) => number,
) => [...places].sort(compareFn);

const scoreRecommendation = (place: PlaceMini) => {
  const rating = typeof place.rating === "number" ? place.rating : 0;
  const reviews = typeof place.userRatingsTotal === "number" ? place.userRatingsTotal : 0;
  const distancePenalty =
    typeof place.distanceMeters === "number" ? place.distanceMeters / 2000 : 0;
  return rating * 2 + Math.log10(reviews + 1) - distancePenalty;
};

const summaryForMissingPlaces = (): ListQnaResult => ({
  summary:
    "I don’t have your latest list yet. Run a search first, and then I can rank or compare the results for you.",
  needsLocation: true,
  detectedIntent: "unknown",
});

export const answerFromLastPlaces = ({
  message,
  lastPlaces,
}: {
  message: string;
  lastPlaces: PlaceMini[] | null | undefined;
  userPrefs?: unknown;
}): ListQnaResult => {
  if (!lastPlaces || lastPlaces.length === 0) {
    return summaryForMissingPlaces();
  }

  const intent = detectIntent(message);
  const references: string[] = [];

  if (intent === "compare") {
    const targets = extractComparisonTargets(message);
    if (!targets) {
      return {
        summary:
          "Which two places should I compare from the last list? You can say something like “Compare A vs B.”",
        detectedIntent: intent,
      };
    }
    const left = resolvePlaceReference(targets.left, lastPlaces);
    const right = resolvePlaceReference(targets.right, lastPlaces);
    if (!left || !right) {
      const missing = [left ? null : targets.left, right ? null : targets.right]
        .filter(Boolean)
        .join(" and ");
      return {
        summary: `I couldn’t find ${missing} in the last list. Which two should I compare?`,
        detectedIntent: intent,
      };
    }
    references.push(left.placeId, right.placeId);
    const leftDetails = buildPlaceDetails(left);
    const rightDetails = buildPlaceDetails(right);
    const recommended =
      scoreRecommendation(left) >= scoreRecommendation(right) ? left : right;
    const summary = `Here’s a quick comparison:\n- ${leftDetails}\n- ${rightDetails}\nBased on ratings, reviews, and distance, I’d lean toward ${recommended.name}.`;
    const rankedPlaces = [
      left,
      right,
      ...lastPlaces.filter(
        (place) => place.placeId !== left.placeId && place.placeId !== right.placeId,
      ),
    ];
    return {
      summary,
      rankedPlaces,
      highlights: [
        { title: "Comparison", details: `${left.name} vs ${right.name}` },
        { title: "Recommendation", details: buildPlaceDetails(recommended) },
      ],
      referencedPlaceIds: references,
      detectedIntent: intent,
    };
  }

  if (intent === "top_n") {
    const n = Math.min(parseTopN(message, 3), lastPlaces.length);
    const rankedPlaces = rankBy(lastPlaces, (a, b) => {
      const ratingDiff = (b.rating ?? 0) - (a.rating ?? 0);
      if (ratingDiff !== 0) {
        return ratingDiff;
      }
      const reviewDiff = (b.userRatingsTotal ?? 0) - (a.userRatingsTotal ?? 0);
      if (reviewDiff !== 0) {
        return reviewDiff;
      }
      return (a.distanceMeters ?? Number.POSITIVE_INFINITY) -
        (b.distanceMeters ?? Number.POSITIVE_INFINITY);
    });
    const top = rankedPlaces.slice(0, n);
    const summaryList = top
      .map((place, index) => `${index + 1}) ${buildPlaceDetails(place)}`)
      .join("; ");
    return {
      summary: `Top ${n} picks based on rating, reviews, and distance: ${summaryList}. Want me to open one?`,
      rankedPlaces,
      highlights: [
        {
          title: `Top ${n}`,
          details: top.map((place) => place.name).join(", "),
        },
      ],
      referencedPlaceIds: top.map((place) => place.placeId),
      detectedIntent: intent,
    };
  }

  if (intent === "highest_rating") {
    const rated = lastPlaces.filter((place) => typeof place.rating === "number");
    if (rated.length === 0) {
      return {
        summary:
          "I don’t have ratings for those yet. Want me to rank by distance or review count instead?",
        detectedIntent: intent,
      };
    }
    const rankedPlaces = rankBy(rated, (a, b) => {
      const ratingDiff = (b.rating ?? 0) - (a.rating ?? 0);
      if (ratingDiff !== 0) {
        return ratingDiff;
      }
      return (b.userRatingsTotal ?? 0) - (a.userRatingsTotal ?? 0);
    });
    const best = rankedPlaces[0];
    const reviewNote =
      typeof best.userRatingsTotal === "number" && best.userRatingsTotal < 5
        ? " It has only a handful of reviews, so take it with a grain of salt."
        : "";
    return {
      summary: `${best.name} is the top-rated at ${formatRating(best.rating)}★${formatReviews(
        best.userRatingsTotal,
      )}.${reviewNote} Want a top 3 list?`,
      rankedPlaces: [
        ...rankedPlaces,
        ...lastPlaces.filter(
          (place) => !rankedPlaces.some((ranked) => ranked.placeId === place.placeId),
        ),
      ],
      highlights: [{ title: "Top rated", details: buildPlaceDetails(best) }],
      referencedPlaceIds: [best.placeId],
      detectedIntent: intent,
    };
  }

  if (intent === "closest") {
    const withDistance = lastPlaces.filter(
      (place) => typeof place.distanceMeters === "number",
    );
    if (withDistance.length === 0) {
      return {
        summary:
          "I don’t have distance info for those results. Want me to rank by rating or review count instead?",
        detectedIntent: intent,
      };
    }
    const rankedPlaces = rankBy(
      withDistance,
      (a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity),
    );
    const closest = rankedPlaces[0];
    return {
      summary: `${closest.name} is the closest at ${formatDistance(
        closest.distanceMeters,
      )}. Want me to sort the rest by distance too?`,
      rankedPlaces: [
        ...rankedPlaces,
        ...lastPlaces.filter(
          (place) => !rankedPlaces.some((ranked) => ranked.placeId === place.placeId),
        ),
      ],
      highlights: [{ title: "Closest", details: buildPlaceDetails(closest) }],
      referencedPlaceIds: [closest.placeId],
      detectedIntent: intent,
    };
  }

  if (intent === "most_reviews") {
    const withReviews = lastPlaces.filter(
      (place) => typeof place.userRatingsTotal === "number",
    );
    if (withReviews.length === 0) {
      return {
        summary:
          "I don’t have review counts for those results. Want me to rank by rating or distance instead?",
        detectedIntent: intent,
      };
    }
    const rankedPlaces = rankBy(
      withReviews,
      (a, b) => (b.userRatingsTotal ?? 0) - (a.userRatingsTotal ?? 0),
    );
    const top = rankedPlaces[0];
    return {
      summary: `${top.name} looks the most popular with ${top.userRatingsTotal} reviews. Want the top 3 by review count?`,
      rankedPlaces: [
        ...rankedPlaces,
        ...lastPlaces.filter(
          (place) => !rankedPlaces.some((ranked) => ranked.placeId === place.placeId),
        ),
      ],
      highlights: [{ title: "Most reviews", details: buildPlaceDetails(top) }],
      referencedPlaceIds: [top.placeId],
      detectedIntent: intent,
    };
  }

  const rankedPlaces = rankBy(lastPlaces, (a, b) => scoreRecommendation(b) - scoreRecommendation(a));
  const best = rankedPlaces[0];

  if (intent === "vibe") {
    return {
      summary: `I can’t reliably see vibe or ambience from Maps. Based on ratings and reviews, I’d lean toward ${best.name}. Want me to prioritize rating, distance, or review count?`,
      rankedPlaces,
      highlights: [{ title: "Best overall", details: buildPlaceDetails(best) }],
      referencedPlaceIds: [best.placeId],
      detectedIntent: intent,
    };
  }

  return {
    summary: `I’d recommend ${best.name} — strong ratings, enough reviews, and not too far. Want me to share the top 3 as well?`,
    rankedPlaces,
    highlights: [{ title: "Recommendation", details: buildPlaceDetails(best) }],
    referencedPlaceIds: [best.placeId],
    detectedIntent: intent === "unknown" ? "recommend" : intent,
  };
};

export const toPlaceMini = (place: RecommendationCardData): PlaceMini => ({
  placeId: place.placeId,
  name: place.name,
  rating: place.rating,
  userRatingsTotal: place.reviewCount,
  address: place.address,
  distanceMeters: place.distanceMeters,
  mapsUrl: place.mapsUrl,
  types: place.types,
});

export const toRecommendationCardData = (place: PlaceMini): RecommendationCardData => ({
  placeId: place.placeId,
  name: place.name,
  rating: place.rating,
  reviewCount: place.userRatingsTotal,
  distanceMeters: place.distanceMeters,
  address: place.address,
  mapsUrl: place.mapsUrl,
  types: place.types,
});

export const coercePlaceMiniList = (raw: unknown): PlaceMini[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      const placeId = typeof entry.placeId === "string" ? entry.placeId : null;
      const name = typeof entry.name === "string" ? entry.name : null;
      if (!placeId || !name) {
        return null;
      }
      const rating =
        typeof entry.rating === "number" && Number.isFinite(entry.rating)
          ? entry.rating
          : undefined;
      const userRatingsTotal =
        typeof entry.userRatingsTotal === "number" && Number.isFinite(entry.userRatingsTotal)
          ? entry.userRatingsTotal
          : undefined;
      const address = typeof entry.address === "string" ? entry.address : undefined;
      const distanceMeters =
        typeof entry.distanceMeters === "number" && Number.isFinite(entry.distanceMeters)
          ? entry.distanceMeters
          : undefined;
      const mapsUrl = typeof entry.mapsUrl === "string" ? entry.mapsUrl : undefined;
      const types = Array.isArray(entry.types)
        ? entry.types.filter((value) => typeof value === "string")
        : undefined;
      return {
        placeId,
        name,
        rating,
        userRatingsTotal,
        address,
        distanceMeters,
        mapsUrl,
        types,
      };
    })
    .filter((place): place is PlaceMini => Boolean(place));
};
