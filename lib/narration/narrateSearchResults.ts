import { callOpenAI, type LlmMessage } from "../agent/openaiClient";
import { logger } from "../logger";
import { getLLMSettings } from "../settings/llm";
import type { RecommendationCardData } from "../types/chat";

type UserPrefs = {
  cuisine?: string[];
  budget?: "cheap" | "mid" | "high";
  vibe?: string[];
  dietary?: string[];
};

const formatLocationLabel = (label?: string | null) =>
  label && label.trim().length > 0 ? label.trim() : undefined;

const formatPrefs = (prefs?: UserPrefs) => {
  if (!prefs) {
    return "none";
  }
  const entries: string[] = [];
  if (prefs.cuisine && prefs.cuisine.length > 0) {
    entries.push(`cuisine: ${prefs.cuisine.join(", ")}`);
  }
  if (prefs.budget) {
    entries.push(`budget: ${prefs.budget}`);
  }
  if (prefs.vibe && prefs.vibe.length > 0) {
    entries.push(`vibe: ${prefs.vibe.join(", ")}`);
  }
  if (prefs.dietary && prefs.dietary.length > 0) {
    entries.push(`dietary: ${prefs.dietary.join(", ")}`);
  }
  return entries.length > 0 ? entries.join(" | ") : "none";
};

const formatPrefsIntro = (prefs?: UserPrefs) => {
  if (!prefs) {
    return "";
  }
  const parts: string[] = [];
  if (prefs.cuisine && prefs.cuisine.length > 0) {
    parts.push(prefs.cuisine[0]);
  }
  if (prefs.dietary && prefs.dietary.length > 0) {
    parts.push(prefs.dietary[0]);
  }
  if (prefs.vibe && prefs.vibe.length > 0) {
    parts.push(prefs.vibe[0]);
  }
  if (prefs.budget) {
    parts.push(prefs.budget === "cheap" ? "budget-friendly" : prefs.budget);
  }
  if (parts.length === 0) {
    return "";
  }
  return `Since you like ${parts.join(", ")}, `;
};

const buildFallbackNarration = ({
  userMessage,
  locationLabel,
  topPlaces,
  userPrefs,
}: {
  userMessage: string;
  locationLabel?: string | null;
  topPlaces: RecommendationCardData[];
  userPrefs?: UserPrefs;
}) => {
  const safeLocation = formatLocationLabel(locationLabel);
  const locationSnippet = safeLocation ? `near ${safeLocation}` : "nearby";
  const prefsIntro = formatPrefsIntro(userPrefs);
  if (topPlaces.length === 0) {
    return [
      `I couldn’t find solid matches ${locationSnippet} for "${userMessage}".`,
      "Want to try a different cuisine or expand the distance?",
    ].join(" ");
  }

  const [first, second] = topPlaces;
  const firstHighlightParts: string[] = [];
  if (typeof first.rating === "number") {
    firstHighlightParts.push(`${first.rating.toFixed(1)}★`);
  }
  if (typeof first.distanceMeters === "number") {
    firstHighlightParts.push(`${Math.round(first.distanceMeters)}m away`);
  }
  const firstHighlight =
    firstHighlightParts.length > 0 ? ` (${firstHighlightParts.join(", ")})` : "";
  const secondHighlightParts: string[] = [];
  if (second) {
    if (typeof second.rating === "number") {
      secondHighlightParts.push(`${second.rating.toFixed(1)}★`);
    }
    if (typeof second.distanceMeters === "number") {
      secondHighlightParts.push(`${Math.round(second.distanceMeters)}m away`);
    }
  }
  const secondHighlight =
    second && secondHighlightParts.length > 0
      ? ` ${second.name} looks good too (${secondHighlightParts.join(", ")}).`
      : "";

  return [
    `${prefsIntro}I pulled a few spots ${locationSnippet} based on "${userMessage}".`.trim(),
    `${first.name} stands out${firstHighlight}.${secondHighlight}`.trim(),
    "Want something cheaper or a specific vibe?",
  ].join(" ");
};

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

const isAbortError = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

export const narrateSearchResults = async ({
  userMessage,
  locationLabel,
  topPlaces,
  userPrefs,
  requestId,
  timeoutMs,
}: {
  userMessage: string;
  locationLabel?: string | null;
  topPlaces: RecommendationCardData[];
  userPrefs?: UserPrefs;
  requestId?: string;
  timeoutMs: number;
}): Promise<string> => {
  const settings = await getLLMSettings();
  const fallback = buildFallbackNarration({
    userMessage,
    locationLabel,
    topPlaces,
    userPrefs,
  });

  if (!settings.llmEnabled || settings.isFallback) {
    return fallback;
  }

  const systemPrompt = [
    "You are FoodBuddy, a friendly food guide.",
    "Write a short 2-4 sentence paragraph.",
    "If user prefs exist, mention them gently (e.g., 'Since you like spicy...').",
    "Mention 1-2 highlights (rating, distance, vibe).",
    "Ask one follow-up question at the end.",
    "Do not output JSON, lists, or code blocks.",
  ].join("\n");

  const placeSummaries = topPlaces.slice(0, 3).map((place) => {
    const rating =
      typeof place.rating === "number" ? place.rating.toFixed(1) : "n/a";
    const distance =
      typeof place.distanceMeters === "number"
        ? Math.round(place.distanceMeters)
        : "n/a";
    const types = place.types?.slice(0, 3).join(", ") ?? "n/a";
    return `${place.name} | rating: ${rating} | distanceMeters: ${distance} | types: ${types}`;
  });

  const contentLines = [
    `User message: ${userMessage}`,
    `Location: ${formatLocationLabel(locationLabel) ?? "nearby"}`,
    `User prefs: ${formatPrefs(userPrefs)}`,
    "Top places:",
    ...placeSummaries,
  ];

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
      logger.warn({ err, requestId }, "Search narration LLM call timed out");
    } else {
      logger.warn({ err, requestId }, "Search narration LLM call failed");
    }
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
};
