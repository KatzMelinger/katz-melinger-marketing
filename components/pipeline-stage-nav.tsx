"use client";

/**
 * Inline stage nav for the content production line. Renders the ordered
 * pipeline stages as a breadcrumb-style strip so editors can move between the
 * gates (Research → Decisions → Briefs → Production → QA → Refresh) without
 * going back to the sidebar. The active stage is derived from the current path.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const STAGES: { href: string; label: string }[] = [
  { href: "/seo/opportunities", label: "Opportunities" },
  { href: "/content/research", label: "Research" },
  { href: "/content/decisions", label: "Decisions" },
  { href: "/content/briefs", label: "Briefs" },
  { href: "/content/pipeline", label: "Production" },
  { href: "/content/publishing-qa", label: "QA" },
  { href: "/content/refresh", label: "Refresh" },
];

export function PipelineStageNav() {
  const pathname = usePathname();

  return (
    <nav className="mb-5 flex flex-wrap items-center gap-1 text-sm">
      {STAGES.map((s, i) => {
        const active = pathname === s.href || pathname?.startsWith(s.href + "/");
        return (
          <span key={s.href} className="flex items-center gap-1">
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
                  ? "bg-[#185FA5]/10 text-[#185FA5]"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              }`}
            >
              {s.label}
            </Link>
          </span>
        );
      })}
    </nav>
  );
}
