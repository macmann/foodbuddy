import { NextResponse } from "next/server";
import { hashUserId } from "../../../lib/hash";
import { getPlacesProvider } from "../../../lib/places";
import { logger } from "../../../lib/logger";
import { createRequestContext } from "../../../lib/request";
import { rateLimit } from "../../../lib/rateLimit";
import { parseQuery, recommend, writeRecommendationEvent } from "../../../lib/reco/engine";
import { haversineMeters } from "../../../lib/reco/scoring";

const buildRecommendationPayload = (
  result: Awaited<ReturnType<typeof recommend>>,
  location?: { lat: number; lng: number },
) => {
  const allResults = [result.primary, ...result.alternatives].filter(Boolean);
  const results = allResults.filter(
    (item): item is NonNullable<typeof item> => item !== null
  );
  return results.map((item) => {
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
  const { requestId, startTime } = createRequestContext(request);
  const channel = "WEB";
  const logContext = { requestId, channel };
  const respond = (status: number, payload: Record<string, unknown>) => {
    const response = NextResponse.json(payload, { status });
    response.headers.set("x-request-id", requestId);
    logger.info({ ...logContext, latencyMs: Date.now() - startTime }, "chat request complete");
    return response;
  };

  const body = (await request.json()) as {
    anonId: string;
    sessionId: string;
    location?: { lat: number; lng: number };
    locationText?: string;
    message: string;
  };

  if (!body?.anonId || !body?.sessionId || !body?.message) {
    return respond(400, { error: "Invalid request" });
  }

  if (body.message.length > 500) {
    return respond(400, { error: "Message too long" });
  }

  const provider = getPlacesProvider();
  const userIdHash = hashUserId(body.anonId);
  let location = body.location ?? null;

  const limiter = rateLimit(`chat:${userIdHash}`, 10, 60_000);
  if (!limiter.allowed) {
    const response = respond(429, { error: "Rate limit exceeded" });
    response.headers.set(
      "Retry-After",
      Math.ceil((limiter.resetAt - Date.now()) / 1000).toString(),
    );
    return response;
  }

  if (!location && body.locationText) {
    location = await provider.geocode(body.locationText);
  }

  if (!location) {
    return respond(400, { error: "Location is required" });
  }

  const recommendationStart = Date.now();
  const parsedConstraints = parseQuery(body.message);
  let recommendation;
  try {
    recommendation = await recommend({
      channel: "WEB",
      userIdHash,
      location,
      queryText: body.message,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await writeRecommendationEvent(
      {
        channel: "WEB",
        userIdHash,
        location,
        queryText: body.message,
      },
      {
        status: "ERROR",
        latencyMs: Date.now() - recommendationStart,
        errorMessage,
        resultCount: 0,
        recommendedPlaceIds: [],
        parsedConstraints,
      },
    );
    logger.error({ error, ...logContext }, "Failed to generate recommendations");
    return respond(500, { error: "Failed to generate recommendations" });
  }

  const payload = buildRecommendationPayload(recommendation, location);
  const [primary, ...alternatives] = payload;
  const recommendedPlaceIds = payload.map((item) => item.placeId);
  const resultCount = payload.length;
  const status = resultCount === 0 ? "NO_RESULTS" : "OK";

  await writeRecommendationEvent(
    {
      channel: "WEB",
      userIdHash,
      location,
      queryText: body.message,
    },
    {
      status,
      latencyMs: Date.now() - recommendationStart,
      resultCount,
      recommendedPlaceIds,
      parsedConstraints,
    },
  );

  const message = recommendation.primary
    ? "Here are a few spots you might like."
    : "Sorry, I couldn't find any places for that query.";

  return respond(200, {
    primary: primary ?? null,
    alternatives,
    message,
  });
}
