import { NextResponse } from "next/server";
import { hashUserId } from "../../../lib/hash";
import { logger } from "../../../lib/logger";
import { createRequestContext } from "../../../lib/request";
import { rateLimit } from "../../../lib/rateLimit";
import { parseQuery, recommend, writeRecommendationEvent } from "../../../lib/reco/engine";
import { runFoodBuddyAgent } from "../../../lib/agent/agent";
import { haversineMeters } from "../../../lib/reco/scoring";
import { getLLMSettings } from "../../../lib/settings/llm";
import { isAllowedModel } from "../../../lib/agent/model";
import type {
  ChatResponse,
  ChatResponseDebug,
  RecommendationCardData,
} from "../../../lib/types/chat";

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

const buildAgentResponse = ({
  agentMessage,
  recommendations,
  status,
  toolCallCount,
  requestId,
  llmModel,
  fallbackUsed,
  errorMessage,
  latencyMs,
  debugEnabled,
  toolDebug,
}: {
  agentMessage: string | null | undefined;
  recommendations: RecommendationCardData[];
  status?: ChatResponse["status"];
  toolCallCount: number;
  requestId: string;
  llmModel?: string | null;
  fallbackUsed?: boolean;
  errorMessage?: string;
  latencyMs: number;
  debugEnabled: boolean;
  toolDebug?: Record<string, unknown>;
}): ChatResponse => {
  const hasRecommendations = recommendations.length > 0;
  const trimmedMessage = agentMessage?.trim();
  const message =
    trimmedMessage && trimmedMessage.length > 0
      ? trimmedMessage
      : hasRecommendations
        ? "Here are a few places you might like."
        : "Tell me a neighborhood or enable location so I can find nearby places.";
  const primary = recommendations[0] ?? null;
  const alternatives = recommendations.slice(1, 6);
  const resolvedStatus = status ?? (hasRecommendations ? "OK" : "NO_RESULTS");
  return {
    message,
    status: resolvedStatus,
    primary,
    alternatives,
    places: recommendations,
    meta: {
      source: "agent",
      toolCallCount,
      llmModel: llmModel ?? undefined,
      fallbackUsed,
      latencyMs,
      errorMessage,
      debug:
        errorMessage || (toolDebug as { tool?: { provider?: string } })?.tool?.provider
          ? {
              provider: (toolDebug as { tool?: { provider?: string } })?.tool?.provider,
              error: errorMessage,
            }
          : undefined,
    },
    debug: debugEnabled
      ? {
          source: "llm_agent",
          toolCallCount,
          requestId,
          tool: (toolDebug as { tool?: ChatResponseDebug["tool"] })?.tool,
        }
      : undefined,
  };
};

