import Link from "next/link";
import { notFound } from "next/navigation";
import PlaceRefreshButton from "../../../../components/admin/PlaceRefreshButton";
import { getPlaceDetail } from "../../../../lib/admin/data";

const formatDate = (value: Date | null | undefined) =>
  value ? new Date(value).toLocaleString() : "—";

export default async function PlaceDetailPage({
  params,
}: {
  params: Promise<{ placeId: string }>;
}) {
  const { placeId } = await params;
  const place = await getPlaceDetail(placeId);
  if (!place) {
    return notFound();
  }

  const feedback = place.feedback.slice(0, 10);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Place detail</p>
          <h2 className="text-2xl font-semibold text-white">{place.name}</h2>
          <p className="mt-2 text-sm text-slate-400">{place.placeId}</p>
        </div>
        <div className="flex items-center gap-3">
          <PlaceRefreshButton placeId={place.placeId} />
          <Link
            href={`/admin/places/${place.placeId}/edit`}
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-emerald-300"
          >
            Edit place
          </Link>
          <Link
            href="/admin/places"
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-emerald-300"
          >
            Back to places
          </Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-200">Place metadata</h3>
          <div className="mt-4 grid gap-4 text-sm text-slate-300 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Address</p>
              <p className="mt-2">{place.address ?? "N/A"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Coordinates</p>
              <p className="mt-2">
                {place.lat.toFixed(4)}, {place.lng.toFixed(4)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Source</p>
              <p className="mt-2">{place.source === "CURATED" ? "Curated" : "Google"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Featured</p>
              <p className="mt-2">{place.isFeatured ? "Yes" : "No"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Google rating</p>
              <p className="mt-2">
                {place.googleRating
                  ? `${place.googleRating.toFixed(1)} (${place.googleRatingsTotal ?? 0})`
                  : "N/A"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Last fetched</p>
              <p className="mt-2">{formatDate(place.lastFetchedAt)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                External place ID
              </p>
              <p className="mt-2">{place.externalPlaceId ?? "N/A"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Price level</p>
              <p className="mt-2">
                {place.priceLevel !== null && place.priceLevel !== undefined
                  ? place.priceLevel
                  : "N/A"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Cuisine tags
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {place.cuisineTags.length > 0 ? (
                  place.cuisineTags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-200"
                    >
                      {tag}
                    </span>
                  ))
                ) : (
                  <span className="text-slate-500">N/A</span>
                )}
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Maps</p>
              {place.mapsUrl ? (
                <a
                  className="mt-2 inline-flex text-emerald-300 hover:text-emerald-200"
                  href={place.mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Maps
                </a>
              ) : (
                <p className="mt-2">N/A</p>
              )}
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="text-sm font-semibold text-slate-200">FoodBuddy aggregates</h3>
          <div className="mt-4 space-y-4 text-sm text-slate-300">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                FoodBuddy rating avg
              </p>
              <p className="mt-2">
                {place.aggregate
                  ? `${place.aggregate.foodbuddyRatingAvg.toFixed(1)}`
                  : "N/A"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                FoodBuddy rating count
              </p>
              <p className="mt-2">
                {place.aggregate ? place.aggregate.foodbuddyRatingCount : "N/A"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Community rating avg
              </p>
              <p className="mt-2">
                {place.aggregate
                  ? `${place.aggregate.communityRatingAvg.toFixed(1)}`
                  : "N/A"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Community rating count
              </p>
              <p className="mt-2">
                {place.aggregate ? place.aggregate.communityRatingCount : "N/A"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Feedback count
              </p>
              <p className="mt-2">{place._count?.feedback ?? 0}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Latest feedback
              </p>
              <p className="mt-2">
                {feedback.length > 0 ? formatDate(feedback[0]?.createdAt) : "N/A"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Top tags</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {place.aggregate?.tagCounts &&
                Object.keys(place.aggregate.tagCounts as Record<string, number>).length > 0 ? (
                  Object.entries(place.aggregate.tagCounts as Record<string, number>)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 4)
                    .map(([tag, count]) => (
                      <span
                        key={tag}
                        className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-200"
                      >
                        {tag} · {count}
                      </span>
                    ))
                ) : (
                  <span className="text-slate-500">No tags yet</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="text-sm font-semibold text-slate-200">Recent feedback</h3>
        <div className="mt-4 space-y-4">
          {feedback.length === 0 ? (
            <p className="text-sm text-slate-400">No feedback yet.</p>
          ) : (
            feedback.map((entry) => {
              const tags: string[] = Array.isArray(entry.tags)
                ? entry.tags.filter((t): t is string => typeof t === "string")
                : [];

              return (
                <div key={entry.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">
                      {entry.rating}★ · {entry.channel}
                    </p>
                    <p className="text-xs text-slate-500">
                      {new Date(entry.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <p className="mt-2 text-sm text-slate-300">
                    {entry.commentText ?? "No comment provided."}
                  </p>
                  {tags.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-200"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
