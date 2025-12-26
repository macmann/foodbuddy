"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

type PlacesFiltersProps = {
  q: string;
  minCommunityRating: string;
  hasFeedback: string;
};

const feedbackOptions = [
  { value: "all", label: "All" },
  { value: "yes", label: "Has feedback" },
  { value: "no", label: "No feedback" },
];

export default function PlacesFilters({
  q,
  minCommunityRating,
  hasFeedback,
}: PlacesFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(q);

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (!value) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });
      params.delete("page");
      const queryString = params.toString();
      router.push(queryString ? `${pathname}?${queryString}` : pathname);
    },
    [pathname, router, searchParams],
  );

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateParams({ q: search.trim() || null });
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <form onSubmit={handleSearchSubmit} className="flex w-full gap-2 sm:w-auto">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or place ID"
            className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400 sm:w-72"
          />
          <button
            type="submit"
            className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-900"
          >
            Search
          </button>
        </form>

        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
          <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Min rating</span>
          <input
            type="number"
            min={0}
            max={5}
            step={0.1}
            value={minCommunityRating}
            onChange={(event) =>
              updateParams({
                minCommunityRating: event.target.value ? event.target.value : null,
              })
            }
            className="w-24 bg-transparent text-sm text-slate-200 outline-none"
          />
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
          <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Feedback</span>
          <select
            className="bg-transparent text-sm text-slate-200 outline-none"
            value={hasFeedback}
            onChange={(event) =>
              updateParams({ hasFeedback: event.target.value === "all" ? null : event.target.value })
            }
          >
            {feedbackOptions.map((option) => (
              <option key={option.value} value={option.value} className="text-slate-900">
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
