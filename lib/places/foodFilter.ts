const FOOD_PLACE_TYPES = ["restaurant", "meal_takeaway", "meal_delivery", "cafe"];

const OPTIONAL_FOOD_TYPES = ["meal_takeaway", "meal_delivery", "cafe"];

const FOOD_INTENT_KEYWORDS = [
  "food",
  "restaurant",
  "restaurants",
  "cafe",
  "cafes",
  "coffee",
  "coffee shop",
  "coffeehouse",
  "bakery",
  "bakeries",
  "bar",
  "bars",
  "tea",
  "noodle",
  "noodles",
  "bbq",
  "barbecue",
  "sushi",
  "hotpot",
  "hot pot",
  "dim sum",
  "kitchen",
  "grill",
  "bistro",
  "diner",
  "ramen",
  "pho",
  "pizza",
  "burger",
  "steak",
  "seafood",
  "buffet",
  "kebab",
  "shawarma",
  "taco",
  "curry",
];

const FOOD_NAME_SIGNALS = [
  "restaurant",
  "cafe",
  "coffee",
  "bakery",
  "bar",
  "tea",
  "noodle",
  "bbq",
  "barbecue",
  "sushi",
  "hotpot",
  "hot pot",
  "dim sum",
  "kitchen",
  "grill",
  "bistro",
  "diner",
  "ramen",
  "pho",
  "pizza",
  "burger",
  "steak",
  "seafood",
  "buffet",
  "kebab",
  "shawarma",
  "taco",
  "curry",
  "rice",
  "noodles",
];

const normalizeText = (value: string) => value.toLowerCase();

const containsAny = (value: string, terms: string[]) =>
  terms.some((term) => value.includes(term));

const LOCATION_PHRASE_REGEX = /\b(in|near|around)\s+[a-zA-Z]/i;

export const hasFoodIntent = (query: string | undefined): boolean => {
  if (!query) {
    return false;
  }
  const normalized = normalizeText(query);
  return containsAny(normalized, FOOD_INTENT_KEYWORDS);
};

export const buildFoodSearchQuery = (keyword: string): string => {
  const trimmed = keyword.trim();
  if (!trimmed) {
    return "restaurants";
  }
  if (hasFoodIntent(trimmed)) {
    return trimmed;
  }
  return `${trimmed} restaurant`;
};

export const hasExplicitLocationPhrase = (query: string | undefined): boolean => {
  if (!query) {
    return false;
  }
  return LOCATION_PHRASE_REGEX.test(query);
};

export const buildRestaurantIntent = (keyword: string): string => {
  const trimmed = keyword.trim();
  if (!trimmed) {
    return "restaurant";
  }
  const cleaned = trimmed
    .replace(/\brestaurants?\b/gi, " ")
    .replace(/\bfood\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!cleaned) {
    return "restaurant";
  }
  return `${cleaned} restaurant`;
};

export const buildFoodTextSearchQuery = ({
  keyword,
  locationText,
  coords,
}: {
  keyword: string;
  locationText?: string;
  coords?: { lat: number; lng: number };
}): string => {
  const intent = buildRestaurantIntent(keyword);
  if (locationText && locationText.trim().length > 0) {
    return `${intent} near ${locationText.trim()}`;
  }
  if (coords) {
    return `${intent} near (${coords.lat},${coords.lng})`;
  }
  return intent;
};

export const buildFoodIncludedTypes = (keyword: string | undefined): string[] => {
  const types = new Set<string>(["restaurant"]);
  if (!keyword) {
    return Array.from(types);
  }
  const normalized = normalizeText(keyword);
  if (normalized.includes("cafe") || normalized.includes("coffee") || normalized.includes("tea")) {
    types.add("cafe");
  }
  if (normalized.includes("bakery")) {
    types.add("bakery");
  }
  if (normalized.includes("bar")) {
    types.add("bar");
  }
  if (normalized.includes("takeaway") || normalized.includes("takeout")) {
    types.add("meal_takeaway");
  }
  return Array.from(types);
};

const getPlaceTypes = (place: Record<string, unknown>): string[] => {
  const typesValue = place.types;
  const types =
    Array.isArray(typesValue) && typesValue.length > 0
      ? typesValue.filter((item): item is string => typeof item === "string")
      : [];
  const primaryType =
    typeof place.primaryType === "string" ? [place.primaryType] : [];
  return [...types, ...primaryType].map((type) => type.toLowerCase());
};

const getPlaceLabel = (place: Record<string, unknown>) => {
  const displayName = place.displayName;
  const displayText =
    displayName && typeof displayName === "object" && "text" in displayName
      ? String((displayName as { text?: string }).text ?? "")
      : "";
  const name = typeof place.name === "string" ? place.name : "";
  const formatted =
    typeof place.formattedAddress === "string" ? place.formattedAddress : "";
  const shortFormatted =
    typeof place.shortFormattedAddress === "string" ? place.shortFormattedAddress : "";
  return [displayText, name, formatted, shortFormatted].filter(Boolean).join(" ");
};

const isFoodPlace = (place: Record<string, unknown>, query: string | undefined) => {
  const types = getPlaceTypes(place);
  if (types.length > 0) {
    return types.some((type) => FOOD_PLACE_TYPES.includes(type));
  }
  if (query && hasFoodIntent(query)) {
    return true;
  }
  const label = normalizeText(getPlaceLabel(place));
  return label.length > 0 ? containsAny(label, FOOD_NAME_SIGNALS) : true;
};

export const filterFoodPlaces = (
  places: Record<string, unknown>[],
  query: string | undefined,
  options?: { preserveOrder?: boolean },
): Record<string, unknown>[] => {
  const scored = places.map((place) => {
    const types = getPlaceTypes(place);
    const hasTypes = types.length > 0;
    const hasAllowedType = hasTypes
      ? types.some((type) => FOOD_PLACE_TYPES.includes(type))
      : true;
    const matchesIntent = hasAllowedType && isFoodPlace(place, query);
    return {
      place,
      hasTypes,
      matchesIntent,
    };
  });

  const filtered = scored.filter((item) => (item.hasTypes ? item.matchesIntent : true));

  if (options?.preserveOrder) {
    return filtered.map((item) => item.place);
  }

  return filtered
    .sort((a, b) => {
      if (a.hasTypes === b.hasTypes) {
        return 0;
      }
      return a.hasTypes ? -1 : 1;
    })
    .map((item) => item.place);
};

export const FOOD_PLACE_TYPE_FILTER = FOOD_PLACE_TYPES;
export const OPTIONAL_FOOD_PLACE_TYPE_FILTER = OPTIONAL_FOOD_TYPES;
