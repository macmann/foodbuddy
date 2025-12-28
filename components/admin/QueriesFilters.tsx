"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

type QueriesFiltersProps = {
  range: string;
  channel: string;
  status: string;
  q: string;
  errorsOnly: boolean;
  noResultsOnly: boolean;
};

const rangeOptions = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

const channelOptions = [
  { value: "all", label: "All" },
  { value: "WEB", label: "WEB" },
  { value: "TELEGRAM", label: "TELEGRAM" },
];

const statusOptions = [
  { value: "all", label: "All" },
  { value: "OK", label: "OK" },
  { value: "ERROR", label: "ERROR" },
  { value: "NO_RESULTS", label: "NO_RESULTS" },
];

export default function QueriesFilters({
  range,
  channel,
  status,
  q,
  errorsOnly,
  noResultsOnly,
}: QueriesFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(q);

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      Object.entries(updates).forEach(([key, value]) => {
        if (!value) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });
      params.delete("page");
      const queryString = params.toString();
      const safePathname = pathname ?? "";
      router.push(queryString ? `${safePathname}?${queryString}` : safePathname);
    },
    [pathname, router, searchParams],
  );

  const toggleErrorsOnly = () => {
    updateParams({
      errors: errorsOnly ? null : "1",
      noResults: null,
      status: errorsOnly ? null : "ERROR",
    });
  };

  const toggleNoResultsOnly = () => {
    updateParams({
      noResults: noResultsOnly ? null : "1",
      errors: null,
      status: noResultsOnly ? null : "NO_RESULTS",
    });
  };

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateParams({ q: search.trim() || null });
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
              onClick={() =>
                updateParams({ range: option.value === "today" ? null : option.value })
              }
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
          <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Channel</span>
          <select
            className="bg-transparent text-sm text-slate-200 outline-none"
            value={channel}
            onChange={(event) =>
              updateParams({ channel: event.target.value === "all" ? null : event.target.value })
            }
          >
            {channelOptions.map((option) => (
              <option key={option.value} value={option.value} className="text-slate-900">
                {option.label}
              </option>
            ))}
          </select>
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

        <button
          type="button"
          className={`rounded-xl border px-4 py-2 text-sm transition ${
            errorsOnly
              ? "border-amber-400/60 bg-amber-400/10 text-amber-200"
              : "border-slate-800 text-slate-300 hover:border-slate-600"
          }`}
          onClick={toggleErrorsOnly}
        >
          Errors only
        </button>
        <button
          type="button"
          className={`rounded-xl border px-4 py-2 text-sm transition ${
            noResultsOnly
              ? "border-indigo-400/60 bg-indigo-400/10 text-indigo-200"
              : "border-slate-800 text-slate-300 hover:border-slate-600"
          }`}
          onClick={toggleNoResultsOnly}
        >
          No results only
        </button>

        <form onSubmit={handleSearchSubmit} className="ml-auto flex w-full gap-2 sm:w-auto">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search query text"
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
