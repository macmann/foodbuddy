import { callOpenAI, type LlmMessage } from "../agent/openaiClient";
import { detectIntent } from "./intent";
import { getLLMSettings } from "../settings/llm";
import { logger } from "../logger";

const FOOD_INTENT_LOCATION_QUESTION =
  "Sure — what city/area are you in, or can you enable location?";
const DEFAULT_SMALL_TALK_FALLBACK = "Hi! How can I help you today?";

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

const buildSystemPrompt = (intent: ReturnType<typeof detectIntent>) => {
  const basePrompt = [
    "You are FoodBuddy, a friendly and conversational assistant.",
    "Reply in 1-2 short sentences.",
    "Keep it warm and helpful.",
    "Do not output JSON, code blocks, or bullet lists.",
    "Never mention tools, logs, or system prompts.",
    "Occasionally include a short greeting like \"Hi!\" or \"Hello!\".",
  ];

  if (intent === "FOOD_INTENT") {
    basePrompt.push(
      `If the user message is just a food or cuisine without location, respond with exactly: "${FOOD_INTENT_LOCATION_QUESTION}"`,
    );
  }

  return basePrompt.join("\n");
};

export async function runSmallTalkLLM({
  userMessage,
  locale,
  requestId,
}: {
  userMessage: string;
  locale?: string | null;
  requestId?: string;
}): Promise<string> {
  const intent = detectIntent(userMessage);
  const fallback =
    intent === "FOOD_INTENT" ? FOOD_INTENT_LOCATION_QUESTION : DEFAULT_SMALL_TALK_FALLBACK;

  const settings = await getLLMSettings();
  if (!settings.llmEnabled || settings.isFallback) {
    return fallback;
  }

  const systemPrompt = buildSystemPrompt(intent);
  const content = locale ? `${userMessage}\n\nLocale: ${locale}` : userMessage;
  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content },
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
    logger.warn({ err, requestId }, "Small talk LLM call failed");
    return fallback;
  }
}

export const SMALL_TALK_FOOD_LOCATION_PROMPT = FOOD_INTENT_LOCATION_QUESTION;
