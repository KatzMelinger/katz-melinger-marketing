"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { readContentType } from "@/lib/content-types";

/**
 * Type-scoped pages — these honor the `?type=` query param set by
 * ContentTypeTabs at the top of the page. Navigating between them carries
 * the current Website / Social Media / Email selection along.
 */
const TYPE_SCOPED_TABS = [
  { href: "/content", label: "Generate" },
  { href: "/content/batch", label: "Multi-format batch" },
  { href: "/content/intelligence", label: "Intelligence" },
  { href: "/content/pipeline", label: "Pipeline" },
  { href: "/content/drafts", label: "Saved drafts" },
];

/**
 * Workspace pages — firm-level settings that aren't scoped to a content
 * type. Visually separated from the type-scoped tabs.
 */
const WORKSPACE_TABS = [
  { href: "/brand-voice", label: "Brand voice & directions" },
  { href: "/content/sources", label: "Source material" },
];

export function ContentNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const type = readContentType(searchParams);

  const isActive = (href: string) =>
    pathname === href || (href !== "/content" && pathname?.startsWith(href));

  const linkFor = (href: string, isWorkspace: boolean) => {
    // Workspace pages don't carry the type param; type-scoped do.
    return isWorkspace ? href : `${href}?type=${type}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 mb-6">
      {TYPE_SCOPED_TABS.map((t) => {
        const active = isActive(t.href);
        return (
          <Link
            key={t.href}
            href={linkFor(t.href, false)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-[1px] ${
              active
                ? "border-[#185FA5] text-[#185FA5]"
                : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
      <span className="mx-2 text-slate-300" aria-hidden>
        |
      </span>
      <span className="text-[10px] uppercase tracking-wider text-slate-400 mr-1">
        Workspace
      </span>
      {WORKSPACE_TABS.map((t) => {
        const active = isActive(t.href);
        return (
          <Link
            key={t.href}
            href={linkFor(t.href, true)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-[1px] ${
              active
                ? "border-[#185FA5] text-[#185FA5]"
                : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
