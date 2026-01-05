export type AdminPlacePayload = {
  name?: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  mapsUrl?: string | null;
  externalPlaceId?: string | null;
  cuisineTags?: string[];
  priceLevel?: number | null;
  isCurated?: boolean;
  isFeatured?: boolean;
  placeId?: string;
};

export type AdminPlaceRecord = {
  placeId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  mapsUrl: string | null;
  externalPlaceId: string | null;
  cuisineTags: string[];
  priceLevel: number | null;
  source: "GOOGLE" | "CURATED";
  isFeatured: boolean;
  createdAt: string;
  updatedAt: string;
};

const parseErrorMessage = async (response: Response, fallback: string) => {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error ?? fallback;
  } catch {
    return fallback;
  }
};

export const createAdminPlace = async (payload: AdminPlacePayload) => {
  const response = await fetch("/api/admin/places", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Failed to create place."));
  }

  return (await response.json()) as AdminPlaceRecord;
};

export const updateAdminPlace = async (placeId: string, payload: AdminPlacePayload) => {
  const response = await fetch(`/api/admin/places/${placeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Failed to update place."));
  }

  return (await response.json()) as AdminPlaceRecord;
};

export const deleteAdminPlace = async (placeId: string) => {
  const response = await fetch(`/api/admin/places/${placeId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Failed to delete place."));
  }

  return (await response.json()) as { ok: true };
};
