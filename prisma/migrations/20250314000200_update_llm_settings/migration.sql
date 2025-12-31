ALTER TABLE "LLMSettings" RENAME COLUMN "model" TO "llmModel";
ALTER TABLE "LLMSettings" RENAME COLUMN "systemPrompt" TO "llmSystemPrompt";

ALTER TABLE "LLMSettings" ALTER COLUMN "llmSystemPrompt" TYPE TEXT;
ALTER TABLE "LLMSettings" ALTER COLUMN "llmModel" SET DEFAULT 'gpt-5-mini';

ALTER TABLE "LLMSettings"
  ADD COLUMN "llmEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "llmProvider" TEXT NOT NULL DEFAULT 'openai',
  ADD COLUMN "reasoningEffort" TEXT NOT NULL DEFAULT 'medium',
  ADD COLUMN "verbosity" TEXT NOT NULL DEFAULT 'medium';

ALTER TABLE "LLMSettings" DROP COLUMN "temperature";
ALTER TABLE "LLMSettings" DROP COLUMN "maxTokens";
