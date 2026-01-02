CREATE TABLE IF NOT EXISTS "SearchSession" (
  "id" TEXT NOT NULL,
  "lastQuery" TEXT NOT NULL,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "radius" INTEGER NOT NULL,
  "nextPageToken" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SearchSession_pkey" PRIMARY KEY ("id")
);
