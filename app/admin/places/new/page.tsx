import Link from "next/link";
import PlaceForm from "../../../../components/admin/PlaceForm";

export default function NewPlacePage() {
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">New place</p>
          <h2 className="text-2xl font-semibold text-white">Create curated place</h2>
          <p className="mt-2 text-sm text-slate-400">
            Add curated or featured places for FoodBuddy recommendations.
          </p>
        </div>
        <Link
          href="/admin/places"
          className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-emerald-300"
        >
          Back to places
        </Link>
      </div>

      <PlaceForm mode="create" />
    </section>
  );
}
