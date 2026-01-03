import { extractPlacesFromMcpResult } from "../../../lib/mcp/placesExtractor";

export type McpPlacesExtractor = typeof extractPlacesFromMcpResult;

let extractPlacesFromMcpImpl: McpPlacesExtractor = extractPlacesFromMcpResult;

export const extractPlacesFromMcp = (payload: unknown) =>
  extractPlacesFromMcpImpl(payload);

export const setExtractPlacesFromMcpResult = (extractor: McpPlacesExtractor) => {
  extractPlacesFromMcpImpl = extractor;
};

export const resetExtractPlacesFromMcpResult = () => {
  extractPlacesFromMcpImpl = extractPlacesFromMcpResult;
};
