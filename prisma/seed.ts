import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

if (process.env.NODE_ENV === "production") {
  console.warn("Skipping seed in production.");
  process.exit(0);
}

const samplePlaces = [
  {
    placeId: "sample_place_1",
    name: "Sunny Side Diner",
    address: "123 Market St",
    lat: 37.7749,
    lng: -122.4194,
    googleRating: 4.4,
    googleRatingsTotal: 128,
  },
  {
    placeId: "sample_place_2",
    name: "Mission Tacos",
    address: "456 Valencia St",
    lat: 37.7599,
    lng: -122.4212,
    googleRating: 4.6,
    googleRatingsTotal: 210,
  },
  {
    placeId: "sample_place_3",
    name: "Golden Gate Cafe",
    address: "789 Lombard St",
    lat: 37.8021,
    lng: -122.4187,
    googleRating: 4.1,
    googleRatingsTotal: 95,
  },
];

const sampleQueries = [
  {
    channel: "WEB" as const,
    userIdHash: "user_hash_1",
    userLat: 37.775,
    userLng: -122.419,
    queryText: "breakfast near me",
    recommendedPlaceIds: ["sample_place_1", "sample_place_2"],
    status: "OK" as const,
    latencyMs: 420,
    resultCount: 2,
    parsedConstraints: { radiusMeters: 1500, keyword: "breakfast", openNow: false },
  },
  {
    channel: "TELEGRAM" as const,
    userIdHash: "user_hash_2",
    userLat: 37.76,
    userLng: -122.421,
    queryText: "tacos open now",
    recommendedPlaceIds: ["sample_place_2"],
    status: "OK" as const,
    latencyMs: 310,
    resultCount: 1,
    parsedConstraints: { radiusMeters: 1500, keyword: "tacos", openNow: true },
  },
  {
    channel: "WEB" as const,
    userIdHash: "user_hash_3",
    userLat: 37.801,
    userLng: -122.418,
    queryText: "late night coffee",
    recommendedPlaceIds: [],
    status: "NO_RESULTS" as const,
    latencyMs: 290,
    resultCount: 0,
    parsedConstraints: { radiusMeters: 1500, keyword: "coffee", openNow: true },
  },
  {
    channel: "WEB" as const,
    userIdHash: "user_hash_4",
    userLat: 37.802,
    userLng: -122.419,
    queryText: "fancy dinner",
    recommendedPlaceIds: [],
    status: "ERROR" as const,
    latencyMs: 560,
    resultCount: 0,
    errorMessage: "Provider timeout",
    parsedConstraints: { radiusMeters: 1500, keyword: "dinner", openNow: false },
  },
];

const sampleFeedback = [
  {
    placeId: "sample_place_1",
    channel: "WEB" as const,
    userIdHash: "user_hash_1",
    rating: 5,
    commentText: "Great pancakes and quick service.",
    tags: ["cozy", "breakfast"],
    moderationStatus: "ACTIVE" as const,
  },
  {
    placeId: "sample_place_2",
    channel: "TELEGRAM" as const,
    userIdHash: "user_hash_2",
    rating: 4,
    commentText: "Loved the tacos, a bit crowded though.",
    tags: ["lively"],
    moderationStatus: "ACTIVE" as const,
  },
  {
    placeId: "sample_place_3",
    channel: "WEB" as const,
    userIdHash: "user_hash_3",
    rating: 2,
    commentText: "Service was slow.",
    tags: ["slow"],
    moderationStatus: "HIDDEN" as const,
  },
];

const llmDefaults = {
  id: "default",
  model: "gpt-5.2-mini",
  temperature: 0.3,
  maxTokens: 800,
  systemPrompt: `You are FoodBuddy, a helpful local food assistant.

Your responsibilities:
- Understand natural language food requests
- Ask for location if missing
- Use tools to find real nearby places
- Explain results conversationally

Rules:
- Do not hallucinate places
- Use tools for factual data
- Ask clarifying questions when needed`,
};

const recalculateAggregate = async (placeId: string) => {
  const feedback = await prisma.placeFeedback.findMany({
    where: { placeId, moderationStatus: "ACTIVE" },
    select: { rating: true, tags: true },
  });

  const ratingCount = feedback.length;
  const ratingTotal = feedback.reduce((sum, entry) => sum + entry.rating, 0);
  const averageRating = ratingCount > 0 ? ratingTotal / ratingCount : 0;
  const tagCounts: Record<string, number> = {};

  for (const entry of feedback) {
    if (Array.isArray(entry.tags)) {
      for (const tag of entry.tags) {
        if (typeof tag !== "string") {
          continue;
        }
        const key = tag.trim().toLowerCase();
        if (!key) {
          continue;
        }
        tagCounts[key] = (tagCounts[key] ?? 0) + 1;
      }
    }
  }

  await prisma.placeAggregate.upsert({
    where: { placeId },
    update: {
      communityRatingAvg: averageRating,
      communityRatingCount: ratingCount,
      tagCounts,
      lastUpdatedAt: new Date(),
    },
    create: {
      placeId,
      communityRatingAvg: averageRating,
      communityRatingCount: ratingCount,
      tagCounts,
      lastUpdatedAt: new Date(),
    },
  });
};

async function main() {
  await prisma.lLMSettings.upsert({
    where: { id: "default" },
    update: {
      model: llmDefaults.model,
      temperature: llmDefaults.temperature,
      maxTokens: llmDefaults.maxTokens,
      systemPrompt: llmDefaults.systemPrompt,
    },
    create: llmDefaults,
  });

  await Promise.all(
    samplePlaces.map((place) =>
      prisma.place.upsert({
        where: { placeId: place.placeId },
        update: {
          name: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          googleRating: place.googleRating,
          googleRatingsTotal: place.googleRatingsTotal,
        },
        create: {
          placeId: place.placeId,
          name: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          googleRating: place.googleRating,
          googleRatingsTotal: place.googleRatingsTotal,
        },
      }),
    ),
  );

  await Promise.all(
    sampleQueries.map((event) =>
      prisma.recommendationEvent.create({
        data: {
          channel: event.channel,
          userIdHash: event.userIdHash,
          userLat: event.userLat,
          userLng: event.userLng,
          queryText: event.queryText,
          recommendedPlaceIds: event.recommendedPlaceIds,
          status: event.status,
          latencyMs: event.latencyMs,
          errorMessage: event.errorMessage,
          resultCount: event.resultCount,
          parsedConstraints: event.parsedConstraints,
        },
      }),
    ),
  );

  await Promise.all(
    sampleFeedback.map((entry) =>
      prisma.placeFeedback.create({
        data: {
          placeId: entry.placeId,
          channel: entry.channel,
          userIdHash: entry.userIdHash,
          rating: entry.rating,
          commentText: entry.commentText,
          tags: entry.tags,
          moderationStatus: entry.moderationStatus,
        },
      }),
    ),
  );

  await Promise.all(samplePlaces.map((place) => recalculateAggregate(place.placeId)));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
