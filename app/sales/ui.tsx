"use client";

/**
 * Small shared pieces for the Intake & Sales pages. Chart colors follow the
 * dataviz reference palette: one blue for single-series bars, a light→dark
 * blue ramp for the ordinal High / Medium / Low case quality, gray for the
 * team comparison, and status colors only on labeled action badges.
 */

import { type ReactNode } from "react";

export const BLUE = "#2a78d6";
export const TEAM_GRAY = "#8f8e8a";
export const QUALITY_COLOR = { High: "#184f95", Medium: "#5598e7", Low: "#b7d3f6" } as const;

export const DASHBOARD_SINCE = "2026-01-01";

export function fmtPct(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v * 10) / 10}%`;
}

export function fmtNum(v: number | null | undefined): string {
  return v == null ? "—" : v.toLocaleString("en-US");
}

export function Card({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {note ? <span className="text-xs text-slate-500">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

/** Delta vs the previous period, in the text color of its direction. */
export function Delta({ now, prev, unit = "" }: { now: number | null; prev: number | null; unit?: string }) {
  if (now == null || prev == null) return null;
  const d = Math.round((now - prev) * 10) / 10;
  if (d === 0) return <span className="text-slate-500">no change vs prior period</span>;
  return (
    <span className={d > 0 ? "text-emerald-700" : "text-rose-700"}>
      {d > 0 ? "▲" : "▼"} {Math.abs(d)}
      {unit} vs prior period
    </span>
  );
}

/** A labeled horizontal bar; `title` is the hover text. */
export function BarRow({
  label,
  value,
  max,
  right,
  color = BLUE,
  title,
}: {
  label: ReactNode;
  value: number;
  max: number;
  right: ReactNode;
  color?: string;
  title?: string;
}) {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 py-1 text-sm" title={title}>
      <span className="truncate text-slate-700">{label}</span>
      <span className="h-3 rounded-r bg-slate-100">
        <span className="block h-3 rounded-r" style={{ width: `${w}%`, backgroundColor: color }} />
      </span>
      <span className="min-w-[5.5rem] text-right tabular-nums text-slate-700">{right}</span>
    </div>
  );
}

/** Stacked High / Medium / Low bar with a 2px surface gap between segments. */
export function QualityBar({ High, Medium, Low }: { High: number; Medium: number; Low: number }) {
  const total = High + Medium + Low;
  if (!total) return <span className="text-xs text-slate-400">—</span>;
  const parts = (["High", "Medium", "Low"] as const).filter((k) => ({ High, Medium, Low })[k] > 0);
  return (
    <span
      className="inline-flex h-3 w-24 gap-[2px] overflow-hidden rounded align-middle"
      title={`High ${High} · Medium ${Medium} · Low ${Low}`}
    >
      {parts.map((k) => (
        <span
          key={k}
          className="block h-full"
          style={{ width: `${(({ High, Medium, Low })[k] / total) * 100}%`, backgroundColor: QUALITY_COLOR[k] }}
        />
      ))}
    </span>
  );
}

export function QualityLegend() {
  return (
    <span className="inline-flex items-center gap-3 text-xs text-slate-500">
      {(["High", "Medium", "Low"] as const).map((k) => (
        <span key={k} className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: QUALITY_COLOR[k] }} />
          {k}
        </span>
      ))}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Date range                                                                 */
/* -------------------------------------------------------------------------- */

export type DateRange = { from: string; to: string };

function today(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function daysAgo(n: number): string {
  const d = new Date(`${today()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  const s = d.toISOString().slice(0, 10);
  return s < DASHBOARD_SINCE ? DASHBOARD_SINCE : s;
}

export const PRESETS: { key: string; label: string; range: () => DateRange }[] = [
  { key: "ytd", label: "2026 to date", range: () => ({ from: DASHBOARD_SINCE, to: today() }) },
  { key: "month", label: "This month", range: () => ({ from: `${today().slice(0, 7)}-01`, to: today() }) },
  { key: "30", label: "Last 30 days", range: () => ({ from: daysAgo(29), to: today() }) },
  { key: "90", label: "Last 90 days", range: () => ({ from: daysAgo(89), to: today() }) },
];

export function RangePicker({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const active = PRESETS.find((p) => {
    const r = p.range();
    return r.from === value.from && r.to === value.to;
  });
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select
        aria-label="Date range"
        value={active?.key ?? "custom"}
        onChange={(e) => {
          const p = PRESETS.find((x) => x.key === e.target.value);
          if (p) onChange(p.range());
        }}
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
      >
        {PRESETS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom</option>
      </select>
      <input
        type="date"
        aria-label="From"
        min={DASHBOARD_SINCE}
        value={value.from}
        onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
      />
      <span className="text-slate-400">to</span>
      <input
        type="date"
        aria-label="To"
        min={DASHBOARD_SINCE}
        value={value.to}
        onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
      />
    </div>
  );
}
