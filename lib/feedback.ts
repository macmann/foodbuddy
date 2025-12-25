import { prisma } from "./db";

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

export async function recordPlaceFeedback(input: RecordFeedbackInput) {
  const commentText = sanitizeComment(input.commentText);
  const tags = normalizeTags(input.tags);

  return prisma.$transaction(async (tx) => {
    const aggregate = await tx.placeAggregate.findUnique({
      where: { placeId: input.placeId },
    });
    const currentCount = aggregate?.communityRatingCount ?? 0;
    const currentAvg = aggregate?.communityRatingAvg ?? 0;
    const nextCount = currentCount + 1;
    const nextAvg = (currentAvg * currentCount + input.rating) / nextCount;
    const existingTagCounts =
      (aggregate?.tagCounts as Record<string, number> | null) ?? {};
    const updatedTagCounts: Record<string, number> = { ...existingTagCounts };

    if (tags) {
      for (const tag of tags) {
        const key = tag.toLowerCase();
        updatedTagCounts[key] = (updatedTagCounts[key] ?? 0) + 1;
      }
    }

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

    if (aggregate) {
      await tx.placeAggregate.update({
        where: { placeId: input.placeId },
        data: {
          communityRatingAvg: nextAvg,
          communityRatingCount: nextCount,
          tagCounts: updatedTagCounts,
          lastUpdatedAt: new Date(),
        },
      });
    } else {
      await tx.placeAggregate.create({
        data: {
          placeId: input.placeId,
          communityRatingAvg: nextAvg,
          communityRatingCount: nextCount,
          tagCounts: updatedTagCounts,
          lastUpdatedAt: new Date(),
        },
      });
    }

    return { ok: true };
  });
}
