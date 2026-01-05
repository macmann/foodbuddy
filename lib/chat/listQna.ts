import type { SessionPlace } from "./sessionMemory";
import { resolvePlaceReference } from "./resolvePlaceReference";

export type ListQnaHighlight = { title: string; details: string };

export type ListQnaResult = {
  summary: string;
  rankedPlaces?: SessionPlace[];
  highlights?: ListQnaHighlight[];
  referencedPlaceIds?: string[];
  detectedIntent: ListQnaIntent;
};

export type ListQnaIntent =
  | "highest_rating"
  | "closest"
  | "most_reviews"
  | "recommend_one"
  | "top_n"
  | "compare"
  | "vibe"
  | "unknown";

const WORD_NUMBER_MAP: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const parseTopN = (message: string) => {
  const normalized = normalize(message);
  const digitMatch = normalized.match(/\btop\s+(\d+)\b/) ??
    normalized.match(/\bbest\s+(\d+)\b/);
  if (digitMatch) {
    return Math.max(1, Number(digitMatch[1]));
  }
  const wordMatch = normalized.match(/\btop\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (wordMatch) {
    return WORD_NUMBER_MAP[wordMatch[1]] ?? null;
  }
  return null;
};

const VIBE_TERMS = ["date", "romantic", "family", "working", "quiet", "work", "study"];

const extractCompareTargets = (message: string) => {
  const patterns = [
    /compare\s+(.+?)\s+vs\.?\s+(.+)/i,
    /compare\s+(.+?)\s+and\s+(.+)/i,
    /(.+?)\s+vs\.?\s+(.+)/i,
    /between\s+(.+?)\s+and\s+(.+)/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1] && match?.[2]) {
      const left = match[1].trim().replace(/[?.!]+$/, "");
      const right = match[2].trim().replace(/[?.!]+$/, "");
      if (left && right) {
        return { left, right };
      }
    }
  }
  return null;
};

const detectListQnaIntent = (message: string) => {
  const normalized = normalize(message);
  if (!normalized) {
    return { intent: "unknown" as const };
  }

  const compareTargets = extractCompareTargets(message);
  if (compareTargets) {
    return { intent: "compare" as const, compareTargets };
  }

  const topN = parseTopN(message);
  if (topN) {
    return { intent: "top_n" as const, topN };
  }

  if (/\b(highest rating|best rating|top rated|highest rated|best rated)\b/.test(normalized)) {
    return { intent: "highest_rating" as const };
  }

  if (/\b(closest|nearest|near me|nearby)\b/.test(normalized)) {
    return { intent: "closest" as const };
  }

  if (/\b(most reviews|most people|popular|most reviewed)\b/.test(normalized)) {
    return { intent: "most_reviews" as const };
  }

  if (
    /\b(recommend|pick one|choose one|which one should i choose|which should i choose)\b/.test(
      normalized,
    )
  ) {
    return { intent: "recommend_one" as const };
  }

  if (/\b(which is better|better one)\b/.test(normalized)) {
    return { intent: "compare" as const, compareTargets };
  }

  if (VIBE_TERMS.some((term) => normalized.includes(term))) {
    return { intent: "vibe" as const };
  }

  return { intent: "unknown" as const };
};

export const isListQuestion = (message: string) =>
  detectListQnaIntent(message).intent !== "unknown";

