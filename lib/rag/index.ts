import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { logger } from "../logger";

const ENABLE_RAG = process.env.ENABLE_RAG === "true";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
const MAX_FEEDBACK_COMMENTS = 5;
const MAX_COMMENT_SNIPPET = 140;

type RagRow = {
  placeId: string;
  content: string;
};

const buildVectorLiteral = (vector: number[]) => `[${vector.join(",")}]`;

const extractMention = (content: string) => {
  const lines = content.split("\n");
  const feedbackIndex = lines.findIndex((line) => line.startsWith("Feedback:"));
  if (feedbackIndex === -1) {
    return null;
  }
  const commentLine = lines.slice(feedbackIndex + 1).find((line) => line.trim().startsWith("- "));
  if (!commentLine) {
    return null;
  }
  const snippet = commentLine.replace("- ", "").trim().slice(0, MAX_COMMENT_SNIPPET);
  return snippet.length > 0 ? snippet : null;
};

const embedText = async (text: string) => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required when ENABLE_RAG=true");
  }

  const response = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding request failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
  const embedding = data.data?.[0]?.embedding;
  if (!embedding) {
    throw new Error("Embedding response missing data");
  }

  return embedding;
};

export const upsertRagDocForPlace = async (placeId: string) => {
  if (!ENABLE_RAG) {
    return;
  }

  try {
    const [place, aggregate, feedback] = await Promise.all([
      prisma.place.findUnique({ where: { placeId } }),
      prisma.placeAggregate.findUnique({ where: { placeId } }),
      prisma.placeFeedback.findMany({
        where: { placeId, moderationStatus: "ACTIVE", commentText: { not: null } },
        orderBy: { createdAt: "desc" },
        take: MAX_FEEDBACK_COMMENTS,
      }),
    ]);

    if (!place) {
      return;
    }

    const contentParts = [
      `Place: ${place.name}`,
      place.address ? `Address: ${place.address}` : null,
      aggregate
        ? `Community rating: ${aggregate.communityRatingAvg.toFixed(2)} (${aggregate.communityRatingCount} ratings)`
        : null,
    ].filter(Boolean);

    if (aggregate?.tagCounts) {
      const tagCounts = aggregate.tagCounts as Record<string, number>;
      const topTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([tag]) => tag);
      if (topTags.length > 0) {
        contentParts.push(`Tags: ${topTags.join(", ")}`);
      }
    }

    if (feedback.length > 0) {
      contentParts.push("Feedback:");
      feedback.forEach((item) => {
        const snippet = item.commentText
          ? item.commentText.replace(/\s+/g, " ").slice(0, MAX_COMMENT_SNIPPET)
          : "";
        if (snippet) {
          contentParts.push(`- ${snippet}`);
        }
      });
    }

    const content = contentParts.join("\n");
    const embedding = await embedText(content);
    const vectorLiteral = buildVectorLiteral(embedding);

    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO "RagDocument" ("placeId", "content", "embedding", "updatedAt")
      VALUES (${placeId}, ${content}, ${vectorLiteral}::vector, NOW())
      ON CONFLICT ("placeId") DO UPDATE SET "content" = EXCLUDED."content", "embedding" = EXCLUDED."embedding", "updatedAt" = NOW()`,
    );
  } catch (error) {
    logger.error({ error, placeId }, "Failed to upsert RAG document");
  }
};

export const getRagEnrichmentForPlaces = async (
  placeIds: string[],
  queryText: string,
  topK = 3,
) => {
  const result = new Map<string, string>();
  if (!ENABLE_RAG || placeIds.length === 0) {
    return result;
  }

  try {
    const embedding = await embedText(queryText);
    const vectorLiteral = buildVectorLiteral(embedding);

    const rows = await prisma.$queryRaw<RagRow[]>(
      Prisma.sql`SELECT "placeId", "content"
        FROM "RagDocument"
        WHERE "placeId" = ANY(${placeIds})
        ORDER BY "embedding" <=> ${vectorLiteral}::vector
        LIMIT ${topK}`,
    );

    rows.forEach((row) => {
      const mention = extractMention(row.content);
      if (mention) {
        result.set(row.placeId, `Locals mention: ${mention}`);
      }
    });
  } catch (error) {
    logger.error({ error }, "Failed to fetch RAG enrichment");
  }

  return result;
};
