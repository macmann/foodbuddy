-- CreateTable
CREATE TABLE "LLMSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "model" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "maxTokens" INTEGER NOT NULL DEFAULT 800,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LLMSettings_pkey" PRIMARY KEY ("id")
);
