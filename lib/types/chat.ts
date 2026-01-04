import { z } from "zod";

export type RecommendationCardData = {
  placeId: string;
  name: string;
  rating?: number;
  reviewCount?: number;
  priceLevel?: number;
  lat?: number;
  lng?: number;
  distanceMeters?: number;
  openNow?: boolean;
  address?: string;
  mapsUrl?: string;
  rationale?: string;
  whyLine?: string;
  tryLine?: string;
  types?: string[];
};

export type Place = RecommendationCardData;

export type ChatResponseMeta = {
  mode: "search" | "place_followup" | "refine" | "needs_location" | "smalltalk";
  suggestedPrompts?: string[];
  followups?: { label: string; action: "refine" | "place_details" | "search"; payload?: any }[];
  sessionId?: string;
  nextPageToken?: string;
  needs_location?: boolean;
};

export type ChatResponse = {
  status: "ok" | "error";
  message: string;
  places: Place[];
  meta: ChatResponseMeta;
};

export const RecommendationCardSchema = z.object({
  placeId: z.string(),
  name: z.string(),
  rating: z.number().optional(),
  reviewCount: z.number().optional(),
  priceLevel: z.number().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  distanceMeters: z.number().optional(),
  openNow: z.boolean().optional(),
  address: z.string().optional(),
  mapsUrl: z.string().optional(),
  rationale: z.string().optional(),
  whyLine: z.string().optional(),
  tryLine: z.string().optional(),
  types: z.array(z.string()).optional(),
});

export const ChatResponseSchema = z.object({
  status: z.enum(["ok", "error"]),
  message: z.string(),
  places: z.array(RecommendationCardSchema),
  meta: z
    .object({
      mode: z.enum(["search", "place_followup", "refine", "needs_location", "smalltalk"]),
      suggestedPrompts: z.array(z.string()).optional(),
      followups: z
        .array(
          z.object({
            label: z.string(),
            action: z.enum(["refine", "place_details", "search"]),
            payload: z.record(z.unknown()).optional(),
          }),
        )
        .optional(),
      sessionId: z.string().optional(),
      nextPageToken: z.string().optional(),
      needs_location: z.boolean().optional(),
    })
    .passthrough(),
});
