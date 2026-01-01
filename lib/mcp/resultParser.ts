const MAX_SNIPPET_LENGTH = 300;

type ContentItem = {
  type?: string;
  text?: string;
  json?: unknown;
  content?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object");

export const parseJsonFromText = (text: string): unknown | null => {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // try to parse a JSON-like substring
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");

  const candidates: string[] = [];
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(trimmed.slice(objectStart, objectEnd + 1));
  }
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    candidates.push(trimmed.slice(arrayStart, arrayEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // keep scanning
    }
  }

  return null;
};

export const extractMcpContentText = (result: unknown): string[] => {
  if (!isRecord(result)) {
    return [];
  }
  const content = result.content;
  if (!Array.isArray(content)) {
    return [];
  }

  const textSegments: string[] = [];
  for (const item of content) {
    if (!isRecord(item)) {
      continue;
    }
    const candidate = (item as ContentItem).text ?? (item as ContentItem).content;
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      textSegments.push(candidate.trim());
    }
  }
  return textSegments;
};

export const resolveMcpPayloadFromResult = (
  result: unknown,
): { payload: unknown; contentText?: string } => {
  if (!isRecord(result)) {
    return { payload: result };
  }

  const content = result.content;
  if (Array.isArray(content)) {
    const jsonItem = content.find((item) => isRecord(item) && "json" in item);
    if (jsonItem && isRecord(jsonItem)) {
      return { payload: jsonItem.json, contentText: undefined };
    }

    const textSegments = extractMcpContentText(result);
    const combinedText = textSegments.join("\n").trim();
    const parsedJson = combinedText ? parseJsonFromText(combinedText) : null;
    if (parsedJson) {
      return { payload: parsedJson, contentText: combinedText };
    }

    return { payload: result, contentText: combinedText || undefined };
  }

  return { payload: result };
};

export const extractMcpContentSnippet = (result: unknown): string | undefined => {
  const textSegments = extractMcpContentText(result);
  if (textSegments.length === 0) {
    return undefined;
  }
  const snippet = textSegments.join(" ").slice(0, MAX_SNIPPET_LENGTH).trim();
  return snippet.length > 0 ? snippet : undefined;
};
