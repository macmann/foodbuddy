import Link from "next/link";
import { notFound } from "next/navigation";
import PlaceForm from "../../../../../components/admin/PlaceForm";
import { getPlaceEditData } from "../../../../../lib/admin/data";

export default async function EditPlacePage({
  params,
}: {
  params: Promise<{ placeId: string }>;
}) {
  const { placeId } = await params;
  const place = await getPlaceEditData(placeId);

  if (!place) {
    return notFound();
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Edit place</p>
          <h2 className="text-2xl font-semibold text-white">{place.name}</h2>
          <p className="mt-2 text-sm text-slate-400">{place.placeId}</p>
        </div>
        <Link
          href={`/admin/places/${place.placeId}`}
          className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-emerald-300"
        >
          Back to detail
        </Link>
      </div>

      <PlaceForm
        mode="edit"
        initialPlace={{
          placeId: place.placeId,
          name: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          mapsUrl: place.mapsUrl,
          externalPlaceId: place.externalPlaceId,
          cuisineTags: place.cuisineTags,
          priceLevel: place.priceLevel,
          source: place.source,
          isFeatured: place.isFeatured,
        }}
      />
    </section>
  );
}
