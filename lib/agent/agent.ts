import { z } from "zod";

import { logger } from "../logger";
import { getLocationCoords, getLocationText, type GeoLocation } from "../location";
import type { RecommendationCardData } from "../types";
import { getLLMSettings, normalizeVerbosity } from "../settings/llm";
import { callOpenAI, type LlmMessage } from "./openaiClient";
import { extractRecommendations, toolHandlers, toolSchemas } from "./tools";

export type AgentContext = {
  location: GeoLocation;
  radius_m?: number;
  locationEnabled?: boolean;
  sessionId?: string;
  requestId?: string;
  userIdHash?: string;
  channel?: string;
  locale?: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
};

export type AgentResult = {
  message: string;
  status: "OK" | "NO_RESULTS" | "ERROR";
  primary: RecommendationCardData | null;
  alternatives: RecommendationCardData[];
  places: RecommendationCardData[];
  toolCallCount: number;
  llmModel: string;
  fallbackUsed: boolean;
  errorMessage?: string;
  rawResponse: Record<string, unknown>;
  parsedOutput?: ParsedAgentOutput;
  toolDebug?: Record<string, unknown>;
};

const MAX_TOOL_ROUNDS = 3;
const MAX_RECOMMENDATIONS = 7;
const BASE_SYSTEM_PROMPT = `You are FoodBuddy, a helpful local food assistant.

Required behavior:
- Ask one clarifying question if cuisine is given but location/radius is missing and no lat/lng is available.
- If lat/lng is present and the user asks for restaurants/food/cafes, call the nearby_search tool BEFORE answering.
- If nearby_search is unavailable or fails, call recommend_places to use internal rankings.
- Normalize cuisine intents like "chinese food" to "Chinese restaurants" when calling tools.
- Do not hallucinate places. Use tools for factual data.
- Always respond with JSON only, matching this schema:
  {
    "intent": "string (short intent summary)",
    "query": "string (search query to use)",
    "radius_m": number | null,
    "open_now": boolean | null,
    "cuisine": "string | null",
    "must_call_tools": boolean,
    "final_answer_text": "string (friendly response shown to the user)"
  }
- Set must_call_tools=true for food/restaurant requests.`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isRecommendationCardData = (value: unknown): value is RecommendationCardData =>
  isRecord(value) && typeof value.placeId === "string";