export async function POST(request: Request) {
  const { requestId, startTime } = createRequestContext(request);
  const channel = "WEB";
  const logContext = { requestId, channel };
  const debugEnabled = process.env.FOODBUDDY_DEBUG === "true";
  const respondChat = (status: number, payload: ChatResponse) => {
    const response = NextResponse.json(payload, { status });
    response.headers.set("x-request-id", requestId);
    logger.info(
      {
        ...logContext,
        latencyMs: Date.now() - startTime,
        responseKeys: Object.keys(payload),
        primary: Boolean(payload.primary),
        altCount: payload.alternatives?.length ?? 0,
        placesCount: payload.places?.length ?? 0,
      },
      "Returning ChatResponse",
    );
    return response;
  };
  const respondError = (status: number, payload: Record<string, unknown>) => {
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
    return respondError(400, { error: "Invalid request" });
  }

  if (body.message.length > 500) {
    return respondError(400, { error: "Message too long" });
  }

  const userIdHash = hashUserId(body.anonId);
  const latitude =
    typeof body.latitude === "number" ? body.latitude : body.location?.lat;
  const longitude =
    typeof body.longitude === "number" ? body.longitude : body.location?.lng;
  const hasCoordinates = latitude != null && longitude != null;
  const location = hasCoordinates ? { lat: latitude, lng: longitude } : null;
  const eventLocation = location
    ? { lat: roundCoord(location.lat), lng: roundCoord(location.lng) }
    : null;
  const locationEnabled = Boolean(body.locationEnabled);
  const locationText = body.neighborhood ?? body.locationText;
  const locale = request.headers.get("accept-language")?.split(",")[0];
  const radius_m =
    typeof body.radius_m === "number" && Number.isFinite(body.radius_m) && body.radius_m > 0
      ? body.radius_m
      : 1500;
  const radiusMeters = Math.round(radius_m);
  const radius_defaulted =
    locationEnabled &&
    hasCoordinates &&
    !(typeof body.radius_m === "number" && Number.isFinite(body.radius_m) && body.radius_m > 0);

  logger.info(
    {
      ...logContext,
      message: body.message,
      hasCoordinates,
      radius_m,
      radius_defaulted: radius_defaulted || undefined,
      locationEnabled,
    },
    "Incoming chat request",
  );

  if (locationEnabled && (latitude == null || longitude == null)) {
    return respondError(400, {
      error: "LOCATION_REQUIRED",
      message: "Please share your location or set a neighborhood.",
    });
  }

  const limiter = rateLimit(`chat:${userIdHash}`, 10, 60_000);
  if (!limiter.allowed) {
    const response = respondError(429, { error: "Rate limit exceeded" });
    response.headers.set(
      "Retry-After",
      Math.ceil((limiter.resetAt - Date.now()) / 1000).toString(),
    );
    return response;
  }

  let settings: Awaited<ReturnType<typeof getLLMSettings>> | undefined;
  try {
    settings = await getLLMSettings();

    const llmModel = settings.llmModel;
    const hasSystemPrompt =
      typeof settings.llmSystemPrompt === "string" &&
      settings.llmSystemPrompt.trim().length > 0;
    const agentEnabled = settings?.llmEnabled === true;
    const modelAllowed = isAllowedModel(llmModel);
    let reason = "agent_success";

    if (!agentEnabled) {
      reason = "agent_disabled";
    } else if (!llmModel) {
      reason = "missing_model";
    } else if (!modelAllowed) {
      reason = "invalid_model";
    } else if (!hasSystemPrompt) {
      reason = "missing_prompt";
    }

    if (reason === "agent_success") {
      if (!location && !locationText) {
        const message =
          "Tell me a neighborhood or enable location so I can find nearby places.";
        await writeRecommendationEvent(
          {
            channel: "WEB",
            userIdHash,
            location: eventLocation,
            queryText: body.message,
            requestId,
            locationEnabled,
            radiusMeters,
            source: "agent",
            agentEnabled,
            llmModel,
            toolCallCount: 0,
            fallbackUsed: false,
            rawResponseJson: truncateJson(JSON.stringify({ message })),
          },
          {
            status: "ERROR",
            latencyMs: Date.now() - startTime,
            errorMessage: "Missing location",
            resultCount: 0,
            recommendedPlaceIds: [],
            parsedConstraints: parseQuery(body.message),
          },
        );
        return respondChat(
          200,
          buildAgentResponse({
            agentMessage: message,
            recommendations: [],
            status: "ERROR",
            toolCallCount: 0,
            requestId,
            llmModel,
            fallbackUsed: false,
            latencyMs: Date.now() - startTime,
            debugEnabled,
          }),
        );
      }

      logger.info(
        { ...logContext, path: "llm_agent", agentEnabled, llmModel, hasSystemPrompt, reason },
        "Routing chat to agent",
      );
      const agentStart = Date.now();
      const agentResult = await runFoodBuddyAgent({
        userMessage: body.message,
        context: {
          location,
          locationText,
          radius_m,
          sessionId: body.sessionId,
          requestId,
          userIdHash,
          channel,
          locale: locale ?? undefined,
          locationEnabled,
        },
      });

      const recommendations =
        agentResult.places && agentResult.places.length > 0
          ? agentResult.places
          : ([agentResult.primary, ...(agentResult.alternatives ?? [])].filter(
              Boolean,
            ) as RecommendationCardData[]);
      const resultCount = recommendations.length;
      const status = agentResult.status;
      const parsedConstraints = parseQuery(body.message);
      const rawResponseJson = truncateJson(
        JSON.stringify({
          assistant: agentResult.message,
          toolCallCount: agentResult.toolCallCount,
          parsedOutput: agentResult.parsedOutput,
          toolResponses: agentResult.rawResponse,
        }),
      );
      const toolDebug = agentResult.toolDebug as
        | { tool?: { googleStatus?: string; error_message?: string } }
        | undefined;
      if (toolDebug?.tool || agentResult.toolCallCount > 0) {
        logger.info(
          {
            requestId,
            tool: "recommend_places",
            returnedCount: resultCount,
            googleStatusIfAny: toolDebug?.tool?.googleStatus,
            errorIfAny: toolDebug?.tool?.error_message,
          },
          "Tool result summary",
        );
      }

      await writeRecommendationEvent(
        {
          channel: "WEB",
          userIdHash,
          location: eventLocation,
          queryText: body.message,
          requestId,
          locationEnabled,
          radiusMeters,
          source: "agent",
          agentEnabled,
          llmModel,
          toolCallCount: agentResult.toolCallCount,
          fallbackUsed: agentResult.fallbackUsed,
          rawResponseJson,
        },
        {
          status,
          latencyMs: Date.now() - agentStart,
          resultCount,
          recommendedPlaceIds: recommendations.map((item) => item.placeId),
          parsedConstraints: {
            ...parsedConstraints,
            llm: agentResult.parsedOutput ?? null,
          },
        },
      );

      logger.info(
        { ...logContext, latencyMs: Date.now() - agentStart },
        "Agent response complete",
      );

      return respondChat(
        200,
        buildAgentResponse({
          agentMessage: agentResult.message,
          recommendations,
          status,
          toolCallCount: agentResult.toolCallCount,
          requestId,
          llmModel,
          fallbackUsed: agentResult.fallbackUsed,
          errorMessage: agentResult.errorMessage,
          latencyMs: Date.now() - agentStart,
          debugEnabled,
          toolDebug: agentResult.toolDebug,
        }),
      );
    }

    logger.info(
      {
        ...logContext,
        path: "internal_recommend",
        agentEnabled,
        llmModel,
        hasSystemPrompt,
        reason,
      },
      "Routing chat to internal recommendations",
    );
  } catch (err) {
    logger.error(
      {
        err,
        ...logContext,
        path: "internal_recommend",
        reason: "agent_failed_fallback",
      },
      "Agent failed; falling back to recommendations",
    );
  }

  const llmSettings = undefined;
  const resolvedSettings = undefined;
  const agentEnabled =
    typeof (settings as any)?.agentEnabled === "boolean"
      ? (settings as any).agentEnabled
      : typeof (llmSettings as any)?.agentEnabled === "boolean"
        ? (llmSettings as any).agentEnabled
        : typeof (resolvedSettings as any)?.agentEnabled === "boolean"
          ? (resolvedSettings as any).agentEnabled
          : false;
  const llmModel =
    (settings as any)?.llmModel ??
    (llmSettings as any)?.llmModel ??
    (resolvedSettings as any)?.llmModel ??
    null;

  if (!location) {
    logger.info({ ...logContext, path: "fallback" }, "Missing location for chat");
    const message = "Please share a location so I can find nearby places.";
    await writeRecommendationEvent(
      {
        channel: "WEB",
        userIdHash,
        location: eventLocation,
        queryText: body.message,
        requestId,
        locationEnabled,
        radiusMeters,
        source: "internal",
        agentEnabled,
        llmModel,
        toolCallCount: 0,
        fallbackUsed: false,
        rawResponseJson: truncateJson(JSON.stringify({ message })),
      },
      {
        status: "ERROR",
        latencyMs: Date.now() - startTime,
        errorMessage: "Missing location",
        resultCount: 0,
        recommendedPlaceIds: [],
        parsedConstraints: parseQuery(body.message),
      },
    );
    return respondChat(200, {
      primary: null,
      alternatives: [],
      message,
      status: "ERROR",
      places: [],
      meta: {
        source: "internal",
        toolCallCount: 0,
        latencyMs: Date.now() - startTime,
      },
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
      radiusMetersOverride: radiusMeters,
      requestId,
    });

    const payload = buildRecommendationPayload(recommendation, location);
    const [primary, ...alternatives] = payload;
    const recommendedPlaceIds = payload.map((item) => item.placeId);
    const resultCount = payload.length;
    const recommendationDebug = recommendation.debug as
      | { tool?: { error_message?: string; provider?: string } }
      | undefined;
    const providerErrorMessage = recommendationDebug?.tool?.error_message
      ? "Places provider unavailable; please try again."
      : undefined;
    const status = providerErrorMessage
      ? "ERROR"
      : resultCount === 0
        ? "NO_RESULTS"
        : "OK";

    await writeRecommendationEvent(
      {
        channel: "WEB",
        userIdHash,
        location: eventLocation,
        queryText: body.message,
        requestId,
        locationEnabled,
        radiusMeters,
        source: "internal",
        agentEnabled,
        llmModel,
        toolCallCount: 0,
        fallbackUsed: false,
        rawResponseJson: truncateJson(
          JSON.stringify({
            status,
            resultCount,
            recommendedPlaceIds,
          }),
        ),
      },
      {
        status,
        latencyMs: Date.now() - recommendationStart,
        resultCount,
        recommendedPlaceIds,
        errorMessage: providerErrorMessage,
        parsedConstraints,
      },
    );

    const message =
      providerErrorMessage ??
      (resultCount > 0
        ? "Here are a few spots you might like."
        : "Sorry, I couldn't find any places for that query.");

    return respondChat(200, {
      primary: primary ?? null,
      alternatives,
      message,
      status,
      places: payload,
      meta: {
        source: "internal",
        toolCallCount: 0,
        latencyMs: Date.now() - recommendationStart,
        errorMessage: providerErrorMessage,
        debug: providerErrorMessage
          ? {
              provider: recommendationDebug?.tool?.provider,
              error: recommendationDebug?.tool?.error_message,
            }
          : undefined,
      },
    });
  } catch (fallbackError) {
    const errorMessage =
      fallbackError instanceof Error ? fallbackError.message : "Unknown error";
    await writeRecommendationEvent(
      {
        channel: "WEB",
        userIdHash,
        location: eventLocation,
        queryText: body.message,
        requestId,
        locationEnabled,
        radiusMeters,
        source: "internal",
        agentEnabled,
        llmModel,
        toolCallCount: 0,
        fallbackUsed: false,
        rawResponseJson: truncateJson(
          JSON.stringify({ error: errorMessage, message: "Internal fallback error" }),
        ),
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
    return respondChat(200, {
      primary: null,
      alternatives: [],
      message: "Sorry, something went wrong while finding places.",
      status: "ERROR",
      places: [],
      meta: {
        source: "internal",
        toolCallCount: 0,
        latencyMs: Date.now() - recommendationStart,
      },
    });
  }
}

const truncateJson = (value: string, maxLength = 8000) =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

const roundCoord = (value: number) => Math.round(value * 100) / 100;
