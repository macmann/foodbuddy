import { prisma } from "./db";
import type { Prisma } from "@prisma/client";

const MAX_COMMENT_LENGTH = 300;
const PROFANITY_WORDS = ["shit", "fuck", "bitch", "asshole", "bastard", "damn"];

export type RecordFeedbackInput = {
  placeId: string;
  channel: "WEB" | "TELEGRAM";
  userIdHash: string;
  rating: number;
  commentText?: string;
  tags?: string[];
};

export const commentContainsUrl = (comment: string | undefined) => {
  if (!comment) {
    return false;
  }
  return /https?:\/\//i.test(comment) || /www\./i.test(comment);
};

const sanitizeComment = (comment: string | undefined) => {
  if (!comment) {
    return undefined;
  }
  let cleaned = comment.trim().slice(0, MAX_COMMENT_LENGTH);
  for (const word of PROFANITY_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    cleaned = cleaned.replace(regex, "***");
  }
  return cleaned || undefined;
};

const normalizeTags = (tags: string[] | undefined) => {
  if (!tags) {
    return undefined;
  }
  const cleaned = tags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => tag.slice(0, 50));
  return cleaned.length > 0 ? cleaned : undefined;
};

type TransactionClient = Prisma.TransactionClient;
type DatabaseClient = TransactionClient | typeof prisma;

const normalizeTagValue = (value: string) => value.trim().slice(0, 50);

export const recalculatePlaceAggregate = async (
  placeId: string,
  tx: DatabaseClient = prisma,
) => {
  const feedback = await tx.placeFeedback.findMany({
    where: { placeId, moderationStatus: "ACTIVE" },
    select: { rating: true, tags: true },
  });

  const ratingCount = feedback.length;
  const ratingTotal = feedback.reduce((sum, entry) => sum + entry.rating, 0);
  const averageRating = ratingCount > 0 ? ratingTotal / ratingCount : 0;
  const tagCounts: Record<string, number> = {};

  for (const entry of feedback) {
    if (Array.isArray(entry.tags)) {
      for (const rawTag of entry.tags) {
        if (typeof rawTag !== "string") {
          continue;
        }
        const key = normalizeTagValue(rawTag).toLowerCase();
        if (!key) {
          continue;
        }
        tagCounts[key] = (tagCounts[key] ?? 0) + 1;
      }
    }
  }

  const aggregate = await tx.placeAggregate.findUnique({ where: { placeId } });

  if (aggregate) {
    await tx.placeAggregate.update({
      where: { placeId },
      data: {
        communityRatingAvg: averageRating,
        communityRatingCount: ratingCount,
        tagCounts,
        lastUpdatedAt: new Date(),
      },
    });
  } else {
    await tx.placeAggregate.create({
      data: {
        placeId,
        communityRatingAvg: averageRating,
        communityRatingCount: ratingCount,
        tagCounts,
        lastUpdatedAt: new Date(),
      },
    });
  }
};

export async function recordPlaceFeedback(input: RecordFeedbackInput) {
  const commentText = sanitizeComment(input.commentText);
  const tags = normalizeTags(input.tags);

  return prisma.$transaction(async (tx) => {
    await tx.placeFeedback.create({
      data: {
        placeId: input.placeId,
        channel: input.channel,
        userIdHash: input.userIdHash,
        rating: input.rating,
        commentText,
        tags: tags ?? undefined,
      },
    });

    await recalculatePlaceAggregate(input.placeId, tx);

    return { ok: true };
  });
}