export const runFoodBuddyAgent = async ({
  userMessage,
  context,
  signal,
}: {
  userMessage: string;
  context: AgentContext;
  signal?: AbortSignal;
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
  const normalizedVerbosity = normalizeVerbosity(settings.verbosity) ?? "medium";

  logger.info(
    {
      requestId: context.requestId,
      model: settings.llmModel,
      reasoningEffort: settings.reasoningEffort,
      verbosity: normalizedVerbosity,
    },
    "Routing LLM request",
  );

  const messages: LlmMessage[] = [{ role: "system", content: systemPrompt }];

  if (context.conversationHistory) {
    context.conversationHistory.forEach((entry) => {
      messages.push({ role: entry.role, content: entry.content });
    });
  }

  const locationText = getLocationText(context.location);
  const coords = getLocationCoords(context.location);
  const contextLines = [
    `Channel: ${context.channel ?? "WEB"}`,
    context.locale ? `Locale: ${context.locale}` : null,
    locationText ? `Location text: ${locationText}` : null,
    coords ? `Coordinates: ${coords.lat}, ${coords.lng}` : null,
    typeof context.radius_m === "number" ? `Radius (m): ${context.radius_m}` : null,
    context.sessionId ? `Session ID: ${context.sessionId}` : null,
    context.requestId ? `Request ID: ${context.requestId}` : null,
  ].filter(Boolean);

  const userContent = contextLines.length
    ? `${userMessage}\n\nContext:\n${contextLines.map((line) => `- ${line}`).join("\n")}`
    : userMessage;

  messages.push({ role: "user", content: userContent });

  let primary: RecommendationCardData | null = null;
  let alternatives: RecommendationCardData[] = [];
  let places: RecommendationCardData[] = [];
  let toolCallCount = 0;
  let fallbackUsed = false;
  let errorMessage: string | undefined;
  let toolDebug: Record<string, unknown> | undefined;

  let lastAssistantText = "";
  let clarificationMessage: string | null = null;
  let parsedOutput: ParsedAgentOutput | undefined;
  let lastToolResponse: Record<string, unknown> | null = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    let response: Awaited<ReturnType<typeof callOpenAI>>;
    try {
      response = await callOpenAI({
        messages,
        tools: toolSchemas,
        settings,
        requestId: context.requestId,
        signal,
      });
    } catch (err) {
      logger.error({ err, requestId: context.requestId }, "LLM call failed");
      throw err;
    }

    lastAssistantText = response.assistantText || lastAssistantText;
    toolCallCount += response.toolCalls.length;
    parsedOutput = parseAgentOutput(response.assistantText) ?? parsedOutput;

    if (response.toolCalls.length === 0) {
      break;
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
          radius_m: context.radius_m,
          requestId: context.requestId,
          userIdHash: context.userIdHash,
          rawMessage: userMessage,
          locationEnabled: context.locationEnabled,
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

      const toolPlaces = extractPlaceResults(toolCall.name, result);
      if (toolPlaces.length > 0) {
        places = mergeRecommendations(places, toolPlaces);
        primary = primary ?? places[0] ?? null;
        alternatives = primary ? places.slice(1, MAX_RECOMMENDATIONS) : places;
      }

      if (toolCall.name === "nearby_search") {
        const results = Array.isArray(result.results) ? result.results : [];
        const usedRadiusMeters =
          typeof result.usedRadiusMeters === "number" ? result.usedRadiusMeters : undefined;
        const exhausted = typeof result.exhausted === "boolean" ? result.exhausted : undefined;

        if (Array.isArray(results) && results.length === 0 && usedRadiusMeters && exhausted) {
          const km = usedRadiusMeters / 1000;
          const kmLabel = Number.isInteger(km) ? km.toString() : km.toFixed(1);
          clarificationMessage = `I couldn’t find results within ${kmLabel} km. Want me to expand to 10 km or search a different neighborhood?`;
        }
      }

      if (toolCall.name === "recommend_places") {
        const debug = isRecord(result.debug) ? result.debug : undefined;
        const meta = isRecord(result.meta) ? result.meta : undefined;
        if (meta?.fallbackUsed) {
          fallbackUsed = true;
        }
        if (typeof meta?.errorMessage === "string") {
          errorMessage = meta.errorMessage;
        }
        if (debug) {
          toolDebug = debug;
        }
      }

      toolMessages.push({
        role: "tool",
        tool_name: toolCall.name,
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });

      lastToolResponse = result;
    }

    messages.push(...toolMessages);

    if (clarificationMessage) {
      const recommended = mergeRecommendations(
        places,
        primary ? [primary, ...alternatives] : alternatives,
      );
      return buildAgentResult({
        message: clarificationMessage,
        places: recommended,
        llmModel: settings.llmModel,
        toolCallCount,
        fallbackUsed,
        errorMessage,
        rawResponse: {
          assistantText: lastAssistantText,
          toolResponses: lastToolResponse,
        },
        parsedOutput,
      });
    }

    if (primary || alternatives.length > 0) {
      const message =
        parsedOutput?.final_answer_text ||
        response.assistantText ||
        "Here are a few places that could work. Let me know if you want more options.";
      const recommended = mergeRecommendations(
        places,
        primary ? [primary, ...alternatives] : alternatives,
      );
      return buildAgentResult({
        message,
        places: recommended,
        llmModel: settings.llmModel,
        toolCallCount,
        fallbackUsed,
        errorMessage,
        rawResponse: {
          assistantText: lastAssistantText,
          toolResponses: lastToolResponse,
        },
        parsedOutput,
      });
    }
  }

  if (
    toolCallCount === 0 &&
    (parsedOutput?.must_call_tools ?? true) &&
    (context.location.kind !== "none")
  ) {
    const fallbackQuery = parsedOutput?.query || userMessage;
    const fallbackResult = await toolHandlers.recommend_places(
      { query: fallbackQuery, location: getLocationText(context.location) },
      {
        location: context.location,
        radius_m: context.radius_m,
        requestId: context.requestId,
        userIdHash: context.userIdHash,
        rawMessage: userMessage,
        locationEnabled: context.locationEnabled,
      },
    );
    const fallbackPlaces = extractPlaceResults("recommend_places", fallbackResult);
    places = mergeRecommendations(places, fallbackPlaces);
    primary = places[0] ?? null;
    alternatives = primary ? places.slice(1, MAX_RECOMMENDATIONS) : [];
    fallbackUsed = true;
    lastToolResponse = fallbackResult;
    const meta = isRecord(fallbackResult.meta) ? fallbackResult.meta : undefined;
    if (meta?.fallbackUsed) {
      fallbackUsed = true;
    }
    if (typeof meta?.errorMessage === "string") {
      errorMessage = meta.errorMessage;
    }
    const debug = isRecord(fallbackResult.debug) ? fallbackResult.debug : undefined;
    if (debug) {
      toolDebug = debug;
    }
  }

  const hasPlaces = places.length > 0;
  const providerErrorMessage = errorMessage
    ? "Places provider unavailable; please try again."
    : undefined;
  const message = hasPlaces
    ? parsedOutput?.final_answer_text ||
      lastAssistantText ||
      "Here are a few places that could work. Let me know if you want more options."
    : providerErrorMessage ??
      "I couldn’t find places nearby for that request. Try widening the radius or a different keyword.";

  return buildAgentResult({
    message,
    places,
    llmModel: settings.llmModel,
    toolCallCount,
    fallbackUsed,
    errorMessage,
    rawResponse: {
      assistantText: lastAssistantText,
      toolResponses: lastToolResponse,
    },
    parsedOutput,
    toolDebug,
    statusOverride: providerErrorMessage ? "ERROR" : undefined,
  });
};

