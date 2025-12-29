"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main>
      <h1>Something went wrong</h1>
      <button onClick={reset}>Retry</button>
    </main>
  );
}
