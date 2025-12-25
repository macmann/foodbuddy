import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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

async function main() {
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
    samplePlaces.map((place, index) =>
      prisma.placeAggregate.upsert({
        where: { placeId: place.placeId },
        update: {
          communityRatingAvg: 4.2 + index * 0.1,
          communityRatingCount: 5 + index * 2,
          tagCounts: { cozy: 2 + index, quick: 1 + index },
          lastUpdatedAt: new Date(),
        },
        create: {
          placeId: place.placeId,
          communityRatingAvg: 4.2 + index * 0.1,
          communityRatingCount: 5 + index * 2,
          tagCounts: { cozy: 2 + index, quick: 1 + index },
          lastUpdatedAt: new Date(),
        },
      }),
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
