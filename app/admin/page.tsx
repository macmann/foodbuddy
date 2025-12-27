import type { Channel } from "@prisma/client";
import DashboardFilters from "../../components/admin/DashboardFilters";
import { getDashboardStats, getFeedbackByDay, getQueriesByHour } from "../../lib/admin/data";

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

const buildHourlyBuckets = (from: Date, to: Date, data: { bucket: Date; count: number }[]) => {
  const buckets: { label: string; count: number }[] = [];
  const current = new Date(from);
  current.setMinutes(0, 0, 0);

  const map = new Map(data.map((item) => [new Date(item.bucket).getTime(), item.count]));
  while (current <= to) {
    const label = `${current.getHours().toString().padStart(2, "0")}:00`;
    const key = current.getTime();
    buckets.push({ label, count: map.get(key) ?? 0 });
    current.setHours(current.getHours() + 1);
  }

  return buckets;
};

const buildDailyBuckets = (from: Date, to: Date, data: { bucket: Date; count: number }[]) => {
  const buckets: { label: string; count: number }[] = [];
  const current = new Date(from);
  current.setHours(0, 0, 0, 0);

  const map = new Map(data.map((item) => [new Date(item.bucket).getTime(), item.count]));
  while (current <= to) {
    const label = current.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const key = current.getTime();
    buckets.push({ label, count: map.get(key) ?? 0 });
    current.setDate(current.getDate() + 1);
  }

  return buckets;
};

const ChartPanel = ({ title, data }: { title: string; data: { label: string; count: number }[] }) => {
  const max = Math.max(...data.map((item) => item.count), 1);
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        <span className="text-xs text-slate-500">Last {data.length} buckets</span>
      </div>
      <div className="mt-4 flex h-40 items-end gap-2">
        {data.map((point) => (
          <div key={point.label} className="flex flex-1 flex-col items-center gap-2">
            <div
              className="w-full rounded-md bg-emerald-400/60"
              style={{ height: `${(point.count / max) * 100}%` }}
            />
            <span className="text-[10px] text-slate-500">{point.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const rangeParam = parseParam(resolvedSearchParams.range) ?? "today";
  const channelParam = parseParam(resolvedSearchParams.channel) ?? "all";
  const channel = channelParam === "all" ? undefined : (channelParam as Channel);
  const { from, to } = getRange(rangeParam);

  const stats = await getDashboardStats({ from, to, channel });

  const queryRange = {
    from: new Date(Date.now() - 24 * 60 * 60 * 1000),
    to: new Date(),
  };
  const feedbackRange = {
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    to: new Date(),
  };

  const [queriesByHour, feedbackByDay] = await Promise.all([
    getQueriesByHour({ ...queryRange, channel }),
    getFeedbackByDay({ ...feedbackRange, channel }),
  ]);

  const hourlyBuckets = buildHourlyBuckets(queryRange.from, queryRange.to, queriesByHour);
  const dailyBuckets = buildDailyBuckets(feedbackRange.from, feedbackRange.to, feedbackByDay);

  const feedbackRate =
    stats.queryCount === 0 ? 0 : (stats.feedbackCount / stats.queryCount) * 100;
  const noResultsRate =
    stats.queryCount === 0 ? 0 : (stats.noResultCount / stats.queryCount) * 100;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-white">Dashboard</h2>
          <p className="text-sm text-slate-400">
            Monitor queries, feedback, and real-time activity.
          </p>
        </div>
        <DashboardFilters range={rangeParam} channel={channelParam} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Queries Today</p>
          <p className="mt-3 text-3xl font-semibold text-white">{stats.queryCount}</p>
          <p className="mt-2 text-sm text-slate-400">All recommendation requests</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Active Sessions</p>
          <p className="mt-3 text-3xl font-semibold text-white">{stats.activeSessions}</p>
          <p className="mt-2 text-sm text-slate-400">Distinct users in last 30 minutes</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Feedback Rate</p>
          <p className="mt-3 text-3xl font-semibold text-white">
            {feedbackRate.toFixed(1)}%
          </p>
          <p className="mt-2 text-sm text-slate-400">Feedback submissions / queries</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">No Results Rate</p>
          <p className="mt-3 text-3xl font-semibold text-white">
            {noResultsRate.toFixed(1)}%
          </p>
          <p className="mt-2 text-sm text-slate-400">Queries without recommendations</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartPanel title="Queries over last 24h" data={hourlyBuckets} />
        <ChartPanel title="Feedback over last 7d" data={dailyBuckets} />
      </div>
    </section>
  );
}
