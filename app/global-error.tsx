"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-slate-100">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-slate-400">
            {error.message || "An unexpected error occurred. Please try again."}
          </p>
          <button
            type="button"
            className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-900"
            onClick={reset}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
