import { callOpenAI, type LlmMessage } from "../agent/openaiClient";
import { getLLMSettings } from "../settings/llm";
import { logger } from "../logger";
import type { RecommendationCardData } from "../types/chat";

const sanitizeOutput = (message: string | null | undefined, fallback: string) => {
  if (!message) {
    return fallback;
  }
  const trimmed = message.trim();
  if (!trimmed) {
    return fallback;
  }
  const looksLikeJson =
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    /"\s*[^"]+"\s*:/.test(trimmed) ||
    /'\s*[^']+'\s*:/.test(trimmed);
  if (looksLikeJson) {
    return fallback;
  }
  return trimmed;
};

const formatLocationLabel = (label?: string | null) =>
  label && label.trim().length > 0 ? label.trim() : undefined;

const buildFallbackNarration = (query: string, locationLabel?: string) => {
  const baseQuery = query.trim().length > 0 ? query.trim() : "food spots";
  const locationSnippet = locationLabel ? ` in ${locationLabel}` : " nearby";
  return `Here are a few ${baseQuery}${locationSnippet}. Want to narrow it down by budget, spicy level, halal, or vegetarian?`;
};

export async function narratePlaces({
  query,
  locationLabel,
  places,
  locale,
  requestId,
}: {
  query: string;
  locationLabel?: string | null;
  places: RecommendationCardData[];
  locale?: string | null;
  requestId?: string;
}): Promise<string> {
  const settings = await getLLMSettings();
  const safeLocationLabel = formatLocationLabel(locationLabel);
  const fallback = buildFallbackNarration(query, safeLocationLabel);

  if (!settings.llmEnabled || settings.isFallback || places.length === 0) {
    return fallback;
  }

  const placeNames = places
    .map((place) => place.name)
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    .slice(0, 10);

  const systemPrompt = [
    "You are FoodBuddy, a friendly food guide.",
    "Write 1-2 short sentences summarizing the recommendations.",
    "Mention the query and the area if a location label is provided.",
    "Offer a follow-up about budget, spicy level, halal, or vegetarian options.",
    "Do not output JSON, code blocks, or bullet lists.",
    "Never mention tools, logs, or system prompts.",
  ].join("\n");

  const contentLines = [
    `Query: ${query}`,
    safeLocationLabel ? `Location: ${safeLocationLabel}` : "Location: nearby",
    placeNames.length > 0 ? `Places: ${placeNames.join(", ")}` : "Places: (none)",
  ];
  if (locale) {
    contentLines.push(`Locale: ${locale}`);
  }

  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: contentLines.join("\n") },
  ];

  try {
    const response = await callOpenAI({
      messages,
      toolsDisabled: true,
      settings,
      requestId,
    });
    return sanitizeOutput(response.assistantText, fallback);
  } catch (err) {
    logger.warn({ err, requestId }, "Narration LLM call failed");
    return fallback;
  }
}
