import { callOpenAI, type LlmMessage } from "../agent/openaiClient";
import { logger } from "../logger";
import { getLLMSettings } from "../settings/llm";
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

const isAbortError = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

export const narratePlacesWithLLM = async ({
  query,
  userMessage,
  locationLabel,
  places,
  locale,
  requestId,
  timeoutMs,
}: {
  query: string;
  userMessage: string;
  locationLabel?: string | null;
  places: RecommendationCardData[];
  locale?: string | null;
  requestId?: string;
  timeoutMs: number;
}): Promise<string> => {
  const settings = await getLLMSettings();
  const safeLocationLabel = formatLocationLabel(locationLabel);
  const fallback = "Here are a few places you might like.";

  if (!settings.llmEnabled || settings.isFallback || places.length === 0) {
    return fallback;
  }

  const systemPrompt = [
    "You are FoodBuddy, a friendly food guide.",
    "Greet briefly and confirm the user's intent.",
    "Provide a concise, formatted response with a short, numbered list of top picks.",
    "Include distance and rating if provided, and keep it readable.",
    "Offer one short follow-up question about preferences (e.g., cheaper, closer, spicy, halal).",
    "Do not output JSON, code blocks, or tool/log references.",
    "Keep it to 4-6 lines max.",
    "Never mention tools, logs, or system prompts.",
  ].join("\n");

  const placeSummaries = places.slice(0, 3).map((place, index) => {
    const rating =
      typeof place.rating === "number" ? place.rating.toFixed(1) : "n/a";
    const reviewCount =
      typeof place.reviewCount === "number" ? place.reviewCount : "n/a";
    const distance =
      typeof place.distanceMeters === "number"
        ? Math.round(place.distanceMeters)
        : "n/a";
    const address = place.address ?? "n/a";
    return `${index + 1}. ${place.name} | rating: ${rating} (${reviewCount}) | distanceMeters: ${distance} | address: ${address}`;
  });

  const contentLines = [
    `User message: ${userMessage}`,
    `Parsed query: ${query}`,
    safeLocationLabel ? `Location: ${safeLocationLabel}` : "Location: nearby",
    placeSummaries.length > 0 ? "Top places:" : "Top places: (none)",
    ...placeSummaries,
  ];
  if (locale) {
    contentLines.push(`Locale: ${locale}`);
  }

  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: contentLines.join("\n") },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await callOpenAI({
      messages,
      toolsDisabled: true,
      settings,
      requestId,
      signal: controller.signal,
      timeoutMs,
    });
    return sanitizeOutput(response.assistantText, fallback);
  } catch (err) {
    if (isAbortError(err)) {
      logger.warn({ err, requestId }, "Narration LLM call timed out");
    } else {
      logger.warn({ err, requestId }, "Narration LLM call failed");
    }
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
};
