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

const envSchema = z
  .object({
    ANON_ID_SALT: z.string().min(1, "ANON_ID_SALT is required"),
    ENABLE_TELEGRAM: z.preprocess(toBoolean, z.boolean()).default(false),
    ENABLE_RAG: z.preprocess(toBoolean, z.boolean()).default(false),
    GOOGLE_PROVIDER: z.enum(["API", "MCP"]),
    GOOGLE_MAPS_API_KEY: z.string().optional(),
    COMPOSIO_MCP_URL: z.string().url().optional(),
    COMPOSIO_API_KEY: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.GOOGLE_PROVIDER === "API" && !values.GOOGLE_MAPS_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "GOOGLE_MAPS_API_KEY is required when GOOGLE_PROVIDER=API",
        path: ["GOOGLE_MAPS_API_KEY"],
      });
    }

    if (values.GOOGLE_PROVIDER === "MCP" && !values.COMPOSIO_MCP_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "COMPOSIO_MCP_URL is required when GOOGLE_PROVIDER=MCP",
        path: ["COMPOSIO_MCP_URL"],
      });
    }

    if (values.GOOGLE_PROVIDER === "MCP" && !values.COMPOSIO_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "COMPOSIO_API_KEY is required when GOOGLE_PROVIDER=MCP",
        path: ["COMPOSIO_API_KEY"],
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export const config = envSchema.parse({
  ANON_ID_SALT: process.env.ANON_ID_SALT,
  ENABLE_TELEGRAM: process.env.ENABLE_TELEGRAM,
  ENABLE_RAG: process.env.ENABLE_RAG,
  GOOGLE_PROVIDER: process.env.GOOGLE_PROVIDER,
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
  COMPOSIO_MCP_URL: process.env.COMPOSIO_MCP_URL,
  COMPOSIO_API_KEY: process.env.COMPOSIO_API_KEY,
});
