export type RecommendationCardData = {
  placeId: string;
  name: string;
  rating?: number;
  reviewCount?: number;
  distanceMeters?: number;
  openNow?: boolean;
  address?: string;
  mapsUrl?: string;
  rationale?: string;
};

export type AgentMeta = {
  source: "agent" | "internal";
  toolCallCount: number;
  llmModel?: string;
  fallbackUsed?: boolean;
  latencyMs?: number;
};

export type ChatResponse = {
  message: string;
  status: "OK" | "NO_RESULTS" | "ERROR";
  primary: RecommendationCardData | null;
  alternatives: RecommendationCardData[];
  places: RecommendationCardData[];
  meta: AgentMeta;
};
