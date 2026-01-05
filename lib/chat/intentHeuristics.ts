const normalize = (text: string) => text.toLowerCase().trim();

const stripPunctuation = (text: string) =>
  text.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

const GREETING_PHRASES = [
  "hi",
  "hello",
  "hey",
  "yo",
  "sup",
  "ok",
  "okay",
  "thanks",
  "thank you",
  "thx",
  "good morning",
  "good afternoon",
  "good evening",
  "good night",
  "hola",
  "bonjour",
  "mingalaba",
  "မင်္ဂလာပါ",
  "မင်္ဂလာပါနော်",
  "နေကောင်းလား",
  "ဟလို",
  "ဟယ်လို",
  "ဟေး",
];

const GREETING_PARTICLES = new Set([
  "there",
  "friend",
  "buddy",
  "pal",
  "bro",
  "sis",
  "sir",
  "madam",
  "please",
  "ya",
  "yeah",
  "hey",
  "hi",
  "hello",
  "ok",
  "okay",
  "thanks",
  "thank",
  "you",
]);

const GENERIC_FOOD_TERMS = new Set([
  "food",
  "foods",
  "restaurant",
  "restaurants",
  "place",
  "places",
  "eat",
  "eats",
  "eating",
  "hungry",
  "meal",
  "meals",
  "lunch",
  "dinner",
  "breakfast",
  "snack",
  "cuisine",
  "စားသောက်ဆိုင်",
  "စားသောက်",
  "အစားအစာ",
  "စားချင်",
  "စားမယ်",
  "စားတော့မယ်",
]);

const STOPWORDS = new Set([
  ...GENERIC_FOOD_TERMS,
  ...GREETING_PARTICLES,
  "near",
  "nearby",
  "around",
  "here",
  "there",
  "in",
  "at",
  "for",
  "to",
  "the",
  "a",
  "an",
  "my",
  "me",
  "please",
  "any",
  "some",
  "i",
  "we",
  "you",
  "want",
  "need",
  "looking",
  "find",
  "recommend",
]);

const LOCATION_FALLBACK_REGEX = /\b(?:in|near|around)\s+([^\n,.;!?]+)/i;

const LOCATION_FALLBACK_STOPWORDS = new Set([
  "me",
  "my",
  "my location",
  "current location",
  "here",
  "near me",
  "nearby",
  "around here",
  "this area",
  "my area",
  "area",
]);

const LOCATION_TRAILING_PHRASES = [
  "please",
  "pls",
  "plz",
  "thanks",
  "thank you",
  "now",
];

const matchesAnyPhrase = (normalized: string, phrases: string[]) =>
  phrases.some((phrase) => normalized === phrase);

const removePhrases = (value: string, phrases: string[]) =>
  phrases.reduce((acc, phrase) => acc.split(phrase).join(" "), value);

const filterTokens = (value: string) =>
  value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !STOPWORDS.has(token));

export const isGreeting = (text: string, _localeHint?: string): boolean => {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  const compact = stripPunctuation(normalized);
  if (matchesAnyPhrase(compact, GREETING_PHRASES)) {
    return true;
  }
  const tokens = compact.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return false;
  }
  return tokens.every((token) => GREETING_PARTICLES.has(token));
};

export const isTooVagueForSearch = (text: string): boolean => {
  const normalized = normalize(text);
  if (!normalized) {
    return true;
  }
  const compact = stripPunctuation(normalized);
  if (!compact) {
    return true;
  }
  if (isGreeting(compact)) {
    return true;
  }
  if (compact.length < 3) {
    return true;
  }
  if (GENERIC_FOOD_TERMS.has(compact)) {
    return true;
  }
  const filtered = filterTokens(compact);
  if (filtered.length === 0) {
    return true;
  }
  if (filtered.length === 1 && GENERIC_FOOD_TERMS.has(filtered[0])) {
    return true;
  }
  return false;
};

export const extractSearchKeywordFallback = (text: string): string | null => {
  const normalized = normalize(text);
  if (!normalized) {
    return null;
  }
  const compact = stripPunctuation(normalized);
  if (!compact) {
    return null;
  }
  const withoutGreetings = removePhrases(compact, GREETING_PHRASES);
  const filtered = filterTokens(withoutGreetings);
  const keyword = filtered.join(" ").trim();
  if (keyword.length < 3) {
    return null;
  }
  if (GENERIC_FOOD_TERMS.has(keyword)) {
    return null;
  }
  return keyword || null;
};

const stripTrailingPhrases = (value: string) => {
  let result = value;
  for (const phrase of LOCATION_TRAILING_PHRASES) {
    const pattern = new RegExp(`\\b${phrase}\\b.*$`, "i");
    result = result.replace(pattern, "").trim();
  }
  return result;
};

export const extractLocationTextFallback = (text: string): string | null => {
  const match = text.match(LOCATION_FALLBACK_REGEX);
  if (!match) {
    return null;
  }
  const rawCandidate = match[1]?.trim();
  if (!rawCandidate) {
    return null;
  }
  const cleaned = stripTrailingPhrases(rawCandidate).trim();
  if (!cleaned) {
    return null;
  }
  const normalized = normalize(stripPunctuation(cleaned));
  if (!normalized) {
    return null;
  }
  if (LOCATION_FALLBACK_STOPWORDS.has(normalized)) {
    return null;
  }
  if (normalized.length < 2) {
    return null;
  }
  return cleaned;
};
