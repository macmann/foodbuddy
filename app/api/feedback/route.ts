import { NextResponse } from "next/server";
import { z } from "zod";
import { hashUserId } from "../../../lib/hash";
import { commentContainsUrl, recordPlaceFeedback } from "../../../lib/feedback";
import { logger } from "../../../lib/logger";
import { createRequestContext } from "../../../lib/request";
import { rateLimit } from "../../../lib/rateLimit";

const feedbackSchema = z.object({
  anonId: z.string().min(1),
  channel: z.enum(["WEB"]).default("WEB"),
  placeId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  commentText: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
});

export async function POST(request: Request) {
  const { requestId, startTime } = createRequestContext(request);
  const channel = "WEB";
  const logContext = { requestId, channel };
  const respond = (status: number, payload: Record<string, unknown>) => {
    const response = NextResponse.json(payload, { status });
    response.headers.set("x-request-id", requestId);
    logger.info({ ...logContext, latencyMs: Date.now() - startTime }, "feedback request complete");
    return response;
  };

  const body = await request.json();
  const parsed = feedbackSchema.safeParse(body);

  if (!parsed.success) {
    return respond(400, { error: "Invalid request" });
  }

  const { anonId, channel, placeId, rating } = parsed.data;
  const commentText = parsed.data.commentText;
  const tags = parsed.data.tags;

  if (commentContainsUrl(commentText)) {
    return respond(400, { error: "Comments cannot include links" });
  }

  try {
    const userIdHash = hashUserId(anonId);
    const limiter = rateLimit(`feedback:${userIdHash}`, 10, 60_000);
    if (!limiter.allowed) {
      const response = respond(429, { error: "Rate limit exceeded" });
      response.headers.set(
        "Retry-After",
        Math.ceil((limiter.resetAt - Date.now()) / 1000).toString(),
      );
      return response;
    }

    const feedback = await recordPlaceFeedback({
      placeId,
      channel,
      userIdHash,
      rating,
      commentText,
      tags,
    });

    return respond(200, feedback);
  } catch (error) {
    return respond(500, { error: "Failed to store feedback" });
  }
}
