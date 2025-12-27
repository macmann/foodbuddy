import "server-only";

import { prisma } from "../db";
import { recalculatePlaceAggregate } from "../feedback";
import { Prisma } from "@prisma/client";
import type {
  Channel,
  ModerationStatus,
  PlaceAggregate,
  RecommendationStatus,
} from "@prisma/client";

type DateRange = {
  from?: Date;
  to?: Date;
};

type DashboardStatsParams = DateRange & {
  channel?: Channel;
};

type QueryFilters = DateRange & {
  channel?: Channel;
  status?: RecommendationStatus;
  q?: string;
  page: number;
  pageSize: number;
};

type PlaceFilters = {
  q?: string;
  minCommunityRating?: number;
  hasFeedback?: boolean;
  page: number;
  pageSize: number;
};

type FeedbackFilters = {
  status?: ModerationStatus;
  place?: string;
  q?: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
};

type FeedbackWithPlace = Prisma.PlaceFeedbackGetPayload<{
  include: { place: { select: { id: true; name: true } } };
}>;

type PlaceListItem = Omit<
  Prisma.PlaceGetPayload<{
    include: { aggregate: true; _count: { select: { feedback: true } } };
  }>,
  "aggregate"
> & {
  aggregate: (PlaceAggregate & { tagCounts?: unknown | null }) | null;
  lastRecommendedAt: Date | null;
};

const parseRecommendationIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
};

const buildDateRange = (filters: DateRange) => {
  if (!filters.from && !filters.to) {
    return undefined;
  }
  return {
    ...(filters.from ? { gte: filters.from } : {}),
    ...(filters.to ? { lte: filters.to } : {}),
  };
};

export const getDashboardStats = async ({ from, to, channel }: DashboardStatsParams) => {
  const createdAt = buildDateRange({ from, to });
  const baseWhere = {
    ...(channel ? { channel } : {}),
    ...(createdAt ? { createdAt } : {}),
  };

  const activeSessionSince = new Date(Date.now() - 30 * 60 * 1000);
  const activeSessionWhere = {
    ...(channel ? { channel } : {}),
    createdAt: { gte: activeSessionSince },
  };

  const [
    queryCount,
    noResultCount,
    errorCount,
    feedbackCount,
    placeCount,
    activeSessionRows,
  ] = await Promise.all([
    prisma.recommendationEvent.count({ where: baseWhere }),
    prisma.recommendationEvent.count({
      where: { ...baseWhere, status: "NO_RESULTS" },
    }),
    prisma.recommendationEvent.count({
      where: { ...baseWhere, status: "ERROR" },
    }),
    prisma.placeFeedback.count({ where: baseWhere }),
    prisma.place.count(),
    prisma.recommendationEvent.findMany({
      where: activeSessionWhere,
      distinct: ["userIdHash"],
      select: { userIdHash: true },
    }),
  ]);

  return {
    queryCount,
    noResultCount,
    errorCount,
    feedbackCount,
    placeCount,
    activeSessions: activeSessionRows.length,
  };
};

type BucketParams = {
  from: Date;
  to: Date;
  channel?: Channel;
};

export const getQueriesByHour = async ({ from, to, channel }: BucketParams) => {
  const channelFilter = channel
    ? Prisma.sql`AND "channel" = ${channel}`
    : Prisma.empty;

  return prisma.$queryRaw<{ bucket: Date; count: number }[]>`
    SELECT date_trunc('hour', "createdAt") AS bucket, COUNT(*)::int AS count
    FROM "RecommendationEvent"
    WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
    ${channelFilter}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;
};

export const getFeedbackByDay = async ({ from, to, channel }: BucketParams) => {
  const channelFilter = channel
    ? Prisma.sql`AND "channel" = ${channel}`
    : Prisma.empty;

  return prisma.$queryRaw<{ bucket: Date; count: number }[]>`
    SELECT date_trunc('day', "createdAt") AS bucket, COUNT(*)::int AS count
    FROM "PlaceFeedback"
    WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
    ${channelFilter}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;
};

