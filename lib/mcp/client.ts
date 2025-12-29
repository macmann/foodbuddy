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

const redactUrl = (rawUrl: string): string => {
  try {
    const parsed = new URL(rawUrl);
    const sensitiveKeys = new Set([
      "token",
      "access_token",
      "api_key",
      "apikey",
      "key",
      "auth",
      "authorization",
    ]);
    for (const key of parsed.searchParams.keys()) {
      if (sensitiveKeys.has(key.toLowerCase())) {
        parsed.searchParams.set(key, "REDACTED");
      }
    }
    return parsed.toString();
  } catch {
    return rawUrl.replace(
      /(token|access_token|api_key|apikey|key|auth|authorization)=([^&]+)/gi,
      "$1=REDACTED",
    );
  }
};

export const mcpCall = async <T>({
  url,
  apiKey,
  method,
  params,
}: McpCallOptions): Promise<T | null> => {
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
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": apiKey,
    };
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }

    response = await fetch(url, {
      method: "POST",
      headers,
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
    const responseText = await response.text();
    logger.error(
      {
        method,
        requestId,
        status: response.status,
        url: redactUrl(url),
        responseText: responseText.slice(0, 500),
      },
      "MCP response not ok",
    );
    return null;
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
