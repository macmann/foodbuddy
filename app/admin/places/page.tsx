import Link from "next/link";
import PlacesFilters from "../../../components/admin/PlacesFilters";
import { listPlaces } from "../../../lib/admin/data";

type SearchParams = { [key: string]: string | string[] | undefined };

const parseParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const formatDate = (value: Date | null) =>
  value ? new Date(value).toLocaleString() : "—";

const parseTagCounts = (value: unknown) => {
  if (!value || typeof value !== "object") {
    return [] as [string, number][];
  }
  return Object.entries(value as Record<string, number>)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
};

export default async function AdminPlacesPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const qParam = parseParam(sp.q) ?? "";
  const minRatingParam = parseParam(sp.minCommunityRating) ?? "";
  const feedbackParam = parseParam(sp.hasFeedback) ?? "all";
  const page = Number.parseInt(parseParam(sp.page) ?? "1", 10) || 1;
  const pageSize = 50;

  const minCommunityRating = minRatingParam ? Number(minRatingParam) : undefined;
  const hasFeedback =
    feedbackParam === "yes" ? true : feedbackParam === "no" ? false : undefined;

  const { items, total } = await listPlaces({
    q: qParam || undefined,
    minCommunityRating,
    hasFeedback,
    page,
    pageSize,
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const buildPageLink = (nextPage: number) => {
    const params = new URLSearchParams();
    if (qParam) {
      params.set("q", qParam);
    }
    if (minRatingParam) {
      params.set("minCommunityRating", minRatingParam);
    }
    if (feedbackParam !== "all") {
      params.set("hasFeedback", feedbackParam);
    }
    params.set("page", nextPage.toString());
    return `/admin/places?${params.toString()}`;
  };

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-white">Places</h2>
        <p className="text-sm text-slate-400">
          Search places, review ratings, and inspect community feedback.
        </p>
      </div>

      <PlacesFilters
        q={qParam}
        minCommunityRating={minRatingParam}
        hasFeedback={feedbackParam}
      />

      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-slate-950/60 text-xs uppercase tracking-[0.2em] text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Google rating</th>
              <th className="px-4 py-3">Community rating</th>
              <th className="px-4 py-3">Top tags</th>
              <th className="px-4 py-3">Last recommended</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-slate-200">
            {items.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-slate-400" colSpan={6}>
                  No places match the current filters.
                </td>
              </tr>
            ) : (
              items.map((place) => {
                const tags = parseTagCounts(place.aggregate?.tagCounts ?? null);
                return (
                  <tr key={place.placeId} className="hover:bg-slate-950/40">
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{place.name}</p>
                        <p className="text-xs text-slate-500">{place.placeId}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {place.googleRating
                        ? `${place.googleRating.toFixed(1)} (${place.googleRatingsTotal ?? 0})`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {place.aggregate
                        ? `${place.aggregate.communityRatingAvg.toFixed(1)} (${place.aggregate.communityRatingCount})`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {tags.length === 0 ? (
                        <span className="text-slate-500">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {tags.map(([tag, count]) => (
                            <span
                              key={tag}
                              className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-200"
                            >
                              {tag} · {count}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {formatDate(place.lastRecommendedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        className="text-emerald-300 hover:text-emerald-200"
                        href={`/admin/places/${place.placeId}`}
                      >
                        View
                      </Link>
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
