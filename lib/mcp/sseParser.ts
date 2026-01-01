export const isLikelySse = (text: string, contentType: string): boolean => {
  if (contentType.toLowerCase().includes("text/event-stream")) {
    return true;
  }
  const trimmed = text.trimStart();
  return trimmed.startsWith("event:") || trimmed.startsWith("data:");
};

type SseParseError = Error & { dataSnippet?: string };

const buildSseError = (message: string, dataSnippet?: string): SseParseError => {
  const err = new Error(message) as SseParseError;
  if (dataSnippet) {
    err.dataSnippet = dataSnippet;
  }
  return err;
};

export const extractJsonFromSse = (text: string): unknown => {
  const dataLines = text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).replace(/^\s?/, ""))
    .filter((line) => line.length > 0 && line !== "[DONE]");

  if (dataLines.length === 0) {
    throw buildSseError("MCP SSE contained no data payload");
  }

  const parsedItems: unknown[] = [];
  for (const line of dataLines) {
    try {
      parsedItems.push(JSON.parse(line));
    } catch {
      // ignore and keep scanning; we'll try combined parsing later.
    }
  }

  const jsonRpcCandidate = parsedItems
    .slice()
    .reverse()
    .find((item) => {
      if (!item || typeof item !== "object") {
        return false;
      }
      const record = item as Record<string, unknown>;
      return "result" in record || "error" in record || "jsonrpc" in record;
    });

  if (jsonRpcCandidate) {
    return jsonRpcCandidate;
  }

  const payload = dataLines.join("\n").trim();
  if (!payload) {
    throw buildSseError("MCP SSE contained empty data payload");
  }

  try {
    return JSON.parse(payload);
  } catch {
    throw buildSseError("MCP SSE contained no JSON payload", payload.slice(0, 500));
  }
};
