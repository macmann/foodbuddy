"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "Dashboard", href: "/admin" },
  { label: "Queries", href: "/admin/queries" },
  { label: "Sessions", href: "/admin/sessions" },
  { label: "Places", href: "/admin/places" },
  { label: "Feedback", href: "/admin/feedback" },
  { label: "System Health", href: "/admin/health" },
  { label: "Settings", href: "/admin/settings" },
  { label: "LLM Settings", href: "/admin/settings/llm" },
];

type SidebarNavProps = {
  isOpen: boolean;
  onClose: () => void;
};

export default function SidebarNav({ isOpen, onClose }: SidebarNavProps) {
  const pathname = usePathname();
  const safePathname = pathname ?? "";

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm transition-opacity lg:hidden ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 transform border-r border-slate-800 bg-slate-900/95 p-6 transition lg:static lg:translate-x-0 lg:bg-slate-950 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-emerald-300">
              FoodBuddy
            </p>
            <p className="text-lg font-semibold text-white">Admin Console</p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500 lg:hidden"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <nav className="mt-10 space-y-2">
          {navItems.map((item) => {
            const isActive =
              item.href === "/admin"
                ? safePathname === "/admin"
                : safePathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm font-medium transition ${
                  isActive
                    ? "bg-emerald-400/20 text-emerald-200"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
                onClick={onClose}
              >
                <span>{item.label}</span>
                <span
                  className={`h-2 w-2 rounded-full ${
                    isActive ? "bg-emerald-300" : "bg-transparent"
                  }`}
                />
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
