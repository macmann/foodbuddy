import type { SessionPlace } from "./sessionMemory";

export type PlaceReferenceMatch = {
  place: SessionPlace;
  score: number;
};

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

const tokenize = (value: string) => normalize(value).split(" ").filter(Boolean);

const diceCoefficient = (a: string, b: string) => {
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  if (a.length < 2 || b.length < 2) {
    return 0;
  }
  const aBigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i += 1) {
    const gram = a.slice(i, i + 2);
    aBigrams.set(gram, (aBigrams.get(gram) ?? 0) + 1);
  }
  let intersection = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const gram = b.slice(i, i + 2);
    const count = aBigrams.get(gram) ?? 0;
    if (count > 0) {
      aBigrams.set(gram, count - 1);
      intersection += 1;
    }
  }
  return (2 * intersection) / (a.length + b.length - 2);
};

const jaccard = (aTokens: string[], bTokens: string[]) => {
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  const intersection = [...aSet].filter((token) => bSet.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
};

export const resolvePlaceReference = (
  message: string,
  lastPlaces: SessionPlace[],
): PlaceReferenceMatch | null => {
  if (!message.trim() || lastPlaces.length === 0) {
    return null;
  }
  const normalizedMessage = normalize(message);
  const messageTokens = tokenize(message);

  let best: PlaceReferenceMatch | null = null;

  for (const place of lastPlaces) {
    const normalizedName = normalize(place.name);
    if (!normalizedName) {
      continue;
    }
    let score = 0;

    if (normalizedMessage === normalizedName) {
      score = 1;
    } else if (
      normalizedMessage.includes(normalizedName) ||
      normalizedName.includes(normalizedMessage)
    ) {
      score = Math.max(score, 0.9);
    }

    const tokenScore = jaccard(messageTokens, tokenize(place.name));
    score = Math.max(score, tokenScore);

    const fuzzyScore = diceCoefficient(normalizedMessage, normalizedName);
    score = Math.max(score, fuzzyScore);

    if (!best || score > best.score) {
      best = { place, score };
    }
  }

  return best;
};
