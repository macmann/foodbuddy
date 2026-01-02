-- Create SearchSession table for persisted search state
CREATE TABLE IF NOT EXISTS "SearchSession" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "channel" TEXT,
  "pendingAction" TEXT,
  "pendingKeyword" TEXT,
  "lastLat" DOUBLE PRECISION,
  "lastLng" DOUBLE PRECISION,
  "lastRadiusM" INTEGER,
  "lastQuery" TEXT,
  "nextPageToken" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SearchSession_pkey" PRIMARY KEY ("id")
);

-- Enforce unique sessionId lookup used by the API
CREATE UNIQUE INDEX IF NOT EXISTS "SearchSession_sessionId_key" ON "SearchSession"("sessionId");
