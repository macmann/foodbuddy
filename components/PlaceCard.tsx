import type { RecommendationCardData } from "../lib/types";

type PlaceCardProps = {
  place: RecommendationCardData;
};

export default function PlaceCard({ place }: PlaceCardProps) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900 sm:text-lg">{place.name}</h3>
          <div className="mt-1 text-xs text-slate-500">
            {place.rating ? `${place.rating.toFixed(1)}★` : "No rating"}
          </div>
        </div>
      </div>
      {place.address && <div className="mt-2 text-sm text-slate-500">{place.address}</div>}
      {place.mapsUrl && (
        <div className="mt-4">
          <a
            href={place.mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            Open in Maps
          </a>
        </div>
      )}
    </article>
  );
}
