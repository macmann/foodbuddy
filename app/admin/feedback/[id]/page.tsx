import Link from "next/link";
import { notFound } from "next/navigation";
import FeedbackActions from "../../../../components/admin/FeedbackActions";
import { getFeedbackDetailWithContext } from "../../../../lib/admin/data";

export default async function FeedbackDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getFeedbackDetailWithContext(id);
  if (!data) {
    return notFound();
  }

  const { feedback, lastRecommendation } = data;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Feedback detail</p>
          <h2 className="text-2xl font-semibold text-white">
            {feedback.place.name} · {feedback.rating}★
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            {feedback.channel} · {new Date(feedback.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <FeedbackActions
            feedbackId={feedback.id}
            status={feedback.moderationStatus}
            variant="block"
          />
          <Link
            href="/admin/feedback"
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-emerald-300"
          >
            Back to feedback
          </Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-200">Full comment</h3>
          <p className="mt-4 text-sm text-slate-300">
            {feedback.commentText ?? "No comment provided."}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="text-sm font-semibold text-slate-200">Status</h3>
          <p className="mt-4 text-lg text-slate-100">{feedback.moderationStatus}</p>
          <div className="mt-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Tags</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {Array.isArray(feedback.tags) && feedback.tags.length > 0 ? (
                feedback.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-200"
                  >
                    {tag}
                  </span>
                ))
              ) : (
                <span className="text-sm text-slate-500">No tags</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="text-sm font-semibold text-slate-200">Place</h3>
          <p className="mt-4 text-sm text-slate-300">{feedback.place.name}</p>
          <p className="mt-2 text-xs text-slate-500">{feedback.place.placeId}</p>
          <Link
            href={`/admin/places/${feedback.placeId}`}
            className="mt-4 inline-flex text-sm text-emerald-300 hover:text-emerald-200"
          >
            View place details
          </Link>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="text-sm font-semibold text-slate-200">Last related query</h3>
          {lastRecommendation ? (
            <div className="mt-4 text-sm text-slate-300">
              <p className="font-semibold text-white">{lastRecommendation.queryText}</p>
              <p className="mt-2 text-xs text-slate-500">
                {lastRecommendation.channel} · {new Date(lastRecommendation.createdAt).toLocaleString()} · {lastRecommendation.status}
              </p>
              <Link
                href={`/admin/queries/${lastRecommendation.id}`}
                className="mt-3 inline-flex text-xs text-emerald-300 hover:text-emerald-200"
              >
                View query
              </Link>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-400">No related queries found.</p>
          )}
        </div>
      </div>
    </section>
  );
}
