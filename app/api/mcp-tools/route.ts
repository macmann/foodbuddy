import { NextResponse } from "next/server";

import { logger } from "../../../lib/logger";
import { mcpCall } from "../../../lib/mcp/client";
import type { ListToolsResult } from "../../../lib/mcp/types";

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return new NextResponse("Not Found", { status: 404 });
  }

  const url = process.env.COMPOSIO_MCP_URL;
  const apiKey = process.env.COMPOSIO_API_KEY;

  if (!url || !apiKey) {
    return NextResponse.json(
      { error: "COMPOSIO_MCP_URL and COMPOSIO_API_KEY are required" },
      { status: 400 },
    );
  }

  try {
    const result = await mcpCall<ListToolsResult>({
      url,
      apiKey,
      method: "tools/list",
      params: {},
    });

    return NextResponse.json({
      tools: (result?.tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    });
  } catch (error) {
    logger.error({ error }, "Failed to list MCP tools");
    return NextResponse.json({ error: "Failed to list MCP tools" }, { status: 502 });
  }
}
