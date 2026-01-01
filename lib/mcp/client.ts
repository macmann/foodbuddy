import { logger } from "../logger";
import { extractJsonFromSse, isLikelySse } from "./sseParser";
import { extractMcpContentSnippet } from "./resultParser";
import type { JsonRpcResponse, ListToolsResult, ToolDefinition } from "./types";

type McpCallOptions = {
  url: string;
  apiKey: string;
  method: string;
  params?: Record<string, unknown>;
  requestId?: string;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const TOOLS_TTL_MS = 5 * 60 * 1000;

const buildRequestId = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let toolsCache:
  | {
      expiresAt: number;
      value: ListToolsResult;
      url: string;
      apiKey: string;
    }
  | null = null;

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
  requestId,
}: McpCallOptions): Promise<T | null> => {
  const rpcRequestId = requestId ? `${requestId}:${buildRequestId()}` : buildRequestId();
  const payload = {
    jsonrpc: "2.0",
    id: rpcRequestId,
    method,
    params: params ?? {},
  };

  logger.info(
    {
      method,
      requestId,
      rpcRequestId,
      url: redactUrl(url),
      payloadShape: {
        paramsKeys: Object.keys(payload.params ?? {}),
      },
    },
    "MCP request started",
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    const headers: Record<string, string> = {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    };
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }
    logger.debug(
      { accept: headers.Accept, contentType: headers["Content-Type"], method, requestId },
      "MCP request headers prepared",
    );

    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    logger.error({ err, method, requestId, url: redactUrl(url) }, "MCP request failed to send");
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
    const error = new Error(
      `MCP request failed: ${response.status} ${response.statusText || "Unknown error"}`,
    ) as Error & { status?: number; responseText?: string };
    error.status = response.status;
    error.responseText = responseText.slice(0, 500);
    throw error;
  }

  const contentType = response.headers.get("content-type") ?? "";
  logger.info(
    {
      method,
      requestId,
      rpcRequestId,
      status: response.status,
      contentType,
    },
    "MCP response received",
  );
  const responseText = contentType.toLowerCase().includes("text/event-stream")
    ? await readEventStream(response)
    : await response.text();

  let data: JsonRpcResponse<T> | null = null;
  try {
    if (contentType.toLowerCase().includes("text/event-stream")) {
      data = extractJsonFromSse(responseText) as JsonRpcResponse<T>;
    } else if (isLikelySse(responseText, contentType)) {
      data = extractJsonFromSse(responseText) as JsonRpcResponse<T>;
    } else {
      data = JSON.parse(responseText) as JsonRpcResponse<T>;
    }
  } catch (err) {
    const dataSnippet = (err as Error & { dataSnippet?: string }).dataSnippet;
    logger.error(
      {
        err,
        method,
        requestId,
        contentType,
        snippet: responseText.slice(0, 200),
        dataSnippet,
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

  const responseKeys = Object.keys(data as Record<string, unknown>);
  const resultKeys =
    data && typeof data.result === "object" && data.result !== null
      ? Object.keys(data.result as Record<string, unknown>)
      : [];
  const contentSnippet = extractMcpContentSnippet(data.result);
  logger.debug(
    { method, requestId, rpcRequestId, responseKeys, resultKeys, contentSnippet },
    "MCP request completed",
  );
  return data.result as T;
};

export const listMcpTools = async ({
  url,
  apiKey,
  requestId,
}: {
  url: string;
  apiKey: string;
  requestId?: string;
}): Promise<ToolDefinition[]> => {
  const now = Date.now();
  if (
    toolsCache &&
    toolsCache.expiresAt > now &&
    toolsCache.url === url &&
    toolsCache.apiKey === apiKey
  ) {
    return Array.isArray(toolsCache.value.tools) ? toolsCache.value.tools : [];
  }

  const result = await mcpCall<ListToolsResult>({
    url,
    apiKey,
    method: "tools/list",
    params: {},
    requestId,
  });

  const resolvedResult: ListToolsResult = {
    tools: Array.isArray(result?.tools) ? result.tools : [],
  };

  toolsCache = {
    expiresAt: now + TOOLS_TTL_MS,
    value: resolvedResult,
    url,
    apiKey,
  };

  const toolNames = resolvedResult.tools.map((tool) => tool.name).filter(Boolean);
  logger.debug({ toolCount: toolNames.length, toolNames }, "MCP tools listed");

  return resolvedResult.tools;
};

export const invalidateMcpToolsCache = ({ url, apiKey }: { url?: string; apiKey?: string }) => {
  if (!toolsCache) {
    return;
  }
  if (url && toolsCache.url !== url) {
    return;
  }
  if (apiKey && toolsCache.apiKey !== apiKey) {
    return;
  }
  toolsCache = null;
};

const readEventStream = async (response: Response): Promise<string> => {
  if (!response.body) {
    return response.text();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
  }

  buffer += decoder.decode();
  return buffer;
};
