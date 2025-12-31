export const isLikelySse = (text: string, contentType: string): boolean => {
  if (contentType.toLowerCase().includes("text/event-stream")) {
    return true;
  }
  const trimmed = text.trimStart();
  return trimmed.startsWith("event:") || trimmed.startsWith("data:");
};

export const extractJsonFromSse = (text: string): unknown => {
  const dataLines = text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).replace(/^\s?/, ""));

  if (dataLines.length === 0) {
    throw new Error("MCP SSE contained no data payload");
  }

  const payload = dataLines.join("\n").trim();
  if (!payload) {
    throw new Error("MCP SSE contained empty data payload");
  }

  let lastJson: unknown = null;
  const payloadSegments = payload.split("\n").filter(Boolean);
  for (const segment of payloadSegments) {
    try {
      lastJson = JSON.parse(segment);
    } catch {
      // keep scanning
    }
  }

  if (lastJson !== null) {
    return lastJson;
  }

  try {
    return JSON.parse(payload);
  } catch {
    throw new Error("MCP SSE contained no JSON payload");
  }
};
