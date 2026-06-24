"use client";

/**
 * Shared tab bar tying AEO and AI Search into one surface (one sidebar entry).
 * AEO = ongoing citation tracking across tracked prompts; AI Search = a
 * one-shot site readiness score. Same goal (be cited by AI engines), two views.
 * Mirrors the ContentNav pattern: separate routes presented as tabs.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/aeo", label: "AEO (Answer Engine Optimization)" },
  { href: "/ai-search", label: "AI Search Optimization" },
];

export function AiVisibilityNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname?.startsWith(`${href}/`);

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 mb-6">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-[1px] ${
            isActive(t.href)
              ? "border-brand text-brand"
              : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
