import "server-only";

import { prisma } from "../db";
import { mcpCall } from "../mcp/client";
import type { ListToolsResult } from "../mcp/types";

let lastMcpSuccessAt: Date | null = null;

const sanitizeToolName = (name: string) => name.replace(/[^a-zA-Z0-9:_-]/g, "");

const getMcpStatus = async () => {
  const url = process.env.COMPOSIO_MCP_URL;
  const apiKey = process.env.COMPOSIO_API_KEY;

  if (!url || !apiKey) {
    return {
      ok: false,
      toolCount: 0,
      toolNames: [],
      lastSuccessAt: lastMcpSuccessAt,
    };
  }

  try {
    const result = await mcpCall<ListToolsResult>({
      url,
      apiKey,
      method: "tools/list",
      params: {},
    });

    const toolNames = (result?.tools ?? [])
      .map((tool) => sanitizeToolName(tool.name))
      .filter(Boolean);

    lastMcpSuccessAt = new Date();

    return {
      ok: true,
      toolCount: toolNames.length,
      toolNames,
      lastSuccessAt: lastMcpSuccessAt,
    };
  } catch {
    return {
      ok: false,
      toolCount: 0,
      toolNames: [],
      lastSuccessAt: lastMcpSuccessAt,
    };
  }
};

const getDatabaseStatus = async () => {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
};

const getErrorSummary = async () => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    const [recentErrorCount, grouped] = await Promise.all([
      prisma.recommendationEvent.count({
        where: { status: "ERROR", createdAt: { gte: since } },
      }),
      prisma.recommendationEvent.groupBy({
        by: ["errorMessage"],
        where: { status: "ERROR", createdAt: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { _all: "desc" } },
        take: 5,
      }),
    ]);

    const topErrors = grouped.map((entry) => ({
      message: entry.errorMessage ?? "Unknown error",
      count: entry._count._all,
    }));

    return { recentErrorCount, topErrors };
  } catch {
    return { recentErrorCount: 0, topErrors: [] as { message: string; count: number }[] };
  }
};

export const getSystemHealth = async () => {
  const [db, mcp, errorSummary] = await Promise.all([
    getDatabaseStatus(),
    getMcpStatus(),
    getErrorSummary(),
  ]);

  return {
    db,
    mcp,
    recentErrorCount: errorSummary.recentErrorCount,
    topErrors: errorSummary.topErrors,
  };
};
