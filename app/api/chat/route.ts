import { NextResponse } from "next/server";
import { hashUserId } from "../../../lib/hash";
import { getPlacesProvider } from "../../../lib/places";
import { recommend } from "../../../lib/reco/engine";
import { haversineMeters } from "../../../lib/reco/scoring";

const buildRecommendationPayload = (
  result: Awaited<ReturnType<typeof recommend>>,
  location?: { lat: number; lng: number },
) => {
  const allResults = [result.primary, ...result.alternatives].filter(Boolean);
  return allResults.map((item) => {
    const distanceMeters = location
      ? haversineMeters(location, { lat: item.place.lat, lng: item.place.lng })
      : undefined;
    return {
      placeId: item.place.placeId,
      name: item.place.name,
      rating: item.place.rating,
      distanceMeters,
      openNow: item.place.openNow,
      address: item.place.address,
      mapsUrl: item.place.mapsUrl,
      rationale: item.explanation,
    };
  });
};

export async function POST(request: Request) {
  const body = (await request.json()) as {
    anonId: string;
    sessionId: string;
    location?: { lat: number; lng: number };
    locationText?: string;
    message: string;
  };

  if (!body?.anonId || !body?.sessionId || !body?.message) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const provider = getPlacesProvider();
  const userIdHash = hashUserId(body.anonId);
  let location = body.location ?? null;

  if (!location && body.locationText) {
    location = await provider.geocode(body.locationText);
  }

  if (!location) {
    return NextResponse.json({ error: "Location is required" }, { status: 400 });
  }

  const recommendation = await recommend({
    channel: "WEB",
    userIdHash,
    location,
    queryText: body.message,
  });

  const payload = buildRecommendationPayload(recommendation, location);
  const [primary, ...alternatives] = payload;

  const message = recommendation.primary
    ? "Here are a few spots you might like."
    : "Sorry, I couldn't find any places for that query.";

  return NextResponse.json({
    primary: primary ?? null,
    alternatives,
    message,
  });
}
