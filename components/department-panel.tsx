"use client";

/**
 * DepartmentPanel — one collapsible department card on the executive board.
 *
 * The colored header (department accent) is always visible and acts as the
 * toggle. Collapsed → just the title bar. Expanded → the KPI strip plus, when
 * provided, a `children` slot holding the rich detail (pipeline strip, tables,
 * charts) that the server passes in.
 *
 * The daily-driver departments default to expanded; the rest default to a
 * title-only bar. Open/closed state is persisted to localStorage per panel so
 * the board remembers how the user left it.
 *
 * The page is a Server Component that fetches data and passes server-rendered
 * detail as `children` (the interleaving pattern) — this client wrapper only
 * owns the toggle state.
 */

import type { Kpi } from "@/lib/dashboard-snapshots";
import { usePersistentState } from "@/lib/use-persistent-state";

// Bumped to _v2_ so stale per-panel state from the earlier "collapsed by
// default" board is discarded — every panel now starts open, and only
// collapses the user makes from here on are remembered.
const STORAGE_PREFIX = "km_board_v2_";

export function DepartmentPanel({
  panelKey,
  label,
  accent,
  index,
  kpis,
  defaultExpanded,
  children,
}: {
  panelKey: string;
  label: string;
  accent: string;
  /** 1-based position shown before the title. Omit for the Executive panel. */
  index?: number;
  kpis: Kpi[];
  defaultExpanded: boolean;
  /** Rich detail revealed when expanded. Omit for KPI-only panels. */
  children?: React.ReactNode;
}) {
  // Persisted per panel; falls back to defaultExpanded until the user toggles.
  const [expanded, setExpanded] = usePersistentState<boolean>(
    `${STORAGE_PREFIX}${panelKey}`,
    defaultExpanded,
    (raw) => (raw === "1" ? true : raw === "0" ? false : defaultExpanded),
    (value) => (value ? "1" : "0"),
  );

  const toggle = () => setExpanded((prev) => !prev);

  return (
    <section className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-sm">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-white"
        style={{ backgroundColor: accent }}
      >
        <h2 className="text-sm font-semibold tracking-tight">
          {index != null && <span className="opacity-70">{index}. </span>}
          <span className="uppercase">{label}</span>
        </h2>
        <span aria-hidden className="shrink-0 text-xs font-medium text-white/90">
          {expanded ? "Collapse ▴" : "Expand ▾"}
        </span>
      </button>

      {expanded && (
        <div className="p-4">
          <KpiStrip kpis={kpis} accent={accent} />
          {children && <div className="mt-4 border-t border-slate-100 pt-4">{children}</div>}
        </div>
      )}
    </section>
  );
}

function KpiStrip({ kpis, accent }: { kpis: Kpi[]; accent: string }) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${Math.min(kpis.length, 5)}, minmax(0, 1fr))` }}
    >
      {kpis.map((k) => (
        <div key={k.label} className="min-w-0">
          <p className="text-[10px] font-medium uppercase leading-tight tracking-wide text-slate-500">
            {k.label}
          </p>
          <p
            className={`mt-1 text-xl font-semibold tabular-nums ${
              k.soon ? "text-slate-300" : "text-slate-900"
            }`}
            style={!k.soon ? { color: accent } : undefined}
          >
            {k.value}
          </p>
          {k.soon ? (
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
              Coming soon
            </span>
          ) : k.hint ? (
            <span className="text-[10px] text-slate-400">{k.hint}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
