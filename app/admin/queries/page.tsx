import Link from "next/link";
import type { Channel, RecommendationStatus } from "@prisma/client";
import QueriesFilters from "../../../components/admin/QueriesFilters";
import { listQueries } from "../../../lib/admin/data";

type SearchParams = { [key: string]: string | string[] | undefined };

const parseParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const getRange = (range: string | undefined) => {
  const now = new Date();
  if (range === "7d") {
    return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to: now };
  }
  if (range === "30d") {
    return { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), to: now };
  }
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  return { from: startOfDay, to: now };
};

const formatLocation = (lat?: number | null, lng?: number | null) => {
  if (lat === null || lat === undefined || lng === null || lng === undefined) {
    return "N/A";
  }
  return `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
};

const statusStyles: Record<RecommendationStatus, string> = {
  OK: "bg-emerald-400/20 text-emerald-200",
  ERROR: "bg-red-400/20 text-red-200",
  NO_RESULTS: "bg-amber-400/20 text-amber-200",
};

export default async function AdminQueriesPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const rangeParam = parseParam(sp.range) ?? "today";
  const channelParam = parseParam(sp.channel) ?? "all";
  const statusParam = parseParam(sp.status) ?? "all";
  const qParam = parseParam(sp.q) ?? "";
  const errorsOnly = parseParam(sp.errors) === "1";
  const noResultsOnly = parseParam(sp.noResults) === "1";
  const page = Number.parseInt(parseParam(sp.page) ?? "1", 10) || 1;
  const pageSize = 50;

  const { from, to } = getRange(rangeParam);
  const channel = channelParam === "all" ? undefined : (channelParam as Channel);
  let status =
    statusParam === "all" ? undefined : (statusParam as RecommendationStatus);
  if (errorsOnly) {
    status = "ERROR";
  }
  if (noResultsOnly) {
    status = "NO_RESULTS";
  }

  const { items, total } = await listQueries({
    from,
    to,
    channel,
    status,
    q: qParam || undefined,
    page,
    pageSize,
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const buildPageLink = (nextPage: number) => {
    const params = new URLSearchParams();
    if (rangeParam !== "today") {
      params.set("range", rangeParam);
    }
    if (channelParam !== "all") {
      params.set("channel", channelParam);
    }
    if (statusParam !== "all") {
      params.set("status", statusParam);
    }
    if (qParam) {
      params.set("q", qParam);
    }
    if (errorsOnly) {
      params.set("errors", "1");
    }
    if (noResultsOnly) {
      params.set("noResults", "1");
    }
    params.set("page", nextPage.toString());
    return `/admin/queries?${params.toString()}`;
  };

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-white">Queries</h2>
        <p className="text-sm text-slate-400">
          Monitor recommendation events and investigate errors or no-result searches.
        </p>
      </div>

      <QueriesFilters
        range={rangeParam}
        channel={channelParam}
        status={statusParam}
        q={qParam}
        errorsOnly={errorsOnly}
        noResultsOnly={noResultsOnly}
      />

      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-slate-950/60 text-xs uppercase tracking-[0.2em] text-slate-500">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Channel</th>
              <th className="px-4 py-3">Query</th>
              <th className="px-4 py-3">Approx Location</th>
              <th className="px-4 py-3">Result Count</th>
              <th className="px-4 py-3">Primary Recommendation</th>
              <th className="px-4 py-3">Latency</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-slate-200">
            {items.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-slate-400" colSpan={9}>
                  No queries found for the selected filters.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-950/40">
                  <td className="px-4 py-3 text-slate-300">
                    {new Date(item.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">{item.channel}</td>
                  <td className="px-4 py-3">
                    <span className="line-clamp-2 max-w-xs text-slate-100">
                      {item.queryText}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {formatLocation(item.userLat, item.userLng)}
                  </td>
                  <td className="px-4 py-3">{item.resultCount ?? 0}</td>
                  <td className="px-4 py-3">
                    {item.primaryPlaceName ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {item.latencyMs ? `${item.latencyMs} ms` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyles[item.status]}`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      className="text-emerald-300 hover:text-emerald-200"
                      href={`/admin/queries/${item.id}`}
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-400">
        <span>
          Page {page} of {totalPages} · {total} results
        </span>
        <div className="flex gap-2">
          <Link
            href={buildPageLink(Math.max(1, page - 1))}
            aria-disabled={page === 1}
            className={`rounded-lg border px-3 py-1 ${
              page === 1
                ? "border-slate-800 text-slate-600"
                : "border-slate-700 text-slate-200 hover:border-emerald-300"
            }`}
          >
            Prev
          </Link>
          <Link
            href={buildPageLink(Math.min(totalPages, page + 1))}
            aria-disabled={page === totalPages}
            className={`rounded-lg border px-3 py-1 ${
              page === totalPages
                ? "border-slate-800 text-slate-600"
                : "border-slate-700 text-slate-200 hover:border-emerald-300"
            }`}
          >
            Next
          </Link>
        </div>
      </div>
    </section>
  );
}
