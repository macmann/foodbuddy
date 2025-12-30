import { logger } from "../logger";

export type LlmMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_name?: string;
  tool_call_id?: string;
};

type ToolSchema = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
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
  requestId?: string;
  timeoutMs?: number;
};

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const MODEL = "gpt-5.2-mini";
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
  requestId,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: CallLlmInput): Promise<LlmResponse> => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to call the LLM");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        max_output_tokens: 800,
        tool_choice: "auto",
        tools,
        input: messages,
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

export type { ToolSchema, ToolCall, LlmResponse };
