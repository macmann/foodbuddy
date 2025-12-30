export const isLikelySse = (text: string, contentType: string): boolean => {
  if (contentType.toLowerCase().includes("text/event-stream")) {
    return true;
  }
  const trimmed = text.trimStart();
  return trimmed.startsWith("event:") || trimmed.startsWith("data:");
};

export const extractJsonFromSse = (text: string): unknown => {
  const blocks = text.split(/\n\n+/);
  let lastJson: unknown = null;

  for (const block of blocks) {
    const dataLines = block
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.startsWith("data:"));

    if (dataLines.length === 0) {
      continue;
    }

    const payload = dataLines
      .map((line) => line.slice("data:".length).replace(/^\s?/, ""))
      .join("\n")
      .trim();

    if (!payload) {
      continue;
    }

    try {
      lastJson = JSON.parse(payload);
    } catch {
      // Ignore non-JSON data payloads; keep looking for a JSON payload.
    }
  }

  if (lastJson === null) {
    throw new Error("MCP SSE contained no JSON payload");
  }

  return lastJson;
};
