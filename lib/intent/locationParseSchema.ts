import { z } from "zod";

export const locationParseSchema = z
  .object({
    intent: z.enum(["nearby_search", "text_search", "no_location_needed", "clarify"]),
    query: z.string().min(1),
    location_text: z.string().min(1).optional().nullable(),
    use_device_location: z.boolean(),
    radius_m: z.number().positive().optional().default(1500),
    place_types: z.array(z.string()).min(1),
    confidence: z.number().min(0).max(1),
    warnings: z.array(z.string()).optional(),
  })
  .strict();

export type LocationParse = z.infer<typeof locationParseSchema>;
