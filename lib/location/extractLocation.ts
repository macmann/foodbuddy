const PREPOSITION_REGEX = /\b(?:in|near|around|at)\s+([^,.;!?]+)$/i;
const TRAILING_LOCATION_REGEX = /^(.*)\s+([a-zA-Z][a-zA-Z\s'\-]+)$/i;
const LOCATION_MAX_LENGTH = 80;
const FOOD_TERMS = [
  "food",
  "restaurant",
  "restaurants",
  "cafe",
  "cafes",
  "bakery",
  "bakeries",
  "bar",
  "bars",
  "coffee",
  "tea",
  "noodle",
  "noodles",
  "sushi",
  "hotpot",
  "hot pot",
  "dim sum",
  "pizza",
  "burger",
];

const isFoodTerm = (value: string) => {
  const normalized = value.toLowerCase();
  return FOOD_TERMS.some((term) => normalized.includes(term));
};

const sanitizeLocation = (value: string) =>
  value.trim().replace(/\s{2,}/g, " ").slice(0, LOCATION_MAX_LENGTH);

export const extractExplicitLocation = (message: string) => {
  const trimmed = message.trim();
  if (!trimmed) {
    return { locationText: null, cleanedQuery: "" };
  }

  const prepositionMatch = trimmed.match(PREPOSITION_REGEX);
  if (prepositionMatch && prepositionMatch.index !== undefined) {
    const locationText = sanitizeLocation(prepositionMatch[1]);
    const cleanedQuery = trimmed
      .replace(prepositionMatch[0], " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    return {
      locationText: locationText.length > 0 ? locationText : null,
      cleanedQuery: cleanedQuery.length > 0 ? cleanedQuery : trimmed,
    };
  }

  const trailingMatch = trimmed.match(TRAILING_LOCATION_REGEX);
  if (trailingMatch) {
    const candidateLocation = sanitizeLocation(trailingMatch[2]);
    const cleanedQuery = trailingMatch[1].trim();
    if (candidateLocation && cleanedQuery && isFoodTerm(cleanedQuery)) {
      return {
        locationText: candidateLocation,
        cleanedQuery,
      };
    }
  }

  return { locationText: null, cleanedQuery: trimmed };
};

export type ExtractedLocation = ReturnType<typeof extractExplicitLocation>;
