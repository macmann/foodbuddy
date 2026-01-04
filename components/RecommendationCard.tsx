import type { RecommendationCardData } from "../lib/types";

const formatDistance = (meters?: number) => {
  if (typeof meters !== "number") {
    return null;
  }
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
};

type RecommendationCardProps = {
  recommendation: RecommendationCardData;
  onRate: (placeId: string) => void;
};

export default function RecommendationCard({ recommendation, onRate }: RecommendationCardProps) {
  const distance = formatDistance(recommendation.distanceMeters);

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900 sm:text-lg">
            {recommendation.name}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>
              {recommendation.rating ? `${recommendation.rating.toFixed(1)}★` : "No rating"}
            </span>
            {recommendation.reviewCount !== undefined && (
              <span>{`${recommendation.reviewCount} reviews`}</span>
            )}
            {distance && <span>{distance}</span>}
            {recommendation.openNow !== undefined && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  recommendation.openNow
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-rose-100 text-rose-700"
                }`}
              >
                {recommendation.openNow ? "Open now" : "Closed"}
              </span>
            )}
          </div>
        </div>
      </div>
      {recommendation.address && (
        <div className="mt-2 text-sm text-slate-500">{recommendation.address}</div>
      )}
      {recommendation.rationale && (
        <p className="mt-2 text-sm text-slate-600">{recommendation.rationale}</p>
      )}
      {recommendation.whyLine && (
        <p className="mt-2 text-sm font-semibold text-slate-700">
          {recommendation.whyLine}
        </p>
      )}
      {recommendation.tryLine && (
        <p className="mt-1 text-sm text-slate-600">{recommendation.tryLine}</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {recommendation.mapsUrl && (
          <a
            href={recommendation.mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            Open in Maps
          </a>
        )}
        <button
          type="button"
          onClick={() => onRate(recommendation.placeId)}
          className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
        >
          Rate this
        </button>
      </div>
    </article>
  );
}
