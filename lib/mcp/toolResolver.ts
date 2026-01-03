import type { ToolDefinition } from "./types";

export type ResolvedMcpTools = {
  geocode?: ToolDefinition;
  nearbySearch?: ToolDefinition;
  textSearch?: ToolDefinition;
  placeDetails?: ToolDefinition;
};

const findToolByKeywords = (
  tools: ToolDefinition[],
  keywordSets: string[][],
): ToolDefinition | undefined => {
  for (const keywords of keywordSets) {
    const match = tools.find((tool) => {
      const name = tool.name.toLowerCase();
      return keywords.every((keyword) => name.includes(keyword));
    });
    if (match) {
      return match;
    }
  }
  return undefined;
};

export const resolveMcpTools = (tools: ToolDefinition[]): ResolvedMcpTools => {
  const geocode =
    findToolByKeywords(tools, [["geocode"], ["geo"]]) ??
    tools.find((tool) => tool.name.toLowerCase().includes("geocode"));

  const nearbySearch = findToolByKeywords(tools, [
    ["nearby", "search"],
    ["places", "nearby"],
    ["maps", "places", "search"],
    ["maps", "search"],
  ]);

  const textSearch = findToolByKeywords(tools, [
    ["text", "search"],
    ["find", "place"],
    ["places", "search"],
  ]);

  const placeDetails =
    findToolByKeywords(tools, [["place", "details"], ["details", "place"]]) ??
    tools.find((tool) => tool.name.toLowerCase().includes("details"));

  return { geocode, nearbySearch, textSearch, placeDetails };
};

export const selectSearchTool = (
  tools: ResolvedMcpTools,
  { hasCoordinates }: { hasCoordinates: boolean },
): { tool: ToolDefinition | null; strategy: "nearby" | "text" | null } => {
  if (hasCoordinates && tools.nearbySearch) {
    return { tool: tools.nearbySearch, strategy: "nearby" };
  }
  if (!hasCoordinates && tools.textSearch) {
    return { tool: tools.textSearch, strategy: "text" };
  }
  if (!hasCoordinates && tools.nearbySearch) {
    return { tool: tools.nearbySearch, strategy: "nearby" };
  }
  return { tool: null, strategy: null };
};
