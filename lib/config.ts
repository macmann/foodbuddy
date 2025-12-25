import { z } from "zod";

const toBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value === "true" || value === "1";
  }

  return false;
};

const envSchema = z.object({
  ANON_ID_SALT: z.string().min(1, "ANON_ID_SALT is required"),
  ENABLE_TELEGRAM: z.preprocess(toBoolean, z.boolean()).default(false),
  ENABLE_RAG: z.preprocess(toBoolean, z.boolean()).default(false),
  GOOGLE_PROVIDER: z.enum(["API", "MCP"]),
});

export type AppConfig = z.infer<typeof envSchema>;

export const config = envSchema.parse({
  ANON_ID_SALT: process.env.ANON_ID_SALT,
  ENABLE_TELEGRAM: process.env.ENABLE_TELEGRAM,
  ENABLE_RAG: process.env.ENABLE_RAG,
  GOOGLE_PROVIDER: process.env.GOOGLE_PROVIDER,
});
