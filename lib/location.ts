export type GeoLocation =
  | {
      kind: "coords";
      coords: {
        lat: number;
        lng: number;
      };
    }
  | {
      kind: "text";
      text: {
        value: string;
      };
    }
  | {
      kind: "none";
    };

export type GeoLocationInput = {
  coordinates?: { lat: number; lng: number } | null;
  latitude?: number | null;
  longitude?: number | null;
  locationText?: string | null;
};

export const normalizeGeoLocation = (input: GeoLocationInput): GeoLocation => {
  const latitude = typeof input.latitude === "number" ? input.latitude : input.coordinates?.lat;
  const longitude =
    typeof input.longitude === "number" ? input.longitude : input.coordinates?.lng;

  if (
    typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    typeof longitude === "number" &&
    Number.isFinite(longitude)
  ) {
    return {
      kind: "coords",
      coords: { lat: latitude, lng: longitude },
    };
  }

  const text =
    typeof input.locationText === "string" ? input.locationText.trim() : "";
  if (text.length > 0) {
    return {
      kind: "text",
      text: { value: text },
    };
  }

  return { kind: "none" };
};

export const getLocationCoords = (
  location: GeoLocation | undefined,
): { lat: number; lng: number } | undefined =>
  location?.kind === "coords" ? location.coords : undefined;

export const getLocationText = (location: GeoLocation | undefined): string | undefined =>
  location?.kind === "text" ? location.text.value : undefined;