export const listQueries = async ({
  from,
  to,
  channel,
  status,
  q,
  page,
  pageSize,
}: QueryFilters) => {
  const createdAt = buildDateRange({ from, to });
  const where = {
    ...(channel ? { channel } : {}),
    ...(status ? { status } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(q
      ? {
          OR: [
            { queryText: { contains: q, mode: Prisma.QueryMode.insensitive } },
            { userIdHash: { contains: q, mode: Prisma.QueryMode.insensitive } },
          ],
        }
      : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.recommendationEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.recommendationEvent.count({ where }),
  ]);

  const primaryIds = items
    .map((item) => parseRecommendationIds(item.recommendedPlaceIds)[0])
    .filter((id): id is string => Boolean(id));

  const places = await prisma.place.findMany({
    where: { placeId: { in: primaryIds } },
    select: { placeId: true, name: true },
  });
  const placeMap = new Map(places.map((place) => [place.placeId, place.name]));

  const enrichedItems = items.map((item) => {
    const primaryId = parseRecommendationIds(item.recommendedPlaceIds)[0];
    return {
      ...item,
      primaryPlaceName: primaryId ? placeMap.get(primaryId) ?? null : null,
    };
  });

  return { items: enrichedItems, total, page, pageSize };
};

export const getQueryDetail = async (eventId: string) =>
  prisma.recommendationEvent.findUnique({ where: { id: eventId } });

export const getQueryDetailWithPlaces = async (eventId: string) => {
  const event = await prisma.recommendationEvent.findUnique({ where: { id: eventId } });
  if (!event) {
    return null;
  }

  const recommendedPlaceIds = parseRecommendationIds(event.recommendedPlaceIds);
  const places = await prisma.place.findMany({
    where: { placeId: { in: recommendedPlaceIds } },
    include: { aggregate: true },
  });
  const placeMap = new Map(places.map((place) => [place.placeId, place]));

  const orderedPlaces = recommendedPlaceIds
    .map((placeId) => placeMap.get(placeId))
    .filter((place): place is NonNullable<typeof place> => Boolean(place));

  return { event, places: orderedPlaces, recommendedPlaceIds };
};

export const listPlaces = async ({
  q,
  minCommunityRating,
  hasFeedback,
  page,
  pageSize,
}: PlaceFilters): Promise<{
  items: PlaceListItem[];
  total: number;
  page: number;
  pageSize: number;
}> => {
  const where = {
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: Prisma.QueryMode.insensitive } },
            { address: { contains: q, mode: Prisma.QueryMode.insensitive } },
            { placeId: { contains: q, mode: Prisma.QueryMode.insensitive } },
          ],
        }
      : {}),
    ...(minCommunityRating !== undefined
      ? {
          aggregate: {
            communityRatingAvg: { gte: minCommunityRating },
          },
        }
      : {}),
    ...(hasFeedback === undefined
      ? {}
      : hasFeedback
        ? { feedback: { some: {} } }
        : { feedback: { none: {} } }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.place.findMany({
      where,
      include: { aggregate: true, _count: { select: { feedback: true } } },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.place.count({ where }),
  ]);

  const placeIds = items.map((item) => item.placeId);
  let lastRecommendedMap = new Map<string, Date | null>();
  const tagCountsByPlace = new Map<string, Record<string, number>>();

  if (placeIds.length > 0) {
    const feedbackEntries = await prisma.placeFeedback.findMany({
      where: { placeId: { in: placeIds } },
      select: { placeId: true, tags: true },
    });

    for (const entry of feedbackEntries) {
      if (!Array.isArray(entry.tags)) {
        continue;
      }
      for (const tag of entry.tags) {
        if (typeof tag !== "string") {
          continue;
        }
        const counts = tagCountsByPlace.get(entry.placeId) ?? {};
        counts[tag] = (counts[tag] ?? 0) + 1;
        tagCountsByPlace.set(entry.placeId, counts);
      }
    }
  }

  if (placeIds.length > 0) {
    const lastRecommended = await prisma.$queryRaw<
      { placeId: string; lastRecommendedAt: Date | null }[]
    >`
      SELECT pid AS "placeId", MAX("createdAt") AS "lastRecommendedAt"
      FROM "RecommendationEvent",
      LATERAL jsonb_array_elements_text("recommendedPlaceIds") AS pid
      WHERE pid IN (${Prisma.join(placeIds)})
      GROUP BY pid
    `;
    lastRecommendedMap = new Map(
      lastRecommended.map((entry) => [entry.placeId, entry.lastRecommendedAt]),
    );
  }

  const enrichedItems = items.map((item) => {
    const tagCounts = tagCountsByPlace.get(item.placeId) ?? null;

    return {
      ...item,
      aggregate: item.aggregate ? { ...item.aggregate, tagCounts } : null,
      lastRecommendedAt: lastRecommendedMap.get(item.placeId) ?? null,
    };
  });

  return { items: enrichedItems, total, page, pageSize };
};

