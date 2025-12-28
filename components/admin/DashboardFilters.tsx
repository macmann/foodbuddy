"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

type DashboardFiltersProps = {
  range: string;
  channel: string;
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

export default function DashboardFilters({ range, channel }: DashboardFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (value === "all" || value === "today") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-1">
        {rangeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`rounded-lg px-3 py-1 text-sm font-medium transition ${
              range === option.value
                ? "bg-emerald-400/20 text-emerald-200"
                : "text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
            onClick={() => updateParam("range", option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2">
        <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Channel</span>
        <select
          className="bg-transparent text-sm text-slate-200 outline-none"
          value={channel}
          onChange={(event) => updateParam("channel", event.target.value)}
        >
          {channelOptions.map((option) => (
            <option key={option.value} value={option.value} className="text-slate-900">
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
