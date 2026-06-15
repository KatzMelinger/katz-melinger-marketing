/**
 * HubShell — shared layout for the four Ops Hubs (SEO, AI, Social,
 * Campaigns). Renders a consistent header, KPI strip, sub-area card
 * grid, and optional CTA bar. Pages provide data; HubShell handles
 * the visual contract so all four hubs look like siblings.
 *
 * Use server-rendered KPI values where possible (cheap fetches) and
 * pass loading placeholders for everything else — hubs are aggregator
 * pages, not deep dashboards.
 */

import Link from "next/link";
import type { ReactNode } from "react";

export type HubKpi = {
  label: string;
  value: string;
  hint?: string;
  /**
   * Optional accent color for the tile (Tailwind bg-* / text-* pair).
   * Defaults to neutral slate.
   */
  tone?: "neutral" | "blue" | "emerald" | "amber" | "violet" | "rose";
};

export type HubCard = {
  href: string;
  label: string;
  description: string;
  /**
   * Optional metric shown as a chip in the card corner (e.g. "12 tracked").
   */
  metric?: string;
};

export type HubAction = {
  href?: string;
  onClick?: () => void;
  label: string;
  variant?: "primary" | "outline";
};

const TONE_MAP: Record<NonNullable<HubKpi["tone"]>, string> = {
  neutral: "bg-slate-50 text-slate-900 border-slate-200",
  blue: "bg-brand text-white border-transparent",
  emerald: "bg-emerald-600 text-white border-transparent",
  amber: "bg-amber-600 text-white border-transparent",
  violet: "bg-violet-600 text-white border-transparent",
  rose: "bg-rose-600 text-white border-transparent",
};

export function HubShell({
  eyebrow,
  title,
  subtitle,
  kpis,
  cards,
  actions,
  children,
}: {
  /** Small label above the title (e.g. "SEO Ops Hub"). */
  eyebrow: string;
  title: string;
  subtitle: string;
  /** 3-5 KPI tiles shown in a strip. */
  kpis: HubKpi[];
  /** Sub-area cards linking to the hub's child pages. */
  cards: HubCard[];
  /** Optional quick-action buttons rendered next to the heading. */
  actions?: HubAction[];
  /** Optional extra content (recent activity, callouts) under the strip. */
  children?: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand">
            {eyebrow}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            {title}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{subtitle}</p>
        </div>
        {actions && actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map((a, i) => {
              const cls =
                a.variant === "primary"
                  ? "rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90"
                  : "rounded-md border border-[#e2e8f0] bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-brand hover:text-brand";
              return a.href ? (
                <Link key={i} href={a.href} className={cls}>
                  {a.label}
                </Link>
              ) : (
                <button key={i} type="button" onClick={a.onClick} className={cls}>
                  {a.label}
                </button>
              );
            })}
          </div>
        )}
      </header>

      <section
        className={`grid gap-4 sm:grid-cols-2 ${
          kpis.length >= 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"
        }`}
      >
        {kpis.map((k, i) => {
          const tone = TONE_MAP[k.tone ?? "neutral"];
          const labelColor = k.tone && k.tone !== "neutral" ? "text-white/80" : "text-slate-500";
          const hintColor = k.tone && k.tone !== "neutral" ? "text-white/70" : "text-slate-500";
          return (
            <article
              key={i}
              className={`rounded-xl border p-4 shadow-sm ${tone}`}
            >
              <p className={`text-xs font-medium uppercase tracking-wide ${labelColor}`}>
                {k.label}
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{k.value}</p>
              {k.hint && <p className={`mt-1 text-[11px] ${hintColor}`}>{k.hint}</p>}
            </article>
          );
        })}
      </section>

      {children}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Sub-areas</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="group rounded-xl border border-[#e2e8f0] bg-white p-4 transition hover:border-brand hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-900 group-hover:text-brand">
                  {c.label}
                </h3>
                {c.metric && (
                  <span className="shrink-0 rounded-full border border-[#e2e8f0] bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                    {c.metric}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-xs text-slate-500">{c.description}</p>
              <p className="mt-3 text-xs text-brand group-hover:underline">Open →</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
