import { NextResponse } from "next/server";
import { prisma } from "../../../../../../lib/db";
import { getPlacesProvider } from "../../../../../../lib/places";

export const POST = async (
  _request: Request,
  { params }: { params: Promise<{ placeId: string }> },
) => {
  const provider = getPlacesProvider();
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
