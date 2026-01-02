import { parseJsonFromText, resolveMcpPayloadFromResult } from "./resultParser";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const extractPlacesArray = (payload: unknown): Record<string, unknown>[] => {
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload)) {
    return payload.filter((item) => item && typeof item === "object") as Record<
      string,
      unknown
    >[];
  }
  if (isRecord(payload)) {
    const record = payload;
    const listCandidates =
      record.results ?? record.places ?? record.candidates ?? record.items ?? record.data;
    if (Array.isArray(listCandidates)) {
      return listCandidates.filter((item) => item && typeof item === "object") as Record<
        string,
        unknown
      >[];
    }
    if (isRecord(record.data) && Array.isArray(record.data.places)) {
      return record.data.places.filter(
        (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object",
      );
    }
    if (record.result && typeof record.result === "object") {
      return extractPlacesArray(record.result);
    }
  }
  return [];
};

const extractPlacesFromText = (text: string): Record<string, unknown>[] => {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const places: Record<string, unknown>[] = [];
  for (const line of lines) {
    const urlMatch = line.match(/https?:\/\/\S+/i)?.[0];
    const nameMatch = line.match(/^\d+\.?\s*([^\-–—(]+?)(?:\s+[\-–—]|\s*\(|$)/);
    const addressMatch = line.match(/address\s*[:\-]\s*([^,]+)/i);
    const ratingMatch = line.match(/rating\s*[:\-]\s*([\d.]+)/i);
    const name = nameMatch?.[1]?.trim();

    if (!name && !urlMatch && !addressMatch) {
      continue;
    }

    const place: Record<string, unknown> = {
      name: name ?? line,
    };

    if (addressMatch?.[1]) {
      place.address = addressMatch[1].trim();
    }
    if (ratingMatch?.[1]) {
      place.rating = Number(ratingMatch[1]);
    }
    if (urlMatch) {
      place.mapsUrl = urlMatch;
    }

    places.push(place);
  }

  return places;
};

export const extractPlacesFromMcpResult = (result: unknown): {
  places: Record<string, unknown>[];
  contentText?: string;
  successfull?: boolean;
  error?: string;
} => {
  const { payload, contentText } = resolveMcpPayloadFromResult(result);
  const record = isRecord(payload) ? payload : undefined;
  const successfull =
    typeof record?.successfull === "boolean" ? record.successfull : undefined;
  const error = typeof record?.error === "string" ? record.error : undefined;
  let places = extractPlacesArray(payload);

  if (places.length === 0 && contentText) {
    const parsed = parseJsonFromText(contentText);
    if (parsed) {
      places = extractPlacesArray(parsed);
    }
    if (places.length === 0) {
      places = extractPlacesFromText(contentText);
    }
  }

  if (successfull === false) {
    places = [];
  }

  return { places, contentText, successfull, error };
};