type ParsedAgentOutput = {
  intent?: string;
  query?: string;
  radius_m?: number | null;
  open_now?: boolean | null;
  cuisine?: string | null;
  must_call_tools?: boolean;
  final_answer_text?: string;
};

const ParsedAgentSchema = z.object({
  intent: z.string().optional(),
  query: z.string().optional(),
  radius_m: z.number().nullable().optional(),
  open_now: z.boolean().nullable().optional(),
  cuisine: z.string().nullable().optional(),
  must_call_tools: z.boolean().optional(),
  final_answer_text: z.string().optional(),
});

const parseAgentOutput = (text?: string | null): ParsedAgentOutput | undefined => {
  if (!text) {
    return undefined;
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return undefined;
  }
  const candidate = text.slice(start, end + 1);
  try {
    const json: unknown = JSON.parse(candidate);
    const parsed = ParsedAgentSchema.safeParse(json);
    if (!parsed.success) {
      return undefined;
    }
    return parsed.data;
  } catch {
    return undefined;
  }
};

const extractPlaceResults = (
  toolName: string,
  toolResult: Record<string, unknown>,
): RecommendationCardData[] => {
  if (toolName !== "nearby_search" && toolName !== "recommend_places") {
    return [];
  }
  const results = toolResult.results;
  if (!Array.isArray(results)) {
    return [];
  }
  return results.filter(isRecommendationCardData);
};

const mergeRecommendations = (
  base: RecommendationCardData[],
  next: RecommendationCardData[],
): RecommendationCardData[] => {
  const seen = new Set(base.map((item) => item.placeId));
  const merged = [...base];
  next.forEach((item) => {
    if (!seen.has(item.placeId)) {
      seen.add(item.placeId);
      merged.push(item);
    }
  });
  return merged;
};

const buildAgentResult = ({
  message,
  places,
  llmModel,
  toolCallCount,
  fallbackUsed,
  errorMessage,
  rawResponse,
  parsedOutput,
  toolDebug,
  statusOverride,
}: {
  message: string;
  places: RecommendationCardData[];
  llmModel: string;
  toolCallCount: number;
  fallbackUsed: boolean;
  errorMessage?: string;
  rawResponse: Record<string, unknown>;
  parsedOutput?: ParsedAgentOutput;
  toolDebug?: Record<string, unknown>;
  statusOverride?: AgentResult["status"];
}): AgentResult => {
  const primary = places[0] ?? null;
  const alternatives = places.slice(1, MAX_RECOMMENDATIONS);
  const status = statusOverride ?? (places.length > 0 ? "OK" : "NO_RESULTS");

  return {
    message: message.trim(),
    status,
    primary,
    alternatives,
    places,
    toolCallCount,
    llmModel,
    fallbackUsed,
    errorMessage,
    rawResponse,
    parsedOutput,
    toolDebug,
  };
};