export const getPlaceDetail = async (placeId: string) =>
  prisma.place.findUnique({
    where: { placeId },
    include: {
      aggregate: true,
      feedback: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

export const listFeedback = async ({
  status,
  place,
  q,
  from,
  to,
  page,
  pageSize,
}: FeedbackFilters) => {
  let placeIds: string[] | undefined;
  if (place) {
    const matches = await prisma.place.findMany({
      where: {
        OR: [
          { name: { contains: place, mode: "insensitive" } },
          { placeId: { contains: place, mode: "insensitive" } },
        ],
      },
      select: { placeId: true },
      take: 50,
    });
    placeIds = matches.map((match) => match.placeId);
    if (placeIds.length === 0) {
      return { items: [], total: 0, page, pageSize };
    }
  }

  const createdAt = buildDateRange({ from, to });
  const where: Prisma.PlaceFeedbackWhereInput = {
    ...(status ? { moderationStatus: status } : {}),
    ...(placeIds ? { placeId: { in: placeIds } } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(q
      ? {
          commentText: { contains: q, mode: Prisma.QueryMode.insensitive },
        }
      : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.placeFeedback.findMany({
      where,
      include: { place: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.placeFeedback.count({ where }),
  ]);

  return { items: items as FeedbackWithPlace[], total, page, pageSize };
};

export const getFeedbackDetailWithContext = async (feedbackId: string) => {
  const feedback = await prisma.placeFeedback.findUnique({
    where: { id: feedbackId },
    include: { place: true },
  });
  if (!feedback) {
    return null;
  }

  const lastRecommendation = await prisma.$queryRaw<
    {
      id: string;
      queryText: string;
      channel: string;
      createdAt: Date;
      status: string;
    }[]
  >`
    SELECT "id", "queryText", "channel", "createdAt", "status"
    FROM "RecommendationEvent",
    LATERAL jsonb_array_elements_text("recommendedPlaceIds") AS pid
    WHERE pid = ${feedback.placeId}
    ORDER BY "createdAt" DESC
    LIMIT 1
  `;

  return {
    feedback,
    lastRecommendation: lastRecommendation[0] ?? null,
  };
};

export const hideFeedback = async (feedbackId: string) =>
  prisma.$transaction(async (tx) => {
    const feedback = await tx.placeFeedback.update({
      where: { id: feedbackId },
      data: { moderationStatus: "HIDDEN" },
    });
    await recalculatePlaceAggregate(feedback.placeId, tx);
    return feedback;
  });

export const unhideFeedback = async (feedbackId: string) =>
  prisma.$transaction(async (tx) => {
    const feedback = await tx.placeFeedback.update({
      where: { id: feedbackId },
      data: { moderationStatus: "ACTIVE" },
    });
    await recalculatePlaceAggregate(feedback.placeId, tx);
    return feedback;
  });
