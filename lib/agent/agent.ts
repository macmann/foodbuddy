import { logger } from "../logger";
import type { RecommendationCardData } from "../types";
import { getLLMSettings } from "../settings/llm";
import { callOpenAI, type LlmMessage } from "./openaiClient";
import { extractRecommendations, toolHandlers, toolSchemas } from "./tools";

export type AgentContext = {
  location?: { lat: number; lng: number } | null;
  locationText?: string;
  sessionId?: string;
  requestId?: string;
  userIdHash?: string;
  channel?: string;
  locale?: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
};

export type AgentResult = {
  message: string;
  primary: RecommendationCardData | null;
  alternatives: RecommendationCardData[];
};

const MAX_TOOL_ROUNDS = 3;
const BASE_SYSTEM_PROMPT = `You are FoodBuddy, a helpful local food assistant.

Required behavior:
- Ask one clarifying question if cuisine is given but location/radius is missing and no lat/lng is available.
- If lat/lng is present, call the nearby_search tool to find places.
- If nearby_search is unavailable or fails, call recommend_places to use internal rankings.
- Do not hallucinate places. Use tools for factual data.
- Always respond in this format:
  1) Short friendly intro (1-2 sentences).
  2) A numbered list of 3-7 places with Name, Distance (if available), Why it matches (1 line), Price level (if available).
  3) Optional follow-up question (e.g., filters for halal/budget/delivery).`;

export const runFoodBuddyAgent = async ({
  userMessage,
  context,
}: {
  userMessage: string;
  context: AgentContext;
}): Promise<AgentResult> => {
  const settings = await getLLMSettings();
  if (settings.isFallback) {
    logger.error(
      { requestId: context.requestId },
      "Invalid LLM settings detected; falling back to internal recommendations",
    );
    throw new Error("Invalid LLM settings");
  }
  const adminPrompt = settings.llmSystemPrompt?.trim();
  const normalizedAdminPrompt =
    adminPrompt && adminPrompt !== BASE_SYSTEM_PROMPT ? adminPrompt : "";
  const systemPrompt = normalizedAdminPrompt
    ? `${BASE_SYSTEM_PROMPT}\n\nAdmin instructions:\n${normalizedAdminPrompt}`
    : BASE_SYSTEM_PROMPT;

  const messages: LlmMessage[] = [{ role: "system", content: systemPrompt }];

  if (context.conversationHistory) {
    context.conversationHistory.forEach((entry) => {
      messages.push({ role: entry.role, content: entry.content });
    });
  }

  const contextLines = [
    `Channel: ${context.channel ?? "WEB"}`,
    context.locale ? `Locale: ${context.locale}` : null,
    context.locationText ? `Location text: ${context.locationText}` : null,
    context.location
      ? `Coordinates: ${context.location.lat}, ${context.location.lng}`
      : null,
    context.sessionId ? `Session ID: ${context.sessionId}` : null,
    context.requestId ? `Request ID: ${context.requestId}` : null,
  ].filter(Boolean);

  const userContent = contextLines.length
    ? `${userMessage}\n\nContext:\n${contextLines.map((line) => `- ${line}`).join("\n")}`
    : userMessage;

  messages.push({ role: "user", content: userContent });

  let primary: RecommendationCardData | null = null;
  let alternatives: RecommendationCardData[] = [];

  let lastAssistantText = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    let response: Awaited<ReturnType<typeof callOpenAI>>;
    try {
      response = await callOpenAI({
        messages,
        tools: toolSchemas,
        settings,
        requestId: context.requestId,
      });
    } catch (err) {
      logger.error({ err, requestId: context.requestId }, "LLM call failed");
      throw err;
    }

    lastAssistantText = response.assistantText || lastAssistantText;

    if (response.toolCalls.length === 0) {
      return {
        message:
          response.assistantText ||
          "Here are a few places that could work. Let me know if you want more options.",
        primary,
        alternatives,
      };
    }

    if (response.assistantText) {
      messages.push({ role: "assistant", content: response.assistantText });
    }

    const toolMessages: LlmMessage[] = [];

    for (const toolCall of response.toolCalls) {
      const handler = toolHandlers[toolCall.name];
      if (!handler) {
        logger.warn(
          { tool: toolCall.name, requestId: context.requestId },
          "No handler for tool call",
        );
        toolMessages.push({
          role: "tool",
          tool_name: toolCall.name,
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: "Tool not available." }),
        });
        continue;
      }

      let result: Record<string, unknown>;
      try {
        result = await handler(toolCall.arguments, {
          location: context.location,
          requestId: context.requestId,
          userIdHash: context.userIdHash,
        });
      } catch (err) {
        logger.error(
          { err, tool: toolCall.name, requestId: context.requestId },
          "Tool execution failed",
        );
        result = {
          error: err instanceof Error ? err.message : "Tool execution failed",
        };
      }

      if (!primary && alternatives.length === 0) {
        const extracted = extractRecommendations(toolCall.name, result);
        primary = extracted.primary;
        alternatives = extracted.alternatives;
      }

      toolMessages.push({
        role: "tool",
        tool_name: toolCall.name,
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }

    messages.push(...toolMessages);
  }

  return {
    message:
      lastAssistantText ||
      "Here are a few places that could work. Let me know if you want more options.",
    primary,
    alternatives,
  };
};
