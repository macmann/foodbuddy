import type { RecommendationCardData } from "../types/chat";

const formatRating = (rating?: number) =>
  typeof rating === "number" ? rating.toFixed(1) : "n/a";

const formatDistance = (distance?: number) =>
  typeof distance === "number" ? `${Math.round(distance)} m` : "n/a";

const formatAddress = (address?: string) => {
  if (!address) {
    return "n/a";
  }
  const trimmed = address.trim();
  if (!trimmed) {
    return "n/a";
  }
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
};

export const buildFallbackNarration = (
  places: RecommendationCardData[],
): string => {
  if (places.length === 0) {
    return "Here are a few places you might like.";
  }

  const lines = places.slice(0, 5).map((place, index) => {
    const rating = formatRating(place.rating);
    const distance = formatDistance(place.distanceMeters);
    const address = formatAddress(place.address);
    return `${index + 1}. ${place.name} — rating ${rating}, ${distance}, ${address}`;
  });

  return ["Here are a few nearby options:", ...lines].join("\n");
};
