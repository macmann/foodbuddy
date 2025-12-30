export default function ServerErrorPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-slate-900">
      <h1 className="text-3xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-slate-500">
        We hit an unexpected error. Please refresh the page or try again later.
      </p>
    </main>
  );
}
