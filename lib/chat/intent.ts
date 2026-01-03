export type ChatIntent = "SMALL_TALK" | "FOOD_INTENT" | "PLACE_SEARCH_INTENT";

const normalizeMessage = (message: string) => message.trim().toLowerCase();

const phraseMatches = (message: string, phrases: string[]) =>
  phrases.some((phrase) => message.includes(phrase));

const matchesRegex = (message: string, regexes: RegExp[]) =>
  regexes.some((regex) => regex.test(message));

const SMALL_TALK_PHRASES = [
  "hi",
  "hello",
  "hey",
  "mingalaba",
  "good morning",
  "good afternoon",
  "good evening",
  "good night",
  "good day",
  "thanks",
  "thank you",
  "thx",
  "appreciate it",
  "bye",
  "goodbye",
  "see you",
  "see ya",
  "later",
  "take care",
  "what's up",
  "whats up",
  "how are you",
  "how's it going",
  "hows it going",
  "tell me a joke",
  "who are you",
  "what can you do",
  "can you help",
  "let's chat",
  "lets chat",
];

const SMALL_TALK_REGEXES = [
  /^hi\b/,
  /^hello\b/,
  /^hey\b/,
  /\bhow are you\b/,
  /\bhow's it going\b/,
  /\bhow is it going\b/,
];

const REQUEST_REGEXES = [
  /\brecommend\b/,
  /\bsuggest\b/,
  /\bwhere\b/,
  /\bfind\b/,
  /\bshow\b/,
  /\blooking for\b/,
  /\bneed\b/,
  /\bany\b/,
  /\bgive me\b/,
  /\bcan you\b/,
  /\bsearch\b/,
  /\bwhat's the best\b/,
  /\bwhats the best\b/,
  /\bbest\b/,
  /\btop\b/,
];

const FOLLOW_UP_REGEXES = [/show more\b/, /more options\b/, /\bnext\b/, /\banother\b/];

const LOCATION_REGEXES = [
  /\bnear\b/,
  /\bnearby\b/,
  /\baround\b/,
  /\bclose to\b/,
  /\bin\s+[a-z]/,
  /\bat\s+[a-z]/,
];

const PLACE_KEYWORDS = [
  "restaurant",
  "restaurants",
  "place",
  "places",
  "spot",
  "spots",
  "cafe",
  "cafes",
  "eatery",
  "eateries",
  "diner",
  "bistro",
  "bar",
  "food place",
  "food spot",
];

const CUISINE_KEYWORDS = [
  "food",
  "eat",
  "hungry",
  "breakfast",
  "brunch",
  "lunch",
  "dinner",
  "snack",
  "noodle",
  "noodles",
  "ramen",
  "sushi",
  "pizza",
  "burger",
  "bbq",
  "barbecue",
  "hotpot",
  "dim sum",
  "chinese",
  "thai",
  "korean",
  "japanese",
  "burmese",
  "myanmar",
  "indian",
  "malay",
  "vietnamese",
  "seafood",
  "vegetarian",
  "vegan",
  "halal",
  "coffee",
  "tea",
  "dessert",
  "cake",
];

export const isSmallTalkMessage = (message: string) => {
  const normalized = normalizeMessage(message);
  if (!normalized) {
    return false;
  }
  return (
    phraseMatches(normalized, SMALL_TALK_PHRASES) ||
    matchesRegex(normalized, SMALL_TALK_REGEXES)
  );
};

export const detectIntent = (message: string): ChatIntent => {
  const normalized = normalizeMessage(message);
  if (!normalized) {
    return "SMALL_TALK";
  }

  const hasSmallTalk = isSmallTalkMessage(message);
  const hasCuisine = phraseMatches(normalized, CUISINE_KEYWORDS);
  const hasPlaceKeyword = phraseMatches(normalized, PLACE_KEYWORDS);
  const hasLocationHint = matchesRegex(normalized, LOCATION_REGEXES);
  const isRequest =
    matchesRegex(normalized, REQUEST_REGEXES) ||
    normalized.endsWith("?") ||
    /^(restaurants?|places?|best|top)\b/.test(normalized);
  const isFollowUp = matchesRegex(normalized, FOLLOW_UP_REGEXES);

  if (hasSmallTalk && !(hasCuisine || hasPlaceKeyword || hasLocationHint || isRequest)) {
    return "SMALL_TALK";
  }

  const isPlaceSearch =
    isFollowUp ||
    ((hasCuisine || hasPlaceKeyword || hasLocationHint) &&
      (isRequest || hasLocationHint || hasPlaceKeyword));

  if (isPlaceSearch) {
    return "PLACE_SEARCH_INTENT";
  }

  if (hasCuisine) {
    return "FOOD_INTENT";
  }

  return "SMALL_TALK";
};
