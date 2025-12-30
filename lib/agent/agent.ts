import { logger } from "../logger";
import type { RecommendationCardData } from "../types";
import { getLLMSettings } from "../settings/llm";
import { callLLM, type LlmMessage } from "./llm";
import { extractRecommendations, toolHandlers, toolSchemas } from "./tools";

export type AgentContext = {
  location?: { lat: number; lng: number } | null;
  locationText?: string;
  sessionId?: string;
  requestId?: string;
  userIdHash?: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
};

export type AgentResult = {
  message: string;
  primary: RecommendationCardData | null;
  alternatives: RecommendationCardData[];
};

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
  const messages: LlmMessage[] = [{ role: "system", content: settings.systemPrompt }];

  if (context.locationText) {
    messages.push({
      role: "system",
      content: `User provided location text: ${context.locationText}`,
    });
  }

  if (context.location) {
    messages.push({
      role: "system",
      content: `User coordinates: ${context.location.lat}, ${context.location.lng}`,
    });
  }

  if (context.conversationHistory) {
    context.conversationHistory.forEach((entry) => {
      messages.push({ role: entry.role, content: entry.content });
    });
  }

  messages.push({ role: "user", content: userMessage });

  let initialResponse: Awaited<ReturnType<typeof callLLM>>;
  try {
    initialResponse = await callLLM({
      messages,
      tools: toolSchemas,
      settings,
      requestId: context.requestId,
    });
  } catch (err) {
    logger.error({ err, requestId: context.requestId }, "LLM call failed");
    throw err;
  }

  if (initialResponse.toolCalls.length === 0) {
    return {
      message: initialResponse.content || "How can I help you find food nearby?",
      primary: null,
      alternatives: [],
    };
  }

  const toolMessages: LlmMessage[] = [];
  let primary: RecommendationCardData | null = null;
  let alternatives: RecommendationCardData[] = [];

  for (const toolCall of initialResponse.toolCalls) {
    const handler = toolHandlers[toolCall.name];
    if (!handler) {
      logger.warn({ tool: toolCall.name, requestId: context.requestId }, "No handler for tool call");
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
      throw err;
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

  let finalResponse: Awaited<ReturnType<typeof callLLM>>;
  try {
    finalResponse = await callLLM({
      messages: [...messages, ...toolMessages],
      tools: toolSchemas,
      settings,
      requestId: context.requestId,
    });
  } catch (err) {
    logger.error({ err, requestId: context.requestId }, "LLM call failed");
    throw err;
  }

  return {
    message:
      finalResponse.content ||
      "Here are a few places that could work. Let me know if you want more options.",
    primary,
    alternatives,
  };
};
