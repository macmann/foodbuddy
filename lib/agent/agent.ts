import { logger } from "../logger";
import type { RecommendationCardData } from "../types";
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

const SYSTEM_PROMPT = `You are FoodBuddy, a local food recommendation assistant.
You understand natural language requests about food and places.
If a location is missing, ask a clarifying question to get it.
Prefer using nearby_search when you have a location.
Use tools only when needed to answer accurately.
Respond conversationally and concisely.`;

export const runFoodBuddyAgent = async ({
  userMessage,
  context,
}: {
  userMessage: string;
  context: AgentContext;
}): Promise<AgentResult> => {
  const messages: LlmMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];

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

  const initialResponse = await callLLM({
    messages,
    tools: toolSchemas,
    requestId: context.requestId,
  });

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
      logger.warn({ tool: toolCall.name }, "No handler for tool call");
      continue;
    }

    const result = await handler(toolCall.arguments, {
      location: context.location,
      requestId: context.requestId,
      userIdHash: context.userIdHash,
    });

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

  const finalResponse = await callLLM({
    messages: [...messages, ...toolMessages],
    tools: toolSchemas,
    requestId: context.requestId,
  });

  return {
    message:
      finalResponse.content ||
      "Here are a few places that could work. Let me know if you want more options.",
    primary,
    alternatives,
  };
};