const formatDistance = (distanceMeters?: number) => {
  if (typeof distanceMeters !== "number" || Number.isNaN(distanceMeters)) {
    return "distance unknown";
  }
  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)}m`;
  }
  return `${(distanceMeters / 1000).toFixed(1)}km`;
};

const formatRating = (rating?: number) =>
  typeof rating === "number" ? `${rating.toFixed(1)}★` : "no rating";

const formatReviews = (reviews?: number) =>
  typeof reviews === "number" ? `${reviews} reviews` : "no review count";

const buildHighlight = (title: string, place: SessionPlace) => {
  const ratingText = formatRating(place.rating);
  const reviewText = formatReviews(place.reviews);
  const distanceText = formatDistance(place.distanceMeters);
  return {
    title,
    details: `${place.name} — ${ratingText} (${reviewText}), ${distanceText}`,
  };
};

const sortByRating = (a: SessionPlace, b: SessionPlace) => {
  const ratingA = a.rating ?? -1;
  const ratingB = b.rating ?? -1;
  if (ratingA === ratingB) {
    return (b.reviews ?? 0) - (a.reviews ?? 0);
  }
  return ratingB - ratingA;
};

const sortByDistance = (a: SessionPlace, b: SessionPlace) => {
  const distanceA = a.distanceMeters ?? Number.POSITIVE_INFINITY;
  const distanceB = b.distanceMeters ?? Number.POSITIVE_INFINITY;
  return distanceA - distanceB;
};

const sortByReviews = (a: SessionPlace, b: SessionPlace) =>
  (b.reviews ?? -1) - (a.reviews ?? -1);

const scorePlace = (place: SessionPlace) => {
  const ratingScore = (place.rating ?? 0) * 2;
  const reviewScore = Math.log10((place.reviews ?? 0) + 1);
  const distancePenalty =
    typeof place.distanceMeters === "number" ? place.distanceMeters / 2000 : 0;
  return ratingScore + reviewScore - distancePenalty;
};

export const answerFromLastPlaces = (opts: {
  message: string;
  lastPlaces: SessionPlace[];
  userPrefs?: Record<string, unknown>;
}): ListQnaResult => {
  const { message, lastPlaces } = opts;
  const intentResult = detectListQnaIntent(message);
  const detectedIntent = intentResult.intent;

  if (!lastPlaces || lastPlaces.length === 0) {
    return {
      summary:
        "I don't have a recent list to compare yet. Run a search and I can rank or compare the results for you.",
      detectedIntent,
    };
  }

  switch (detectedIntent) {
    case "highest_rating": {
      const sorted = [...lastPlaces].sort(sortByRating);
      const top = sorted[0];
      if (!top || typeof top.rating !== "number") {
        return {
          summary: "I don't see ratings for these results yet. Want me to search again?",
          detectedIntent,
        };
      }
      const reviewNote =
        typeof top.reviews === "number" && top.reviews < 5
          ? " It only has a small number of reviews, so take it with a grain of salt."
          : "";
      return {
        summary: `${top.name} has the highest rating at ${top.rating.toFixed(1)}★.${
          reviewNote
        } Want another comparison?`,
        rankedPlaces: [top],
        highlights: [buildHighlight("Top rated", top)],
        referencedPlaceIds: [top.placeId],
        detectedIntent,
      };
    }
    case "closest": {
      const sorted = [...lastPlaces].sort(sortByDistance);
      const top = sorted.find(
        (place) => typeof place.distanceMeters === "number" && !Number.isNaN(place.distanceMeters),
      );
      if (!top) {
        return {
          summary:
            "I don't have distance data for these results, so I can't tell which is closest. Want me to search again?",
          detectedIntent,
        };
      }
      return {
        summary: `${top.name} looks closest at about ${formatDistance(
          top.distanceMeters,
        )}. Want the next closest too?`,
        rankedPlaces: [top],
        highlights: [buildHighlight("Closest", top)],
        referencedPlaceIds: [top.placeId],
        detectedIntent,
      };
    }
    case "most_reviews": {
      const sorted = [...lastPlaces].sort(sortByReviews);
      const top = sorted[0];
      if (!top || typeof top.reviews !== "number") {
        return {
          summary:
            "I don't have review counts for these results yet. Want me to search again?",
          detectedIntent,
        };
      }
      return {
        summary: `${top.name} has the most reviews (${top.reviews}). Want the top few by popularity?`,
        rankedPlaces: [top],
        highlights: [buildHighlight("Most reviews", top)],
        referencedPlaceIds: [top.placeId],
        detectedIntent,
      };
    }
    case "top_n": {
      const topN = Math.max(intentResult.topN ?? 3, 1);
      const sorted = [...lastPlaces].sort((a, b) => {
        const ratingCompare = sortByRating(a, b);
        if (ratingCompare !== 0) {
          return ratingCompare;
        }
        const reviewCompare = sortByReviews(a, b);
        if (reviewCompare !== 0) {
          return reviewCompare;
        }
        return sortByDistance(a, b);
      });
      const selected = sorted.slice(0, topN);
      return {
        summary: `Here are the top ${topN} options based on rating and reviews. Want me to narrow it down further?`,
        rankedPlaces: selected,
        highlights: selected.slice(0, 2).map((place, index) =>
          buildHighlight(index === 0 ? "Top pick" : "Runner up", place),
        ),
        referencedPlaceIds: selected.map((place) => place.placeId),
        detectedIntent,
      };
    }
    case "recommend_one": {
      const scored = [...lastPlaces].sort((a, b) => scorePlace(b) - scorePlace(a));
      const top = scored[0];
      if (!top) {
        return {
          summary: "I couldn't pick a standout yet. Want me to search again?",
          detectedIntent,
        };
      }
      const distanceNote =
        typeof top.distanceMeters === "number"
          ? `and it's about ${formatDistance(top.distanceMeters)} away`
          : "and it's not too far";
      return {
        summary: `I'd go with ${top.name}. It has a solid rating with enough reviews, ${distanceNote}. Want a couple of backups too?`,
        rankedPlaces: [top],
        highlights: [buildHighlight("Recommended", top)],
        referencedPlaceIds: [top.placeId],
        detectedIntent,
      };
    }
    case "compare": {
      const compareTargets = intentResult.compareTargets;
      if (!compareTargets) {
        return {
          summary: "Tell me the two places you'd like to compare.",
          detectedIntent,
        };
      }
      const leftMatch = resolvePlaceReference(compareTargets.left, lastPlaces);
      const rightMatch = resolvePlaceReference(compareTargets.right, lastPlaces);
      const leftPlace = leftMatch?.place;
      const rightPlace = rightMatch?.place;
      if (!leftPlace || !rightPlace) {
        return {
          summary:
            "I couldn't match both of those names to your last results. Try the exact place names?",
          detectedIntent,
        };
      }
      const comparisonLines = [
        `${leftPlace.name}: ${formatRating(leftPlace.rating)} · ${formatReviews(
          leftPlace.reviews,
        )} · ${formatDistance(leftPlace.distanceMeters)} · ${leftPlace.address ?? ""}`.trim(),
        `${rightPlace.name}: ${formatRating(rightPlace.rating)} · ${formatReviews(
          rightPlace.reviews,
        )} · ${formatDistance(rightPlace.distanceMeters)} · ${rightPlace.address ?? ""}`.trim(),
      ];
      const recommended = [leftPlace, rightPlace].sort(sortByRating)[0];
      return {
        summary: `Here's a quick comparison:\n${comparisonLines.join(
          "\n",
        )}\nBased on ratings and reviews, I'd lean toward ${recommended.name}. Want me to factor in distance instead?`,
        rankedPlaces: [leftPlace, rightPlace],
        highlights: [
          buildHighlight("Comparison", leftPlace),
          buildHighlight("Comparison", rightPlace),
        ],
        referencedPlaceIds: [leftPlace.placeId, rightPlace.placeId],
        detectedIntent,
      };
    }
    case "vibe": {
      const sorted = [...lastPlaces].sort(sortByRating);
      const top = sorted[0];
      if (!top) {
        return {
          summary: "I don't have enough details yet. Want me to search again?",
          detectedIntent,
        };
      }
      return {
        summary: `I can't reliably see ambience details from Maps, but ${top.name} has one of the strongest ratings and reviews. Want me to prioritize rating, distance, or review count for your vibe?`,
        rankedPlaces: [top],
        highlights: [buildHighlight("Strong ratings", top)],
        referencedPlaceIds: [top.placeId],
        detectedIntent,
      };
    }
    default:
      return {
        summary: "Tell me how you'd like me to rank the last results.",
        detectedIntent,
      };
  }
};

export const detectListQuestionIntent = detectListQnaIntent;
