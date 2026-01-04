type GeocodeContext = {
  requestId?: string;
  locale?: string | null;
  countryHint?: string | null;
  coords?: { lat: number; lng: number } | null;
};

type GeocodeResult = {
  coords: { lat: number; lng: number } | null;
  formattedAddress: string | null;
};

type GeocodeLocationText = (
  locationText: string,
  ctx: GeocodeContext,
) => Promise<GeocodeResult>;

export type SearchCoordsSource = "request_coords" | "geocoded" | "none";

export type ResolveSearchCoordsInput = {
  reqCoords: { lat: number; lng: number } | null;
  locationText?: string;
  sessionCoords: { lat: number; lng: number } | null;
  requestId: string;
  locale: string | null;
  countryHint: string | null;
  coords: { lat: number; lng: number } | null;
  geocode: GeocodeLocationText;
};

export type ResolveSearchCoordsResult = {
  searchCoords: { lat: number; lng: number } | null;
  coordsSource: SearchCoordsSource;
  resolvedLocationLabel?: string;
  searchLocationText?: string;
  confirmMessage?: string;
  geocodeFailed: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const coerceNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

export const normalizeRequestCoords = (
  payload: unknown,
): { lat: number; lng: number } | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const extractFromRecord = (record: Record<string, unknown>) => {
    const lat = coerceNumber(record.lat ?? record.latitude);
    const lng = coerceNumber(record.lng ?? record.longitude);
    if (lat !== undefined && lng !== undefined) {
      return { lat, lng };
    }
    return null;
  };

  const directCoords = extractFromRecord(payload);
  if (directCoords) {
    return directCoords;
  }

  const nestedKeys = ["coords", "coordinates", "location"] as const;
  for (const key of nestedKeys) {
    const value = payload[key];
    if (isRecord(value)) {
      const nestedCoords = extractFromRecord(value);
      if (nestedCoords) {
        return nestedCoords;
      }
    }
  }

  return null;
};

export const resolveSearchCoords = async (
  input: ResolveSearchCoordsInput,
): Promise<ResolveSearchCoordsResult> => {
  if (input.reqCoords) {
    return {
      searchCoords: input.reqCoords,
      coordsSource: "request_coords",
      geocodeFailed: false,
    };
  }

  if (input.locationText) {
    const geocodeResult = await input.geocode(input.locationText, {
      requestId: input.requestId,
      locale: input.locale,
      countryHint: input.countryHint,
      coords: input.coords,
    });
    if (!geocodeResult.coords) {
      return {
        searchCoords: null,
        coordsSource: "none",
        geocodeFailed: true,
      };
    }
    const resolvedLocationLabel =
      geocodeResult.formattedAddress ?? input.locationText;
    return {
      searchCoords: geocodeResult.coords,
      coordsSource: "geocoded",
      resolvedLocationLabel,
      searchLocationText: resolvedLocationLabel,
      confirmMessage: `Got it — searching near ${resolvedLocationLabel}…`,
      geocodeFailed: false,
    };
  }

  if (input.sessionCoords) {
    return {
      searchCoords: input.sessionCoords,
      coordsSource: "none",
      geocodeFailed: false,
    };
  }

  return {
    searchCoords: null,
    coordsSource: "none",
    geocodeFailed: false,
  };
};
