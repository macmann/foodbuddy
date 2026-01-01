import { NextResponse } from "next/server";
import { prisma } from "../../../../../../lib/db";
import { resolvePlacesProvider } from "../../../../../../lib/places";

export const POST = async (
  _request: Request,
  { params }: { params: Promise<{ placeId: string }> },
) => {
  const selection = resolvePlacesProvider();
  if (!selection.provider) {
    return NextResponse.json(
      { ok: false, error: selection.reason ?? "Places provider unavailable." },
      { status: 503 },
    );
  }
  const provider = selection.provider;
  const { placeId } = await params;
  const details = await provider.placeDetails(placeId);

  if (!details) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  await prisma.place.upsert({
    where: { placeId: details.placeId },
    update: {
      name: details.name,
      address: details.address,
      lat: details.lat,
      lng: details.lng,
      googleRating: details.rating,
      googleRatingsTotal: details.userRatingsTotal,
      priceLevel: details.priceLevel,
      types: details.types,
      mapsUrl: details.mapsUrl,
      lastFetchedAt: new Date(),
    },
    create: {
      placeId: details.placeId,
      name: details.name,
      address: details.address,
      lat: details.lat,
      lng: details.lng,
      googleRating: details.rating,
      googleRatingsTotal: details.userRatingsTotal,
      priceLevel: details.priceLevel,
      types: details.types,
      mapsUrl: details.mapsUrl,
      lastFetchedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
};
