"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-slate-900">
      <h1 className="text-3xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-slate-500">
        {error.message || "We hit an unexpected error. Please try again."}
      </p>
      <button
        type="button"
        className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
        onClick={reset}
      >
        Retry
      </button>
    </main>
  );
}
