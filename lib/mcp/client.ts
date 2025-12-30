import { logger } from "../logger";
import { extractJsonFromSse, isLikelySse } from "./sseParser";
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
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "x-api-key": apiKey,
    };
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }
    logger.debug({ accept: headers.accept, method, requestId }, "MCP request headers prepared");

    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    logger.error({ err, method, requestId, url }, "MCP request failed to send");
    if (err instanceof Error) {
      throw err;
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

  const contentType = response.headers.get("content-type") ?? "";
  const responseText = await response.text();

  let data: JsonRpcResponse<T> | null = null;
  try {
    if (isLikelySse(responseText, contentType)) {
      data = extractJsonFromSse(responseText) as JsonRpcResponse<T>;
    } else {
      data = JSON.parse(responseText) as JsonRpcResponse<T>;
    }
  } catch (err) {
    logger.error(
      {
        err,
        method,
        requestId,
        contentType,
        snippet: responseText.slice(0, 200),
      },
      "MCP response parse failed",
    );
    if (err instanceof Error) {
      throw new Error(err.message);
    }
    throw new Error("MCP response parse failed");
  }

  if (!data || typeof data !== "object") {
    logger.error(
      { method, requestId, contentType, snippet: responseText.slice(0, 200) },
      "MCP response invalid payload",
    );
    throw new Error("MCP response invalid payload");
  }

  if (data?.error) {
    logger.error({ err: data.error, method, requestId }, "MCP response error");
    const rpcError = new Error(data.error.message ?? "MCP response error");
    (rpcError as Error & { code?: number }).code = data.error.code;
    throw rpcError;
  }

  if (!data || !("result" in data)) {
    logger.error({ method, requestId }, "MCP response missing result");
    throw new Error("MCP response missing result");
  }

  logger.debug({ method, requestId }, "MCP request completed");
  return data.result as T;
};
