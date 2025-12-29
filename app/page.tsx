import dynamic from "next/dynamic";

const HomePageClient = dynamic(() => import("./HomePageClient"), {
  ssr: false,
  loading: () => (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-4 py-6 text-sm text-slate-500">
        Loading FoodBuddy...
      </div>
    </main>
  ),
});

export default function HomePage() {
  return <HomePageClient />;
}
