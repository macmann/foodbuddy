import { logger } from "../logger";
import type { JsonRpcResponse } from "./types";

type McpCallOptions = {
  url: string;
  apiKey: string;
  method: string;
  params?: Record<string, unknown>;
};

const DEFAULT_TIMEOUT_MS = 10_000;

const buildRequestId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const mcpCall = async <T>({ url, apiKey, method, params }: McpCallOptions): Promise<T> => {
  const requestId = buildRequestId();
  const payload = {
    jsonrpc: "2.0",
    id: requestId,
    method,
    params: params ?? {},
  };

  logger.debug({ method, requestId, url }, "MCP request started");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    logger.error({ error, method, requestId, url }, "MCP request failed to send");
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("MCP request failed to send");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const error = new Error(`MCP request failed with status ${response.status}`);
    (error as Error & { status?: number }).status = response.status;
    logger.error({ method, requestId, status: response.status }, "MCP response not ok");
    throw error;
  }

  let data: JsonRpcResponse<T> | null = null;
  try {
    data = (await response.json()) as JsonRpcResponse<T>;
  } catch (error) {
    logger.error({ error, method, requestId }, "MCP response JSON parse failed");
    throw new Error("MCP response parse failed");
  }

  if (data?.error) {
    logger.error({ error: data.error, method, requestId }, "MCP response error");
    throw new Error(data.error.message ?? "MCP response error");
  }

  if (!data || !("result" in data)) {
    logger.error({ method, requestId }, "MCP response missing result");
    throw new Error("MCP response missing result");
  }

  logger.debug({ method, requestId }, "MCP request completed");
  return data.result as T;
};
