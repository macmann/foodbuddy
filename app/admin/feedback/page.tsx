import Link from "next/link";
import type { ModerationStatus } from "@prisma/client";
import FeedbackActions from "../../../components/admin/FeedbackActions";
import FeedbackFilters from "../../../components/admin/FeedbackFilters";
import { listFeedback } from "../../../lib/admin/data";

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

const statusStyles: Record<ModerationStatus, string> = {
  ACTIVE: "bg-emerald-400/20 text-emerald-200",
  HIDDEN: "bg-slate-400/20 text-slate-200",
};

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const statusParam = parseParam(sp.status) ?? "all";
  const placeParam = parseParam(sp.place) ?? "";
  const qParam = parseParam(sp.q) ?? "";
  const rangeParam = parseParam(sp.range) ?? "today";
  const page = Number.parseInt(parseParam(sp.page) ?? "1", 10) || 1;
  const pageSize = 50;

  const { from, to } = getRange(rangeParam);
  const status =
    statusParam === "all" ? undefined : (statusParam as ModerationStatus);

  const { items, total } = await listFeedback({
    status,
    place: placeParam || undefined,
    q: qParam || undefined,
    from,
    to,
    page,
    pageSize,
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const buildPageLink = (nextPage: number) => {
    const params = new URLSearchParams();
    if (statusParam !== "all") {
      params.set("status", statusParam);
    }
    if (placeParam) {
      params.set("place", placeParam);
    }
    if (qParam) {
      params.set("q", qParam);
    }
    if (rangeParam !== "today") {
      params.set("range", rangeParam);
    }
    params.set("page", nextPage.toString());
    return `/admin/feedback?${params.toString()}`;
  };

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-white">Feedback</h2>
        <p className="text-sm text-slate-400">
          Review user feedback and moderate comments before they surface.
        </p>
      </div>

      <FeedbackFilters status={statusParam} place={placeParam} q={qParam} range={rangeParam} />

      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-slate-950/60 text-xs uppercase tracking-[0.2em] text-slate-500">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Place</th>
              <th className="px-4 py-3">Rating</th>
              <th className="px-4 py-3">Comment</th>
              <th className="px-4 py-3">Tags</th>
              <th className="px-4 py-3">Channel</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-slate-200">
            {items.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-slate-400" colSpan={8}>
                  No feedback matches the selected filters.
                </td>
              </tr>
            ) : (
              items.map((feedback) => {
                const tags: string[] = Array.isArray(feedback.tags)
                  ? (feedback.tags as unknown[]).filter(
                      (t): t is string => typeof t === "string"
                    )
                  : [];

                return (
                  <tr key={feedback.id} className="hover:bg-slate-950/40">
                    <td className="px-4 py-3 text-slate-300">
                      {new Date(feedback.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {feedback.place.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {feedback.placeId}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3">{feedback.rating}★</td>
                    <td className="px-4 py-3">
                      <span className="line-clamp-2 max-w-xs text-slate-100">
                        {feedback.commentText ?? "No comment"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {tags.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-200"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{feedback.channel}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyles[feedback.moderationStatus as ModerationStatus]}`}
                      >
                        {feedback.moderationStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FeedbackActions
                          feedbackId={feedback.id}
                          status={feedback.moderationStatus}
                        />
                        <Link
                          href={`/admin/feedback/${feedback.id}`}
                          className="text-xs text-emerald-300 hover:text-emerald-200"
                        >
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })
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
