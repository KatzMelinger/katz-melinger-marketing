"use client";

/**
 * Shared building blocks for the Reporting surface — formatters, the
 * period-window helper, and the presentational components (KPI tiles, section
 * headers, delta badges, sparkline, and the printable report frame) used by
 * every report type (Performance, Production, Trends, Custom).
 *
 * Keeping these here means the four reports render with one consistent,
 * print-clean look and the math (deltas, window math) lives in one place.
 */

import type { ReactNode } from "react";

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Period presets. Standard reports (Performance / Production / Custom) offer
 * the two completed calendar windows plus a rolling 30-day view; Trends offers
 * rolling 7/14/30-day windows since its underlying signals (rank refreshes,
 * GSC's trailing API) are inherently rolling, not calendar-aligned.
 */
export type PeriodKey = "last-week" | "last-month" | "last-30" | "last-7" | "last-14";
export type ReportLayout = "operating" | "strategic";

export const STANDARD_PERIODS: PeriodKey[] = ["last-week", "last-month", "last-30"];
export const TRENDS_PERIODS: PeriodKey[] = ["last-7", "last-14", "last-30"];

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  "last-week": "Last week",
  "last-month": "Last month",
  "last-30": "Last 30 days",
  "last-7": "Last 7 days",
  "last-14": "Last 14 days",
};

export type ReportWindow = {
  key: PeriodKey;
  label: string;
  days: number;
  since: string;
  until: string;
  prevSince: string;
  prevUntil: string;
  periodWord: string;
  priorWord: string;
  layout: ReportLayout;
};

function fmtLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function daysInclusive(since: Date, until: Date): number {
  return Math.round((until.getTime() - since.getTime()) / DAY_MS) + 1;
}
export function todayIso(): string {
  const now = new Date();
  return fmtLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
}

/**
 * Resolves a preset into a concrete [since, until] window plus the equally-long
 * window immediately before it (so deltas line up with /api/metrics/overview,
 * which computes its prior window the same way).
 */
export function windowForPeriod(key: PeriodKey): ReportWindow {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let since: Date;
  let until: Date;
  let layout: ReportLayout;
  let periodWord: string;
  let priorWord: string;

  if (key === "last-week") {
    // Most recent complete Monday–Sunday week.
    const dow = (today.getDay() + 6) % 7; // Monday = 0
    const thisMonday = addDays(today, -dow);
    since = addDays(thisMonday, -7);
    until = addDays(thisMonday, -1);
    layout = "operating";
    periodWord = "week";
    priorWord = "prior week";
  } else if (key === "last-month") {
    // Previous complete calendar month.
    since = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    until = new Date(today.getFullYear(), today.getMonth(), 0);
    layout = "strategic";
    periodWord = "month";
    priorWord = "prior month";
  } else {
    const n = key === "last-7" ? 7 : key === "last-14" ? 14 : 30;
    until = today;
    since = addDays(today, -(n - 1));
    layout = n >= 30 ? "strategic" : "operating";
    periodWord = `${n}-day window`;
    priorWord = `prior ${n}-day window`;
  }

  const days = daysInclusive(since, until);
  const prevUntil = addDays(since, -1);
  const prevSince = addDays(since, -days);

  return {
    key,
    label: PERIOD_LABEL[key],
    days,
    since: fmtLocal(since),
    until: fmtLocal(until),
    prevSince: fmtLocal(prevSince),
    prevUntil: fmtLocal(prevUntil),
    periodWord,
    priorWord,
    layout,
  };
}

export function prettyDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
export function fmtUsd(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
export function fmtNum(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}
export function fmtPct(n: number, digits = 0): string {
  return `${n.toFixed(digits)}%`;
}
export function pctDelta(current: number, prior: number): number | null {
  if (prior <= 0) return null;
  return Math.round(((current - prior) / prior) * 1000) / 10;
}
/** True when an ISO date string falls inside [lo, hi] (lexicographic = chronological for ISO). */
export function inRange(d: string, lo: string, hi: string): boolean {
  const day = (d ?? "").slice(0, 10);
  return !!day && day >= lo && day <= hi;
}

export function Sparkline({ data, color = "#4F46E5" }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  const w = 480;
  const h = 56;
  const max = Math.max(...data, 1);
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`);
  const line = pts.join(" ");
  const area = `0,${h} ${line} ${w},${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full" preserveAspectRatio="none">
      <polygon points={area} fill={`${color}14`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.75" />
    </svg>
  );
}

export function DeltaBadge({ pct, goodWhenUp = true }: { pct: number | null; goodWhenUp?: boolean }) {
  if (pct == null) return <span className="text-xs text-slate-400">no prior</span>;
  if (pct === 0) return <span className="text-xs text-slate-400">flat</span>;
  const up = pct > 0;
  const good = up === goodWhenUp;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${good ? "text-emerald-600" : "text-rose-500"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

export function Kpi({
  label,
  value,
  pct,
  goodWhenUp = true,
  hint,
}: {
  label: string;
  value: string;
  pct?: number | null;
  goodWhenUp?: boolean;
  hint?: string;
}) {
  return (
    <article className="rounded-xl border border-[#e2e8f0] bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</p>
      <div className="mt-1 flex items-center gap-2">
        {pct !== undefined ? <DeltaBadge pct={pct} goodWhenUp={goodWhenUp} /> : null}
        {hint ? <span className="text-[11px] text-slate-400">{hint}</span> : null}
      </div>
    </article>
  );
}

export function Section({
  num,
  title,
  blurb,
  children,
}: {
  num: number;
  title: string;
  blurb?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="border-b border-slate-200 pb-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#4F46E5]/10 text-[11px] font-bold text-[#4F46E5]">
            {num}
          </span>
          {title}
        </h2>
        {blurb ? <p className="mt-1 text-xs text-slate-500">{blurb}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Horizontal bar for a labeled count — used in the production breakdown. */
export function BarRow({ label, value, max, sub }: { label: string; value: number; max: number; sub?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-40 shrink-0 truncate text-sm text-slate-700" title={label}>
        {label}
      </div>
      <div className="h-5 flex-1 overflow-hidden rounded bg-slate-100">
        <div className="h-full rounded bg-[#4F46E5]/70" style={{ width: `${Math.max(pct, value > 0 ? 4 : 0)}%` }} />
      </div>
      <div className="w-24 shrink-0 text-right text-sm tabular-nums text-slate-900">
        {fmtNum(value)}
        {sub ? <span className="ml-1 text-[11px] text-slate-400">{sub}</span> : null}
      </div>
    </div>
  );
}

/** Printable bordered report card with letterhead + footer. */
export function ReportFrame({
  kicker = "Katz Melinger · Marketing",
  title,
  periodLabel,
  children,
  footer,
}: {
  kicker?: string;
  title: string;
  periodLabel: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <article className="space-y-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#4F46E5]">{kicker}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{periodLabel}</p>
        </div>
        <div className="text-right text-xs text-slate-400">
          <p>Prepared for the executive team</p>
          <p>Generated {prettyDate(todayIso())}</p>
        </div>
      </header>
      {children}
      {footer ? <footer className="border-t border-slate-200 pt-4 text-[11px] text-slate-400">{footer}</footer> : null}
    </article>
  );
}
