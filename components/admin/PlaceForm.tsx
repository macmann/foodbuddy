"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createAdminPlace,
  deleteAdminPlace,
  updateAdminPlace,
  type AdminPlacePayload,
} from "../../lib/admin/places-client";

export type PlaceFormValues = {
  placeId?: string;
  name: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  mapsUrl?: string | null;
  externalPlaceId?: string | null;
  cuisineTags?: string[];
  priceLevel?: number | null;
  source?: "GOOGLE" | "CURATED";
  isFeatured?: boolean;
};

type PlaceFormProps = {
  mode: "create" | "edit";
  initialPlace?: PlaceFormValues;
};

type ToastState = { tone: "success" | "error"; message: string } | null;

const toInputValue = (value?: string | null) => value ?? "";

const formatTags = (tags?: string[]) => (tags ? tags.join(", ") : "");

export default function PlaceForm({ mode, initialPlace }: PlaceFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialPlace?.name ?? "");
  const [address, setAddress] = useState(toInputValue(initialPlace?.address));
  const [lat, setLat] = useState(
    initialPlace?.lat !== null && initialPlace?.lat !== undefined
      ? String(initialPlace.lat)
      : "",
  );
  const [lng, setLng] = useState(
    initialPlace?.lng !== null && initialPlace?.lng !== undefined
      ? String(initialPlace.lng)
      : "",
  );
  const [mapsUrl, setMapsUrl] = useState(toInputValue(initialPlace?.mapsUrl));
  const [externalPlaceId, setExternalPlaceId] = useState(
    toInputValue(initialPlace?.externalPlaceId),
  );
  const [cuisineTags, setCuisineTags] = useState(formatTags(initialPlace?.cuisineTags));
  const [priceLevel, setPriceLevel] = useState(
    initialPlace?.priceLevel !== null && initialPlace?.priceLevel !== undefined
      ? String(initialPlace.priceLevel)
      : "",
  );
  const [isCurated, setIsCurated] = useState(
    (initialPlace?.source ?? "GOOGLE") === "CURATED",
  );
  const [isFeatured, setIsFeatured] = useState(initialPlace?.isFeatured ?? false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const parsedTags = useMemo(
    () =>
      cuisineTags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    [cuisineTags],
  );

  const buildPayload = (): AdminPlacePayload => {
    const parsedLat = lat.trim();
    const parsedLng = lng.trim();
    const parsedPrice = priceLevel.trim();

    return {
      name: name.trim(),
      address: address.trim() ? address.trim() : null,
      lat: parsedLat ? Number(parsedLat) : undefined,
      lng: parsedLng ? Number(parsedLng) : undefined,
      mapsUrl: mapsUrl.trim() ? mapsUrl.trim() : null,
      externalPlaceId: externalPlaceId.trim() ? externalPlaceId.trim() : null,
      cuisineTags: parsedTags,
      priceLevel: parsedPrice ? Number(parsedPrice) : null,
      isCurated,
      isFeatured,
    };
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setToast({ tone: "error", message: "Name is required." });
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload();
      if (mode === "create") {
        const saved = await createAdminPlace(payload);
        setToast({ tone: "success", message: "Place created." });
        router.push(`/admin/places/${saved.placeId}`);
      } else if (initialPlace?.placeId) {
        await updateAdminPlace(initialPlace.placeId, payload);
        setToast({ tone: "success", message: "Place updated." });
        router.refresh();
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to save place.";
      setToast({ tone: "error", message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!initialPlace?.placeId) {
      return;
    }
    const confirmed = window.confirm("Delete this place? This cannot be undone.");
    if (!confirmed) {
      return;
    }
    setSaving(true);
    try {
      await deleteAdminPlace(initialPlace.placeId);
      router.push("/admin/places");
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to delete place.";
      setToast({ tone: "error", message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {toast ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm shadow-lg transition ${
            toast.tone === "success"
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
              : "border-rose-400/30 bg-rose-400/10 text-rose-100"
          }`}
        >
          {toast.message}
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <label className="space-y-2 text-sm text-slate-300">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Name</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
              placeholder="Place name"
            />
          </label>

          <label className="space-y-2 text-sm text-slate-300">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Address</span>
            <input
              type="text"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
              placeholder="Street address"
            />
          </label>

          <label className="space-y-2 text-sm text-slate-300">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Latitude</span>
            <input
              type="number"
              step="0.0001"
              value={lat}
              onChange={(event) => setLat(event.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
              placeholder="Optional"
            />
          </label>

          <label className="space-y-2 text-sm text-slate-300">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Longitude</span>
            <input
              type="number"
              step="0.0001"
              value={lng}
              onChange={(event) => setLng(event.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
              placeholder="Optional"
            />
          </label>

          <label className="space-y-2 text-sm text-slate-300">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Maps URL</span>
            <input
              type="url"
              value={mapsUrl}
              onChange={(event) => setMapsUrl(event.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
              placeholder="https://maps.google.com/..."
            />
          </label>

          <label className="space-y-2 text-sm text-slate-300">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
              External place ID
            </span>
            <input
              type="text"
              value={externalPlaceId}
              onChange={(event) => setExternalPlaceId(event.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
              placeholder="Google/MCP place ID"
            />
          </label>

          <label className="space-y-2 text-sm text-slate-300">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Cuisine tags</span>
            <input
              type="text"
              value={cuisineTags}
              onChange={(event) => setCuisineTags(event.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
              placeholder="thai, noodles, brunch"
            />
          </label>

          <label className="space-y-2 text-sm text-slate-300">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Price level</span>
            <input
              type="number"
              min={0}
              max={4}
              value={priceLevel}
              onChange={(event) => setPriceLevel(event.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
              placeholder="0-4"
            />
          </label>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setIsCurated((prev) => !prev)}
            className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm font-semibold transition ${
              isCurated
                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
                : "border-slate-700 bg-slate-950 text-slate-300"
            }`}
          >
            <span>Curated source</span>
            <span>{isCurated ? "Curated" : "Google"}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsFeatured((prev) => !prev)}
            className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm font-semibold transition ${
              isFeatured
                ? "border-amber-400/40 bg-amber-400/10 text-amber-100"
                : "border-slate-700 bg-slate-950 text-slate-300"
            }`}
          >
            <span>Featured flag</span>
            <span>{isFeatured ? "Featured" : "Off"}</span>
          </button>
        </div>

        {mode === "edit" && initialPlace?.placeId ? (
          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Place ID</p>
            <p className="mt-2 break-all text-sm text-slate-200">{initialPlace.placeId}</p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className="rounded-xl bg-emerald-400 px-6 py-2 text-sm font-semibold text-slate-900 disabled:cursor-not-allowed disabled:bg-emerald-400/60"
        >
          {saving ? "Saving..." : mode === "create" ? "Create place" : "Save changes"}
        </button>
        {mode === "edit" ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving}
            className="rounded-xl border border-rose-500/60 px-6 py-2 text-sm font-semibold text-rose-200 hover:border-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Delete place
          </button>
        ) : null}
      </div>
    </div>
  );
}
