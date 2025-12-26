import Link from "next/link";
import { notFound } from "next/navigation";
import { getQueryDetailWithPlaces } from "../../../../lib/admin/data";

const formatLocation = (lat?: number | null, lng?: number | null) => {
  if (lat === null || lat === undefined || lng === null || lng === undefined) {
    return "N/A";
  }
  return `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
};

const statusStyles: Record<string, string> = {
  OK: "bg-emerald-400/20 text-emerald-200",
  ERROR: "bg-red-400/20 text-red-200",
  NO_RESULTS: "bg-amber-400/20 text-amber-200",
};

export default async function QueryDetailPage({ params }: { params: { id: string } }) {
  const data = await getQueryDetailWithPlaces(params.id);
  if (!data) {
    return notFound();
  }

  const { event, places, recommendedPlaceIds } = data;
  const parsedConstraints = event.parsedConstraints as Record<string, unknown> | null;

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Query detail</p>
          <h2 className="text-2xl font-semibold text-white">{event.queryText}</h2>
          <p className="mt-2 text-sm text-slate-400">
            {event.channel} · {new Date(event.createdAt).toLocaleString()}
          </p>
        </div>
        <Link
          href="/admin/queries"
          className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-emerald-300"
        >
          Back to queries
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Status</p>
          <div className="mt-3 flex items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyles[event.status]}`}
            >
              {event.status}
            </span>
            <span className="text-sm text-slate-300">
              {event.latencyMs ? `${event.latencyMs} ms` : "Latency N/A"}
            </span>
          </div>
          {event.errorMessage ? (
            <p className="mt-3 text-sm text-red-200">{event.errorMessage}</p>
          ) : null}
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Location</p>
          <p className="mt-3 text-lg text-slate-200">
            {formatLocation(event.userLat, event.userLng)}
          </p>
          <p className="mt-2 text-sm text-slate-400">Rounded for privacy</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Result count</p>
          <p className="mt-3 text-3xl font-semibold text-white">
            {event.resultCount ?? 0}
          </p>
          <p className="mt-2 text-sm text-slate-400">Recommendations returned</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="text-sm font-semibold text-slate-200">Parsed constraints</h3>
          <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-slate-950/60 p-4 text-xs text-slate-300">
            {parsedConstraints
              ? JSON.stringify(parsedConstraints, null, 2)
              : "No parsed constraints recorded."}
          </pre>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="text-sm font-semibold text-slate-200">Recommended place IDs</h3>
          <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-slate-950/60 p-4 text-xs text-slate-300">
            {JSON.stringify(recommendedPlaceIds, null, 2)}
          </pre>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="text-sm font-semibold text-slate-200">Recommended places</h3>
        <div className="mt-4 space-y-4">
          {places.length === 0 ? (
            <p className="text-sm text-slate-400">No recommended places recorded.</p>
          ) : (
            places.map((place) => (
              <div
                key={place.placeId}
                className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-lg font-semibold text-white">{place.name}</p>
                    <p className="text-sm text-slate-400">{place.address ?? "Address unavailable"}</p>
                  </div>
                  {place.mapsUrl ? (
                    <a
                      className="text-sm text-emerald-300 hover:text-emerald-200"
                      href={place.mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open in Maps
                    </a>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-3 text-sm text-slate-300 sm:grid-cols-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Rating</p>
                    <p className="mt-1">
                      {place.googleRating ? place.googleRating.toFixed(1) : "N/A"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      Community score
                    </p>
                    <p className="mt-1">
                      {place.aggregate
                        ? `${place.aggregate.communityRatingAvg.toFixed(1)} (${place.aggregate.communityRatingCount})`
                        : "N/A"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      Place ID
                    </p>
                    <p className="mt-1 break-all text-slate-400">{place.placeId}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
