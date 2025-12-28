"use client";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ reset }: ErrorPageProps) {
  return (
    <div style={{ margin: "0 auto", maxWidth: 720, padding: "48px 24px" }}>
      <h1>Application error</h1>
      <p>Sorry, something went wrong while loading this page.</p>
      <button
        type="button"
        onClick={reset}
        style={{
          marginTop: 16,
          padding: "8px 16px",
          borderRadius: 6,
          border: "1px solid #d0d0d0",
          background: "#f7f7f7",
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </div>
  );
}
