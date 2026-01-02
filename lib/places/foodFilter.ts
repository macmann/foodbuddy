const FOOD_PLACE_TYPES = [
  "restaurant",
  "food",
  "meal_takeaway",
  "meal_delivery",
  "cafe",
  "bakery",
  "bar",
  "coffee_shop",
];

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
  const label = normalizeText(getPlaceLabel(place));
  return hasFoodIntent(query) || containsAny(label, FOOD_NAME_SIGNALS);
};

export const filterFoodPlaces = (
  places: Record<string, unknown>[],
  query: string | undefined,
): Record<string, unknown>[] =>
  places.filter((place) => isFoodPlace(place, query));

export const FOOD_PLACE_TYPE_FILTER = FOOD_PLACE_TYPES;
