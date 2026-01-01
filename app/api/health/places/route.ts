import { NextResponse } from "next/server";

import { listMcpTools } from "../../../../lib/mcp/client";
import { createRequestContext } from "../../../../lib/request";
import { resolvePlacesProvider } from "../../../../lib/places";

export const GET = async (request: Request) => {
  const { requestId } = createRequestContext(request);
  const selection = resolvePlacesProvider();

  if (selection.providerName === "MCP") {
    const url = (process.env.COMPOSIO_MCP_URL ?? "").trim();
    const apiKey = process.env.COMPOSIO_API_KEY ?? "";
    try {
      const tools = await listMcpTools({ url, apiKey, requestId });
      return NextResponse.json(
        {
          ok: true,
          provider: "MCP",
          toolCount: tools.length,
          tools: tools.map((tool) => tool.name),
        },
        { status: 200 },
      );
    } catch (err) {
      return NextResponse.json(
        {
          ok: false,
          provider: "MCP",
          error: err instanceof Error ? err.message : "MCP tools list failed",
        },
        { status: 503 },
      );
    }
  }

  if (selection.providerName === "GOOGLE") {
    return NextResponse.json({ ok: true, provider: "GOOGLE" }, { status: 200 });
  }

  return NextResponse.json(
    {
      ok: false,
      provider: "NONE",
      error: selection.reason ?? "Places provider unavailable.",
    },
    { status: 503 },
  );
};
