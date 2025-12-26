"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

type FeedbackFiltersProps = {
  status: string;
  place: string;
  q: string;
  range: string;
};

const statusOptions = [
  { value: "all", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "HIDDEN", label: "Hidden" },
];

const rangeOptions = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

export default function FeedbackFilters({ status, place, q, range }: FeedbackFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(q);
  const [placeSearch, setPlaceSearch] = useState(place);

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

  const handlePlaceSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateParams({ place: placeSearch.trim() || null });
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-1">
          {rangeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`rounded-lg px-3 py-1 text-sm font-medium transition ${
                range === option.value
                  ? "bg-emerald-400/20 text-emerald-200"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
              onClick={() => updateParams({ range: option.value === "today" ? null : option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
          <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Status</span>
          <select
            className="bg-transparent text-sm text-slate-200 outline-none"
            value={status}
            onChange={(event) =>
              updateParams({ status: event.target.value === "all" ? null : event.target.value })
            }
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value} className="text-slate-900">
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <form onSubmit={handlePlaceSubmit} className="flex w-full gap-2 sm:w-auto">
          <input
            type="text"
            value={placeSearch}
            onChange={(event) => setPlaceSearch(event.target.value)}
            placeholder="Filter by place"
            className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400 sm:w-64"
          />
          <button
            type="submit"
            className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-emerald-300"
          >
            Apply
          </button>
        </form>

        <form onSubmit={handleSearchSubmit} className="ml-auto flex w-full gap-2 sm:w-auto">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search comments"
            className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400 sm:w-64"
          />
          <button
            type="submit"
            className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-900"
          >
            Search
          </button>
        </form>
      </div>
    </div>
  );
}
