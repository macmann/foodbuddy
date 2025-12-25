import type { RecommendationCardData } from "../lib/types";

type FeedbackCardProps = {
  options: RecommendationCardData[];
  selectedPlaceId: string;
  rating: number;
  commentText: string;
  selectedTags: string[];
  onPlaceChange: (placeId: string) => void;
  onRatingChange: (rating: number) => void;
  onCommentChange: (value: string) => void;
  onToggleTag: (tag: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
  errorMessage?: string | null;
};

const TAGS = [
  "cheap",
  "tasty",
  "spicy",
  "clean",
  "good service",
  "good for work",
  "family-friendly",
];

export default function FeedbackCard({
  options,
  selectedPlaceId,
  rating,
  commentText,
  selectedTags,
  onPlaceChange,
  onRatingChange,
  onCommentChange,
  onToggleTag,
  onSubmit,
  onSkip,
  errorMessage,
}: FeedbackCardProps) {
  const remainingChars = 300 - commentText.length;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Quick feedback</h3>
          <p className="text-sm text-slate-500">Rate a place to help others.</p>
        </div>
        <button
          type="button"
          onClick={onSkip}
          className="text-xs font-semibold text-slate-400 hover:text-slate-600"
        >
          Skip
        </button>
      </div>
      <div className="mt-4 grid gap-4">
        <label className="grid gap-2 text-xs font-semibold text-slate-500" htmlFor="feedback-place">
          Which place did you try?
          <select
            id="feedback-place"
            value={selectedPlaceId}
            onChange={(event) => onPlaceChange(event.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
          >
            {options.map((option) => (
              <option key={option.placeId} value={option.placeId}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-2">
          <span className="text-xs font-semibold text-slate-500">Your rating</span>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onRatingChange(value)}
                className={`h-10 w-10 rounded-full text-sm font-semibold shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 ${
                  rating >= value
                    ? "bg-amber-400 text-white"
                    : "border border-slate-200 bg-white text-slate-500"
                }`}
                aria-label={`Rate ${value} stars`}
              >
                ★
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-2">
          <span className="text-xs font-semibold text-slate-500">Tags</span>
          <div className="flex flex-wrap gap-2">
            {TAGS.map((tag) => {
              const active = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onToggleTag(tag)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 ${
                    active
                      ? "bg-slate-900 text-white"
                      : "border border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
        <label
          className="grid gap-2 text-xs font-semibold text-slate-500"
          htmlFor="feedback-comment"
        >
          Comment (optional)
          <textarea
            id="feedback-comment"
            value={commentText}
            onChange={(event) => onCommentChange(event.target.value)}
            maxLength={300}
            rows={3}
            placeholder="Tell us what you liked"
            className="resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
          />
          <span className="text-[11px] text-slate-400">{remainingChars} characters left</span>
        </label>
        {errorMessage && <p className="text-sm text-rose-600">{errorMessage}</p>}
        <button
          type="button"
          onClick={onSubmit}
          className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          Submit feedback
        </button>
      </div>
    </div>
  );
}
