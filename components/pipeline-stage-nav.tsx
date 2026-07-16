"use client";

/**
 * Inline stage nav for the content production line. Renders the ordered
 * pipeline stages as a breadcrumb-style strip so editors can move between the
 * gates (Opportunity → Draft → Approve → QA → Published) without going back to
 * the sidebar. The active stage is derived from the current path.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const STAGES: { href: string; label: string }[] = [
  { href: "/seo/opportunities", label: "Opportunity" },
  { href: "/content-production", label: "Draft" },
  { href: "/content-production", label: "Approve" },
  { href: "/content/publishing-qa", label: "QA" },
  { href: "/content-production", label: "Published" },
];

export function PipelineStageNav() {
  const pathname = usePathname();

  return (
    <div className="mb-5 space-y-2">
      {/* Back to the unified board, so every stage links home without the sidebar. */}
      <Link
        href="/content-production"
        className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
      >
        <span aria-hidden>←</span> Production Board
      </Link>
      <nav className="flex flex-wrap items-center gap-1 text-sm">
        {STAGES.map((s, i) => {
        const active = pathname === s.href || pathname?.startsWith(s.href + "/");
        return (
          <span key={s.label} className="flex items-center gap-1">
            {i > 0 && (
              <span className="text-slate-300" aria-hidden>
                →
              </span>
            )}
            <Link
              href={s.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                active
                  ? "bg-brand/10 text-brand"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              }`}
            >
              {s.label}
            </Link>
            </span>
          );
        })}
      </nav>
    </div>
  );
}
