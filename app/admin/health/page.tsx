import { getSystemHealth } from "../../../lib/admin/health";

const formatDate = (value: Date | null) => (value ? value.toLocaleString() : "Never");

export default async function AdminHealthPage() {
  const health = await getSystemHealth();

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-white">System health</h2>
        <p className="text-sm text-slate-400">
          Monitor database connectivity, MCP tools, and recent recommendation errors.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Database</p>
          <p className="mt-3 text-lg font-semibold text-white">
            {health.db.ok ? "Connected" : "Unavailable"}
          </p>
          <p className="mt-2 text-sm text-slate-400">
            {health.db.ok ? `Latency ${health.db.latencyMs} ms` : "Check DATABASE_URL"}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">MCP tools</p>
          <p className="mt-3 text-lg font-semibold text-white">
            {health.mcp.ok ? `${health.mcp.toolCount} tools` : "Unavailable"}
          </p>
          <p className="mt-2 text-sm text-slate-400">
            Last success: {formatDate(health.mcp.lastSuccessAt)}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Errors (24h)</p>
          <p className="mt-3 text-3xl font-semibold text-white">
            {health.recentErrorCount}
          </p>
          <p className="mt-2 text-sm text-slate-400">Recommendation failures</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="text-sm font-semibold text-slate-200">MCP tool list</h3>
          <div className="mt-4 flex flex-wrap gap-2">
            {health.mcp.toolNames.length === 0 ? (
              <span className="text-sm text-slate-500">No MCP tools available.</span>
            ) : (
              health.mcp.toolNames.map((tool) => (
                <span
                  key={tool}
                  className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-200"
                >
                  {tool}
                </span>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="text-sm font-semibold text-slate-200">Top errors</h3>
          <div className="mt-4 space-y-3 text-sm text-slate-300">
            {health.topErrors.length === 0 ? (
              <p className="text-slate-500">No errors recorded in the last 24 hours.</p>
            ) : (
              health.topErrors.map((error) => (
                <div key={error.message} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <p className="text-sm text-white">{error.message}</p>
                  <p className="mt-1 text-xs text-slate-500">{error.count} occurrences</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
