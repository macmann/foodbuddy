"use client";

import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type TopbarProps = {
  onMenuClick: () => void;
};

const titleMap = [
  { href: "/admin/queries", label: "Queries" },
  { href: "/admin/sessions", label: "Sessions" },
  { href: "/admin/places", label: "Places" },
  { href: "/admin/feedback", label: "Feedback" },
  { href: "/admin/health", label: "System Health" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin", label: "Dashboard" },
];

export default function Topbar({ onMenuClick }: TopbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const title = useMemo(() => {
    const match = titleMap.find((item) => pathname.startsWith(item.href));
    return match?.label ?? "Dashboard";
  }, [pathname]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } finally {
      router.push("/admin/login");
      router.refresh();
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
      <div className="flex items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="flex items-center justify-center rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-500 lg:hidden"
            onClick={onMenuClick}
          >
            Menu
          </button>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Admin</p>
            <h1 className="text-xl font-semibold text-white sm:text-2xl">{title}</h1>
          </div>
        </div>
        <button
          type="button"
          className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-emerald-400 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={handleLogout}
          disabled={isLoggingOut}
        >
          {isLoggingOut ? "Signing out..." : "Logout"}
        </button>
      </div>
    </header>
  );
}
