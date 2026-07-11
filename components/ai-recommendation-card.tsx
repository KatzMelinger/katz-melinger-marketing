/**
 * AI Recommendation card — "Peggy" (Huraqan design system §12).
 *
 * Surfaces up to three real, active recommendations (from `recommendation_items`
 * via getPeggyRecommendations). Each row deep-links to where the action is taken.
 * When nothing is pending it shows an honest empty state, never filler.
 *
 * Presentational only — the data is fetched server-side in app/page.tsx.
 */

import Link from "next/link";

import type { PeggyRec } from "@/lib/dashboard-snapshots";

export function AiRecommendationCard({ items }: { items: PeggyRec[] }) {
  return (
    <section className="overflow-hidden rounded-[10px] border border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-100 px-3.5 py-3">
        <div>
          <div className="text-[12.5px] font-bold text-slate-900">AI recommendations · Peggy</div>
          <div className="mt-0.5 text-[10px] text-slate-400">
            {items.length > 0
              ? `${items.length} action${items.length > 1 ? "s" : ""} need your attention`
              : "You're all caught up"}
          </div>
        </div>
        <Link href="/recommendations" className="shrink-0 text-[11px] font-semibold text-brand hover:underline">
          See all
        </Link>
      </header>

      {items.length === 0 ? (
        <div className="px-3.5 py-8 text-center text-[12px] text-slate-400">
          No open recommendations right now.{" "}
          <Link href="/recommendations" className="font-medium text-brand hover:underline">
            Generate some →
          </Link>
        </div>
      ) : (
        <ul>
          {items.map((r) => (
            <li key={r.id}>
              <Link
                href={r.href}
                className="flex items-start gap-2.5 border-b border-slate-50 px-3.5 py-3 last:border-0 hover:bg-slate-50"
              >
                <span
                  aria-hidden
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-brand/10 text-[14px]"
                >
                  {r.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold text-slate-900">{r.title}</span>
                  <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-slate-500">
                    {r.priority} priority · {r.description}
                  </span>
                  <span className="mt-1 block text-[11px] font-semibold text-brand">View →</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
