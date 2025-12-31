import { NextResponse } from "next/server";
import { hashUserId } from "../../../lib/hash";
import { logger } from "../../../lib/logger";
import { createRequestContext } from "../../../lib/request";
import { rateLimit } from "../../../lib/rateLimit";
import { parseQuery, recommend, writeRecommendationEvent } from "../../../lib/reco/engine";
import { runFoodBuddyAgent } from "../../../lib/agent/agent";
import { haversineMeters } from "../../../lib/reco/scoring";
import { getLLMSettings } from "../../../lib/settings/llm";

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
    neighborhood?: string;
    message: string;
    latitude?: number | null;
    longitude?: number | null;
    radius_m?: number | null;
    locationEnabled?: boolean;
  };

  if (!body?.anonId || !body?.sessionId || !body?.message) {
    return respond(400, { error: "Invalid request" });
  }

  if (body.message.length > 500) {
    return respond(400, { error: "Message too long" });
  }

  const userIdHash = hashUserId(body.anonId);
  const latitude =
    typeof body.latitude === "number" ? body.latitude : body.location?.lat;
  const longitude =
    typeof body.longitude === "number" ? body.longitude : body.location?.lng;
  const location =
    latitude != null && longitude != null ? { lat: latitude, lng: longitude } : null;
  const locationEnabled = Boolean(body.locationEnabled);
  const locationText = body.neighborhood ?? body.locationText;
  const locale = request.headers.get("accept-language")?.split(",")[0];

  logger.info(
    {
      ...logContext,
      message: body.message,
      hasCoordinates: latitude != null && longitude != null,
      radius_m: body.radius_m ?? null,
      locationEnabled,
    },
    "Incoming chat request",
  );

  if (locationEnabled && (latitude == null || longitude == null)) {
    return respond(400, {
      error: "LOCATION_REQUIRED",
      message: "Please share your location or set a neighborhood.",
    });
  }

  const limiter = rateLimit(`chat:${userIdHash}`, 10, 60_000);
  if (!limiter.allowed) {
    const response = respond(429, { error: "Rate limit exceeded" });
    response.headers.set(
      "Retry-After",
      Math.ceil((limiter.resetAt - Date.now()) / 1000).toString(),
    );
    return response;
  }

  try {
    const settings = await getLLMSettings();

    if (settings.llmEnabled) {
      logger.info({ ...logContext, path: "llm_agent" }, "Routing chat to agent");
      const agentStart = Date.now();
      const agentResult = await runFoodBuddyAgent({
        userMessage: body.message,
        context: {
          location,
          locationText,
          sessionId: body.sessionId,
          requestId,
          userIdHash,
          channel,
          locale: locale ?? undefined,
        },
      });

      const recommendations = [agentResult.primary, ...agentResult.alternatives].filter(
        Boolean,
      );

      if (location) {
        const parsedConstraints = parseQuery(body.message);
        await writeRecommendationEvent(
          {
            channel: "WEB",
            userIdHash,
            location,
            queryText: body.message,
          },
          {
            status: recommendations.length === 0 ? "NO_RESULTS" : "OK",
            latencyMs: Date.now() - agentStart,
            resultCount: recommendations.length,
            recommendedPlaceIds: recommendations.map((item) => item!.placeId),
            parsedConstraints,
          },
        );
      }

      logger.info(
        { ...logContext, latencyMs: Date.now() - agentStart },
        "Agent response complete",
      );

      return respond(200, {
        replyText: agentResult.message,
        places: recommendations,
        primary: agentResult.primary,
        alternatives: agentResult.alternatives,
        message: agentResult.message,
      });
    }
  } catch (err) {
    logger.error({ err, ...logContext }, "Agent failed; falling back to recommendations");
  }

  if (!location) {
    logger.info({ ...logContext, path: "fallback" }, "Missing location for chat");
    return respond(200, {
      primary: null,
      alternatives: [],
      message: "Please share a location so I can find nearby places.",
      replyText: "Please share a location so I can find nearby places.",
      places: [],
    });
  }

  const recommendationStart = Date.now();
  const parsedConstraints = parseQuery(body.message);
  try {
    logger.info(
      { ...logContext, path: "internal_recommend" },
      "Routing chat to internal recommendations",
    );
    const recommendation = await recommend({
      channel: "WEB",
      userIdHash,
      location,
      queryText: body.message,
    });

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
      replyText: message,
      places: payload,
    });
  } catch (fallbackError) {
    const errorMessage =
      fallbackError instanceof Error ? fallbackError.message : "Unknown error";
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
    logger.error({ err: fallbackError, ...logContext }, "Failed fallback recommendations");
    return respond(200, {
      primary: null,
      alternatives: [],
      message: "Sorry, something went wrong while finding places.",
      replyText: "Sorry, something went wrong while finding places.",
      places: [],
    });
  }
}
