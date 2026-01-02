import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { hashUserId } from "../../../lib/hash";
import { logger } from "../../../lib/logger";
import { createRequestContext } from "../../../lib/request";
import { rateLimit } from "../../../lib/rateLimit";
import { parseQuery, recommend, writeRecommendationEvent } from "../../../lib/reco/engine";
import { runFoodBuddyAgent } from "../../../lib/agent/agent";
import { getLocationCoords, normalizeGeoLocation, type GeoLocation } from "../../../lib/location";
import { haversineMeters } from "../../../lib/reco/scoring";
import { getLLMSettings } from "../../../lib/settings/llm";
import { isAllowedModel } from "../../../lib/agent/model";
import type {
  ChatResponse,
  RecommendationCardData,
} from "../../../lib/types/chat";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

type ChatRequestBody = {
  anonId: string;
  sessionId?: string;
  location?: { lat: number; lng: number };
  locationText?: string;
  neighborhood?: string;
  message: string;
  latitude?: number | null;
  longitude?: number | null;
  radius_m?: number | null;
  locationEnabled?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isAbortError = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

type Attempt = {
  radius: number;
  endpoint: string;
  resultsCount: number;
  keyword: string | undefined;
  googleStatus: string | undefined;
};

type LegacyChatStatus = "OK" | "NO_RESULTS" | "ERROR" | "fallback";

type ToolDebugInfo = {
  endpointUsed?: string;
  provider?: string;
  googleStatus?: string;
  error_message?: string;
  attempts?: Attempt[];
};

const coerceNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const coerceString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const sanitizeAttempts = (raw: unknown): Attempt[] | undefined => {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const attempts = raw
    .filter(isRecord)
    .map((attempt) => {
      const radius = coerceNumber(attempt.radius);
      const resultsCount = coerceNumber(attempt.resultsCount);
      const endpoint = coerceString(attempt.endpoint);
      if (!endpoint || radius === undefined || resultsCount === undefined) {
        return undefined;
      }
      const keyword = coerceString(attempt.keyword);
      const googleStatus = coerceString(attempt.googleStatus);
      return {
        radius,
        endpoint,
        resultsCount,
        keyword,
        googleStatus,
      };
    })
    .filter((attempt): attempt is Attempt => attempt !== null);
  return attempts.length > 0 ? attempts : undefined;
};

const parseChatRequestBody = (payload: unknown): ChatRequestBody | null => {
  if (!isRecord(payload)) {
    return null;
  }
  const anonId = typeof payload.anonId === "string" ? payload.anonId : "";
  const sessionId =
    typeof payload.sessionId === "string" && payload.sessionId.trim().length > 0
      ? payload.sessionId
      : undefined;
  const message = typeof payload.message === "string" ? payload.message : "";
  if (!anonId || !message) {
    return null;
  }
  const location =
    isRecord(payload.location) &&
    typeof payload.location.lat === "number" &&
    Number.isFinite(payload.location.lat) &&
    typeof payload.location.lng === "number" &&
    Number.isFinite(payload.location.lng)
      ? { lat: payload.location.lat, lng: payload.location.lng }
      : undefined;
  const latitude =
    typeof payload.latitude === "number" && Number.isFinite(payload.latitude)
      ? payload.latitude
      : null;
  const longitude =
    typeof payload.longitude === "number" && Number.isFinite(payload.longitude)
      ? payload.longitude
      : null;
  const radius_m =
    typeof payload.radius_m === "number" && Number.isFinite(payload.radius_m)
      ? payload.radius_m
      : null;
  const locationText =
    typeof payload.locationText === "string" ? payload.locationText : undefined;
  const neighborhood =
    typeof payload.neighborhood === "string" ? payload.neighborhood : undefined;
  const locationEnabled =
    typeof payload.locationEnabled === "boolean" ? payload.locationEnabled : undefined;
  return {
    anonId,
    sessionId,
    message,
    location,
    locationText,
    neighborhood,
    latitude,
    longitude,
    radius_m,
    locationEnabled,
  };
};

const buildToolDebug = (
  toolDebug?: Record<string, unknown>,
): ToolDebugInfo | undefined => {
  if (!toolDebug) {
    return undefined;
  }
  const tool = toolDebug.tool;
  if (!isRecord(tool)) {
    return undefined;
  }
  const attempts = sanitizeAttempts(tool.attempts);
  return {
    endpointUsed: typeof tool.endpointUsed === "string" ? tool.endpointUsed : undefined,
    provider: typeof tool.provider === "string" ? tool.provider : undefined,
    googleStatus: typeof tool.googleStatus === "string" ? tool.googleStatus : undefined,
    error_message: typeof tool.error_message === "string" ? tool.error_message : undefined,
    attempts,
  };
};

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

const normalizeChatStatus = (
  status?: LegacyChatStatus,
): ChatResponse["status"] => {
  if (status === "ERROR" || status === "fallback") {
    return "error";
  }
  return "ok";
};

const sanitizeMessage = (message: string | null | undefined, fallback: string) => {
  if (!message) {
    return fallback;
  }
  const trimmed = message.trim();
  if (!trimmed) {
    return fallback;
  }
  const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  const looksLikeStack =
    /traceback|stack trace|stacktrace/i.test(trimmed) || /\n\s*at\s+\S+\s*\(/.test(trimmed);
  if (looksLikeJson || looksLikeStack) {
    return fallback;
  }
  return trimmed;
};

const buildChatResponse = ({
  status,
  message,
  places,
  sessionId,
  nextPageToken,
}: {
  status: ChatResponse["status"];
  message: string;
  places: RecommendationCardData[];
  sessionId?: string;
  nextPageToken?: string;
}): ChatResponse => ({
  status,
  message,
  places,
  meta:
    sessionId || nextPageToken
      ? {
          sessionId,
          nextPageToken,
        }
      : undefined,
});

const buildAgentResponse = ({
  agentMessage,
  recommendations,
  status,
  requestId,
  errorMessage,
  debugEnabled,
  toolDebug,
  sessionId,
}: {
  agentMessage: string | null | undefined;
  recommendations: RecommendationCardData[];
  status?: LegacyChatStatus;
  requestId: string;
  errorMessage?: string;
  debugEnabled: boolean;
  toolDebug?: Record<string, unknown>;
  sessionId: string;
}): ChatResponse => {
  const hasRecommendations = recommendations.length > 0;
  const resolvedStatus = normalizeChatStatus(status ?? (hasRecommendations ? "OK" : "NO_RESULTS"));
  const baseMessage = hasRecommendations
    ? "Here are a few places you might like."
    : "Tell me a neighborhood or enable location so I can find nearby places.";
  const errorFallback = "Sorry, something went wrong while finding places.";
  const message = sanitizeMessage(
    agentMessage,
    resolvedStatus === "error" ? errorFallback : baseMessage,
  );
  if (debugEnabled && errorMessage) {
    const toolDebugInfo = isRecord(toolDebug) ? toolDebug : undefined;
    const toolInfo = buildToolDebug(toolDebugInfo);
    logger.info(
      {
        requestId,
        toolProvider: toolInfo?.provider,
        errorMessage,
      },
      "Agent tool debug summary",
    );
  }
  return buildChatResponse({
    status: resolvedStatus,
    message,
    places: recommendations,
    sessionId,
  });
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
        placesCount: payload.places?.length ?? 0,
      },
      "Returning ChatResponse",
    );
    return response;
  };
  const respondError = (status: number, message: string, sessionId?: string) => {
    const response = respondChat(
      status,
      buildChatResponse({
        status: "error",
        message,
        places: [],
        sessionId,
      }),
    );
    logger.info({ ...logContext, latencyMs: Date.now() - startTime }, "chat request complete");
    return response;
  };

  const body = parseChatRequestBody(await request.json());

  if (!body) {
    return respondError(400, "Invalid request.");
  }

  const sessionId = body.sessionId ?? randomUUID();

  if (body.message.length > 500) {
    return respondError(400, "Message too long.", sessionId);
  }

  const userIdHash = hashUserId(body.anonId);
  const locationText = body.neighborhood ?? body.locationText;
  const geoLocation = normalizeGeoLocation({
    coordinates: body.location,
    latitude: body.latitude ?? undefined,
    longitude: body.longitude ?? undefined,
    locationText,
  });
  const coords = getLocationCoords(geoLocation);
  const hasCoordinates = Boolean(coords);
  const eventLocation: GeoLocation =
    coords
      ? {
          kind: "coords",
          coords: { lat: roundCoord(coords.lat), lng: roundCoord(coords.lng) },
        }
      : geoLocation.kind === "text"
        ? geoLocation
        : { kind: "none" };
  const locationEnabled = Boolean(body.locationEnabled);
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

  if (locationEnabled && !coords) {
    return respondError(
      400,
      "Please share your location or set a neighborhood.",
      sessionId,
    );
  }

  const limiter = rateLimit(`chat:${userIdHash}`, 10, 60_000);
  if (!limiter.allowed) {
    const response = respondError(
      429,
      "Too many requests. Please wait a moment and try again.",
      sessionId,
    );
    response.headers.set(
      "Retry-After",
      Math.ceil((limiter.resetAt - Date.now()) / 1000).toString(),
    );
    return response;
  }

  let settings: Awaited<ReturnType<typeof getLLMSettings>> | undefined;
  let llmTimedOut = false;
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
      if (geoLocation.kind === "none") {
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
            requestId,
            debugEnabled,
            sessionId,
          }),
        );
      }

      logger.info(
        { ...logContext, path: "llm_agent", agentEnabled, llmModel, hasSystemPrompt, reason },
        "Routing chat to agent",
      );
      const agentStart = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25_000);
      let agentResult: Awaited<ReturnType<typeof runFoodBuddyAgent>> | null = null;
      try {
        agentResult = await runFoodBuddyAgent({
          userMessage: body.message,
          context: {
            location: geoLocation,
            radius_m,
            sessionId,
            requestId,
            userIdHash,
            channel,
            locale: locale ?? undefined,
            locationEnabled,
          },
          signal: controller.signal,
        });
      } catch (err) {
        if (isAbortError(err)) {
          llmTimedOut = true;
          reason = "llm_timeout";
          logger.info({ ...logContext, reason, requestId }, "LLM request timed out");
        } else {
          throw err;
        }
      } finally {
        clearTimeout(timeout);
      }

      if (agentResult) {
        const recommendations =
          agentResult.places && agentResult.places.length > 0
            ? agentResult.places
            : [agentResult.primary, ...(agentResult.alternatives ?? [])].filter(
                (item): item is RecommendationCardData => Boolean(item),
              );
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
        const toolInfo = buildToolDebug(
          isRecord(agentResult.toolDebug) ? agentResult.toolDebug : undefined,
        );
        if (toolInfo || agentResult.toolCallCount > 0) {
          logger.info(
            {
              requestId,
              tool: "recommend_places",
              returnedCount: resultCount,
              googleStatusIfAny: toolInfo?.googleStatus,
              errorIfAny: toolInfo?.error_message,
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
            requestId,
            errorMessage: agentResult.errorMessage,
            debugEnabled,
            toolDebug: agentResult.toolDebug,
            sessionId,
          }),
        );
      }
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

  const agentEnabled = settings?.llmEnabled === true;
  const llmModel = settings?.llmModel ?? null;

  if (!coords) {
    logger.info({ ...logContext, path: "fallback" }, "Missing location for chat");
    const message = "Please share a location so I can find nearby places.";
    const responseStatus = llmTimedOut ? "fallback" : "ERROR";
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
    return respondChat(
      200,
      buildChatResponse({
        status: normalizeChatStatus(responseStatus),
        message,
        places: [],
        sessionId,
      }),
    );
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
      location: coords,
      queryText: body.message,
      radiusMetersOverride: radiusMeters,
      requestId,
    });

    const payload = buildRecommendationPayload(recommendation, coords);
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
    const responseStatus = llmTimedOut ? "fallback" : status;

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

    if (providerErrorMessage) {
      logger.info(
        { ...logContext, provider: recommendationDebug?.tool?.provider },
        providerErrorMessage,
      );
    }

    return respondChat(
      200,
      buildChatResponse({
        status: normalizeChatStatus(responseStatus),
        message,
        places: payload,
        sessionId,
      }),
    );
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
    return respondChat(
      200,
      buildChatResponse({
        status: "error",
        message: "Sorry, something went wrong while finding places.",
        places: [],
        sessionId,
      }),
    );
  }
}

const truncateJson = (value: string, maxLength = 8000) =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

const roundCoord = (value: number) => Math.round(value * 100) / 100;
