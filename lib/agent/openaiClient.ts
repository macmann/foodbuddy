import { logger } from "../logger";
import { normalizeModel } from "./model";
import type { ToolSchema } from "./types";
import { normalizeVerbosity, type ReasoningEffort, type Verbosity } from "../settings/llm";

export type LlmMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_name?: string;
  tool_call_id?: string;
};

type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type LlmResponse = {
  assistantText: string;
  toolCalls: ToolCall[];
};

type CallLlmInput = {
  messages: LlmMessage[];
  tools?: ToolSchema[];
  toolsDisabled?: boolean;
  settings: {
    llmModel: string;
    llmSystemPrompt: string;
    reasoningEffort: ReasoningEffort;
    verbosity: Verbosity;
  };
  requestId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 12_000;

const parseToolArguments = (raw: unknown): Record<string, unknown> => {
  if (typeof raw !== "string") {
    return {};
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch (err) {
    logger.warn({ err, raw }, "Failed to parse tool arguments");
    return {};
  }
};

export const callOpenAI = async ({
  messages,
  tools,
  toolsDisabled = false,
  settings,
  requestId,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
}: CallLlmInput): Promise<LlmResponse> => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to call the LLM");
  }

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
  let combinedSignal = timeoutController.signal;
  let cleanupSignal = () => {};

  if (signal) {
    const combinedController = new AbortController();
    const abortCombined = () => combinedController.abort();
    if (signal.aborted) {
      combinedController.abort();
    } else {
      signal.addEventListener("abort", abortCombined);
    }
    timeoutController.signal.addEventListener("abort", abortCombined);
    combinedSignal = combinedController.signal;
    cleanupSignal = () => {
      signal.removeEventListener("abort", abortCombined);
      timeoutController.signal.removeEventListener("abort", abortCombined);
    };
  }
  const start = Date.now();
  const model = normalizeModel(settings.llmModel);

  if (model !== settings.llmModel) {
    logger.warn(
      { requestedModel: settings.llmModel, modelUsed: model },
      "Invalid model requested; falling back",
    );
  }

  const input =
    messages[0]?.role === "system"
      ? messages
      : [{ role: "system", content: settings.llmSystemPrompt }, ...messages];
  const normalizedVerbosity = normalizeVerbosity(settings.verbosity) ?? "medium";

  const body: Record<string, unknown> = {
    model,
    input,
    reasoning: { effort: settings.reasoningEffort },
    text: { verbosity: normalizedVerbosity },
  };

  if (!toolsDisabled) {
    body.tool_choice = "auto";
    if (tools) {
      body.tools = tools;
    }
  }

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: combinedSignal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM request failed: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as {
      output?: Array<
        | {
            type: "message";
            role: string;
            content?: Array<{ type: string; text?: string }>;
          }
        | {
            type: "tool_call";
            id?: string;
            call_id?: string;
            name?: string;
            arguments?: string;
          }
      >;
    };

    const output = data.output ?? [];
    const toolCalls: ToolCall[] = [];
    let assistantText = "";

    output.forEach((item) => {
      if (item.type === "message" && item.role === "assistant") {
        const parts = item.content ?? [];
        parts.forEach((part) => {
          if (part.type === "output_text" && part.text) {
            assistantText += part.text;
          }
        });
      }

      if (item.type === "tool_call") {
        const id = item.id ?? item.call_id ?? crypto.randomUUID();
        toolCalls.push({
          id,
          name: item.name ?? "unknown_tool",
          arguments: parseToolArguments(item.arguments),
        });
      }
    });

    logger.info(
      {
        requestId,
        latencyMs: Date.now() - start,
        toolCallCount: toolCalls.length,
      },
      "LLM response received",
    );

    return { assistantText: assistantText.trim(), toolCalls };
  } finally {
    clearTimeout(timeout);
    cleanupSignal();
  }
};

export type { ToolCall };
