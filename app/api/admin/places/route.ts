import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";

const parseBooleanParam = (value: string | null) => {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no"].includes(normalized)) {
    return false;
  }
  return undefined;
};

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
  typeof value === "string" ? value.trim() : "";

const parseTags = (value: unknown) => {
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

export const GET = async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query")?.trim() ?? "";
  const isCurated = parseBooleanParam(searchParams.get("isCurated"));
  const isFeatured = parseBooleanParam(searchParams.get("isFeatured"));
  const page = Number.parseInt(searchParams.get("page") ?? "1", 10) || 1;
  const pageSize = Number.parseInt(searchParams.get("pageSize") ?? "50", 10) || 50;

  const where = {
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { address: { contains: query, mode: "insensitive" } },
            { placeId: { contains: query, mode: "insensitive" } },
            { externalPlaceId: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(isCurated === undefined ? {} : { source: isCurated ? "CURATED" : "GOOGLE" }),
    ...(isFeatured === undefined ? {} : { isFeatured }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.place.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.place.count({ where }),
  ]);

  return NextResponse.json({
    items: items.map(formatPlace),
    total,
    page,
    pageSize,
  });
};

export const POST = async (request: Request) => {
  let payload: Record<string, unknown> = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = parseString(payload.name);
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const address = parseString(payload.address);
  const mapsUrl = parseString(payload.mapsUrl);
  const externalPlaceId = parseString(payload.externalPlaceId);
  const placeIdInput = parseString(payload.placeId);
  const priceLevel = parseNumber(payload.priceLevel);
  const lat = parseNumber(payload.lat);
  const lng = parseNumber(payload.lng);
  const isCurated = typeof payload.isCurated === "boolean" ? payload.isCurated : false;
  const isFeatured =
    typeof payload.isFeatured === "boolean" ? payload.isFeatured : false;
  const cuisineTags = parseTags(payload.cuisineTags) ?? [];

  const placeId = placeIdInput || `curated-${crypto.randomUUID()}`;

  try {
    const created = await prisma.place.create({
      data: {
        placeId,
        name,
        address: address || null,
        lat: lat ?? 0,
        lng: lng ?? 0,
        mapsUrl: mapsUrl || null,
        externalPlaceId: externalPlaceId || null,
        priceLevel: priceLevel ?? null,
        cuisineTags,
        source: isCurated ? "CURATED" : "GOOGLE",
        isFeatured,
      },
    });

    return NextResponse.json(formatPlace(created));
  } catch (error) {
    return NextResponse.json({ error: "Unable to create place" }, { status: 400 });
  }
};
