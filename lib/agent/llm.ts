import { logger } from "../logger";
import type { ToolSchema } from "./types";

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

type LlmResponse = {
  content: string;
  toolCalls: ToolCall[];
};

type CallLlmInput = {
  messages: LlmMessage[];
  tools?: ToolSchema[];
  settings: {
    model: string;
    systemPrompt: string;
    temperature: number;
    maxTokens: number;
  };
  requestId?: string;
  timeoutMs?: number;
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

export const callLLM = async ({
  messages,
  tools,
  settings,
  requestId,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: CallLlmInput): Promise<LlmResponse> => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to call the LLM");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  const input =
    messages[0]?.role === "system"
      ? messages
      : [{ role: "system", content: settings.systemPrompt }, ...messages];

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: settings.temperature,
        max_output_tokens: settings.maxTokens,
        tool_choice: "auto",
        tools,
        input,
      }),
      signal: controller.signal,
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
    let content = "";

    output.forEach((item) => {
      if (item.type === "message" && item.role === "assistant") {
        const parts = item.content ?? [];
        parts.forEach((part) => {
          if (part.type === "output_text" && part.text) {
            content += part.text;
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

    return { content: content.trim(), toolCalls };
  } finally {
    clearTimeout(timeout);
  }
};

export type { ToolCall, LlmResponse };
