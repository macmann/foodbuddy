"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type PlaceRefreshButtonProps = {
  placeId: string;
};

export default function PlaceRefreshButton({ placeId }: PlaceRefreshButtonProps) {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/places/${placeId}/refresh`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Refresh failed");
      }
      router.refresh();
    } catch {
      setError("Unable to refresh place details.");
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={handleRefresh}
        disabled={isRefreshing}
        className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-emerald-400 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isRefreshing ? "Refreshing..." : "Re-fetch details"}
      </button>
      {error ? <span className="text-xs text-red-200">{error}</span> : null}
    </div>
  );
}
