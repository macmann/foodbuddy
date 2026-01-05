import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/db";

const parseNumber = (value: unknown) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const parseString = (value: unknown) =>
  typeof value === "string" ? value.trim() : undefined;

const parseNullableString = (value: unknown) => {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return undefined;
};

const parseTags = (value: unknown) => {
  if (value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
    .filter(Boolean);
};

const formatPlace = (place: {
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
  createdAt: Date;
  updatedAt: Date;
}) => ({
  ...place,
  createdAt: place.createdAt.toISOString(),
  updatedAt: place.updatedAt.toISOString(),
});

export const PUT = async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  let payload: Record<string, unknown> = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};

  if ("name" in payload) {
    const name = parseString(payload.name);
    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    updateData.name = name;
  }

  if ("address" in payload) {
    updateData.address = parseNullableString(payload.address);
  }

  if ("mapsUrl" in payload) {
    updateData.mapsUrl = parseNullableString(payload.mapsUrl);
  }

  if ("externalPlaceId" in payload) {
    updateData.externalPlaceId = parseNullableString(payload.externalPlaceId);
  }

  if ("priceLevel" in payload) {
    const priceLevel = parseNumber(payload.priceLevel);
    if (payload.priceLevel !== null && priceLevel === undefined) {
      return NextResponse.json({ error: "Invalid price level" }, { status: 400 });
    }
    updateData.priceLevel = priceLevel ?? null;
  }

  if ("lat" in payload) {
    const lat = parseNumber(payload.lat);
    if (payload.lat !== null && lat === undefined) {
      return NextResponse.json({ error: "Invalid latitude" }, { status: 400 });
    }
    updateData.lat = lat ?? 0;
  }

  if ("lng" in payload) {
    const lng = parseNumber(payload.lng);
    if (payload.lng !== null && lng === undefined) {
      return NextResponse.json({ error: "Invalid longitude" }, { status: 400 });
    }
    updateData.lng = lng ?? 0;
  }

  if ("isCurated" in payload && typeof payload.isCurated === "boolean") {
    updateData.source = payload.isCurated ? "CURATED" : "GOOGLE";
  }

  if ("isFeatured" in payload && typeof payload.isFeatured === "boolean") {
    updateData.isFeatured = payload.isFeatured;
  }

  if ("cuisineTags" in payload) {
    const cuisineTags = parseTags(payload.cuisineTags);
    if (cuisineTags === undefined) {
      return NextResponse.json({ error: "Invalid cuisine tags" }, { status: 400 });
    }
    updateData.cuisineTags = cuisineTags;
  }

  try {
    const updated = await prisma.place.update({
      where: { placeId: id },
      data: updateData,
    });
    return NextResponse.json(formatPlace(updated));
  } catch (error) {
    return NextResponse.json({ error: "Unable to update place" }, { status: 400 });
  }
};

export const DELETE = async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  try {
    await prisma.place.delete({ where: { placeId: id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: "Unable to delete place" }, { status: 400 });
  }
};
