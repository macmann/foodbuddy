export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-slate-900">
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <p className="text-sm text-slate-500">
        The page you are looking for does not exist. Please check the URL and try again.
      </p>
    </main>
  );
}
