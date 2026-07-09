"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { MarketingNav } from "@/components/marketing-nav";

type SourceLeakage = {
  source: string;
  leads: number;
  missedFirstContact: number;
  recovered: number;
  lost: number;
  lostRatePct: number;
};

type HourLeakage = { hour: number; firstContacts: number; missed: number; missRatePct: number };

type LostLead = {
  phone: string;
  source: string;
  firstContactAt: string;
  firstContactStatus: "Missed" | "Voicemail";
  firstTimeCaller: boolean;
  attempts: number;
};

type Report = {
  totalLeads: number;
  leadsConnected: number;
  connectRatePct: number;
  missedFirstContact: number;
  recovered: number;
  recoveredRatePct: number;
  lost: number;
  lostRatePct: number;
  firstTimeCallerLost: number;
  afterHoursLost: number;
  estimatedLostValue: number;
  avgCaseValue: number;
  expectedSignRate: number;
  bySource: SourceLeakage[];
  byHour: HourLeakage[];
  lostLeads: LostLead[];
};

type RecoveryStatus = "new" | "called_back" | "reached" | "dead";
type RecoveryRow = { phone: string; status: RecoveryStatus; notes: string | null };
type Snapshot = {
  snapshot_date: string;
  lost: number;
  recovered: number;
  missed_first_contact: number;
  connect_rate_pct: number;
  estimated_lost_value: number;
};

const BORDER = "#e2e8f0";

const STATUS_META: Record<RecoveryStatus, { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-slate-100 text-slate-700 ring-slate-300" },
  called_back: { label: "Called back", cls: "bg-amber-100 text-amber-800 ring-amber-300" },
  reached: { label: "Reached", cls: "bg-emerald-100 text-emerald-800 ring-emerald-300" },
  dead: { label: "Dead", cls: "bg-zinc-100 text-zinc-500 ring-zinc-300" },
};

function money(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
function fmtHour(h: number): string {
  const ampm = h < 12 ? "am" : "pm";
  return `${h % 12 === 0 ? 12 : h % 12}${ampm}`;
}
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(d);
}
function fmtDay(d: string): string {
  const dt = new Date(`${d}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? d : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(dt);
}
function hoursAgo(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Infinity : (Date.now() - t) / 3_600_000;
}

export default function LeadResponsePage() {
  const [report, setReport] = useState<Report | null>(null);
  const [recovery, setRecovery] = useState<Map<string, RecoveryRow>>(new Map());
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState(90);

  // Worklist filters
  const [recency, setRecency] = useState<"all" | "48h" | "7d">("all");
  const [hideResolved, setHideResolved] = useState(false);

  const loadReport = useCallback(async (d: number) => {
    const res = await fetch(`/api/leads/leakage?days=${d}`, { cache: "no-store" });
    const j = await res.json();
    if (!res.ok) {
      setError(j.error ?? "Failed to load");
      return;
    }
    setReport(j.report as Report);
    setError(null);
  }, []);

  const loadRecovery = useCallback(async () => {
    try {
      const res = await fetch("/api/leads/recovery", { cache: "no-store" });
      const j = await res.json();
      const m = new Map<string, RecoveryRow>();
      for (const r of (j.rows ?? []) as RecoveryRow[]) m.set(r.phone, r);
      setRecovery(m);
    } catch {
      /* recovery overlay is best-effort */
    }
  }, []);

  const loadSnapshots = useCallback(async () => {
    try {
      const res = await fetch("/api/leads/snapshots", { cache: "no-store" });
      const j = await res.json();
      setSnapshots((j.snapshots ?? []) as Snapshot[]);
    } catch {
      /* trend is best-effort */
    }
  }, []);

  useEffect(() => {
    void loadReport(days);
  }, [days, loadReport]);
  useEffect(() => {
    void loadRecovery();
    void loadSnapshots();
  }, [loadRecovery, loadSnapshots]);

  async function runSync() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/calls/sync", { method: "POST" });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) setError(j.error ?? "Sync failed");
      await loadReport(days);
    } finally {
      setBusy(false);
    }
  }

  async function snapshotNow() {
    setBusy(true);
    try {
      await fetch("/api/leads/leakage/snapshot", { method: "POST" });
      await loadSnapshots();
    } finally {
      setBusy(false);
    }
  }

  function statusOf(phone: string): RecoveryStatus {
    return recovery.get(phone)?.status ?? "new";
  }
  function notesOf(phone: string): string {
    return recovery.get(phone)?.notes ?? "";
  }

  async function patchRecovery(phone: string, patch: Partial<RecoveryRow> & { first_lost_at?: string }) {
    // Optimistic update
    setRecovery((prev) => {
      const next = new Map(prev);
      const cur = next.get(phone) ?? { phone, status: "new" as RecoveryStatus, notes: null };
      next.set(phone, { ...cur, ...patch } as RecoveryRow);
      return next;
    });
    try {
      await fetch("/api/leads/recovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, ...patch }),
      });
    } catch {
      setError("Couldn’t save status — check connection");
    }
  }

  const peakLeakHours = useMemo(() => {
    if (!report) return [];
    return [...report.byHour].filter((h) => h.firstContacts > 0).sort((a, b) => b.missed - a.missed).slice(0, 6);
  }, [report]);

  const worklist = useMemo(() => {
    if (!report) return [];
    return report.lostLeads.filter((l) => {
      if (recency === "48h" && hoursAgo(l.firstContactAt) > 48) return false;
      if (recency === "7d" && hoursAgo(l.firstContactAt) > 168) return false;
      if (hideResolved) {
        const s = statusOf(l.phone);
        if (s === "reached" || s === "dead") return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, recency, hideResolved, recovery]);

  // Recovery progress across ALL current lost leads (not just filtered view).
  const progress = useMemo(() => {
    const counts = { new: 0, called_back: 0, reached: 0, dead: 0 };
    for (const l of report?.lostLeads ?? []) counts[statusOf(l.phone)] += 1;
    const worked = counts.called_back + counts.reached + counts.dead;
    return { counts, worked, total: report?.lostLeads.length ?? 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, recovery]);

  const trend = useMemo(() => {
    if (snapshots.length < 1) return null;
    const maxLost = Math.max(1, ...snapshots.map((s) => s.lost));
    const latest = snapshots[snapshots.length - 1];
    const prev = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;
    const delta = prev ? latest.lost - prev.lost : null;
    return { maxLost, latest, delta };
  }, [snapshots]);

  return (
    <div className="min-h-full text-slate-900" style={{ backgroundColor: "#ffffff", fontFamily: "Arial, Helvetica, sans-serif" }}>
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Lead response</h1>
            <p className="mt-1 text-sm text-slate-500">
              Where inbound leads leak — and a worklist to recover the ones we missed
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-sm text-slate-900">
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={180}>Last 180 days</option>
              <option value={365}>Last 12 months</option>
            </select>
            <button onClick={() => void runSync()} disabled={busy} className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-[#1369c4] disabled:opacity-50">
              {busy ? "Working…" : "Sync from CallRail"}
            </button>
          </div>
        </div>

        {error ? <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">{error}</div> : null}

        {/* KPI row */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <article className="rounded-xl border border-white/5 p-5 shadow-sm" style={{ backgroundColor: "#116AB2" }}>
            <p className="text-sm font-medium text-white/90">Total leads</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums text-white">{report?.totalLeads ?? "—"}</p>
            <p className="mt-1 text-xs text-white/70">unique callers</p>
          </article>
          <article className="rounded-xl border border-white/5 p-5 shadow-sm" style={{ backgroundColor: "#166534" }}>
            <p className="text-sm font-medium text-white/90">Connect rate</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums text-white">{report ? `${report.connectRatePct}%` : "—"}</p>
            <p className="mt-1 text-xs text-white/70">{report ? `${report.leadsConnected} of ${report.totalLeads} ever connected` : ""}</p>
          </article>
          <article className="rounded-xl border border-white/5 p-5 shadow-sm" style={{ backgroundColor: "#b45309" }}>
            <p className="text-sm font-medium text-white/90">Missed first contact</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums text-white">{report?.missedFirstContact ?? "—"}</p>
            <p className="mt-1 text-xs text-white/70">{report ? `${report.recovered} recovered (${report.recoveredRatePct}%)` : ""}</p>
          </article>
          <article className="rounded-xl border border-white/5 p-5 shadow-sm" style={{ backgroundColor: "#b91c1c" }}>
            <p className="text-sm font-medium text-white/90">Lost leads</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums text-white">{report?.lost ?? "—"}</p>
            <p className="mt-1 text-xs text-white/70">{report ? `${report.firstTimeCallerLost} first-time · ${report.afterHoursLost} after-hours` : ""}</p>
          </article>
          <article className="rounded-xl border border-white/5 p-5 shadow-sm" style={{ backgroundColor: "#7c2d12" }}>
            <p className="text-sm font-medium text-white/90">Est. lost value</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums text-white">{report ? money(report.estimatedLostValue) : "—"}</p>
            <p className="mt-1 text-xs text-white/70">signed-case value at risk</p>
          </article>
        </section>

        {/* Trend + recovery progress */}
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border p-6 shadow-sm" style={{ backgroundColor: "#ffffff", borderColor: BORDER }}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Lost-lead trend</h2>
              <button onClick={() => void snapshotNow()} disabled={busy} className="rounded-md border border-[#e2e8f0] px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                Snapshot now
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">Weekly 30-day-window snapshots. Lower is better.</p>
            {trend ? (
              <>
                <div className="mt-4 flex h-24 items-end gap-1">
                  {snapshots.map((s) => (
                    <div key={s.snapshot_date} className="flex flex-1 flex-col items-center gap-1" title={`${s.snapshot_date}: ${s.lost} lost · ${money(s.estimated_lost_value)}`}>
                      <div className="w-full rounded-t bg-rose-400" style={{ height: `${Math.max(4, (s.lost / trend.maxLost) * 80)}px` }} />
                      <span className="text-[10px] text-slate-400">{fmtDay(s.snapshot_date)}</span>
                    </div>
                  ))}
                </div>
                {trend.delta != null ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Latest: <span className="font-medium text-slate-700">{trend.latest.lost} lost</span>{" "}
                    {trend.delta === 0 ? "(flat vs prior)" : trend.delta < 0 ? (
                      <span className="text-emerald-700">▼ {Math.abs(trend.delta)} vs prior week</span>
                    ) : (
                      <span className="text-rose-700">▲ {trend.delta} vs prior week</span>
                    )}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-4 text-sm text-slate-400">
                Trend builds weekly. Click “Snapshot now” to seed the first data point.
              </p>
            )}
          </div>

          <div className="rounded-xl border p-6 shadow-sm" style={{ backgroundColor: "#ffffff", borderColor: BORDER }}>
            <h2 className="text-sm font-semibold text-slate-900">Recovery progress</h2>
            <p className="mt-1 text-xs text-slate-500">
              {progress.worked} of {progress.total} lost leads worked
            </p>
            <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress.total ? (progress.worked / progress.total) * 100 : 0}%` }} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(["new", "called_back", "reached", "dead"] as RecoveryStatus[]).map((s) => (
                <div key={s} className="rounded-lg border p-3 text-center" style={{ borderColor: BORDER }}>
                  <p className="text-2xl font-semibold tabular-nums text-slate-900">{progress.counts[s]}</p>
                  <p className="mt-1 text-xs text-slate-500">{STATUS_META[s].label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Leakage by source + worst hours */}
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border p-6 shadow-sm" style={{ backgroundColor: "#ffffff", borderColor: BORDER }}>
            <h2 className="text-sm font-semibold text-slate-900">Leakage by source</h2>
            <p className="mt-1 text-xs text-slate-500">Paid sources at the top are the most expensive to leak.</p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b text-slate-500" style={{ borderColor: BORDER }}>
                    <th className="pb-2 pr-3 font-medium">Source</th>
                    <th className="pb-2 pr-3 font-medium text-right">Leads</th>
                    <th className="pb-2 pr-3 font-medium text-right">Missed</th>
                    <th className="pb-2 pr-3 font-medium text-right">Recovered</th>
                    <th className="pb-2 font-medium text-right">Lost</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700">
                  {(report?.bySource ?? []).map((s) => (
                    <tr key={s.source} className="border-b border-[#e2e8f0]/60 last:border-0">
                      <td className="py-2 pr-3 font-medium text-slate-900">{s.source}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{s.leads}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{s.missedFirstContact}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-emerald-700">{s.recovered}</td>
                      <td className="py-2 text-right tabular-nums font-semibold text-rose-700">
                        {s.lost} <span className="text-xs font-normal text-slate-400">({s.lostRatePct}%)</span>
                      </td>
                    </tr>
                  ))}
                  {report && report.bySource.length === 0 ? (
                    <tr><td colSpan={5} className="py-4 text-center text-slate-400">No leads in window</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border p-6 shadow-sm" style={{ backgroundColor: "#ffffff", borderColor: BORDER }}>
            <h2 className="text-sm font-semibold text-slate-900">Worst hours for missed leads</h2>
            <p className="mt-1 text-xs text-slate-500">Firm-local time. High miss-rate hours are where coverage pays for itself.</p>
            <div className="mt-4 space-y-2">
              {peakLeakHours.map((h) => (
                <div key={h.hour} className="flex items-center gap-3">
                  <span className="w-14 text-sm tabular-nums text-slate-600">{fmtHour(h.hour)}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-rose-500" style={{ width: `${Math.min(100, h.missRatePct)}%` }} />
                  </div>
                  <span className="w-28 text-right text-xs tabular-nums text-slate-500">{h.missed}/{h.firstContacts} ({h.missRatePct}%)</span>
                </div>
              ))}
              {report && peakLeakHours.length === 0 ? <p className="text-sm text-slate-400">No data in window</p> : null}
            </div>
          </div>
        </section>

        {/* Recovery worklist */}
        <section className="rounded-xl border p-6 shadow-sm" style={{ backgroundColor: "#ffffff", borderColor: BORDER }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Recovery worklist</h2>
              <p className="mt-1 text-xs text-slate-500">
                Callers whose first contact never connected and who never called back. Call them back — set status as you work each one.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select value={recency} onChange={(e) => setRecency(e.target.value as typeof recency)} className="rounded-lg border border-[#e2e8f0] bg-white px-2 py-1.5 text-xs text-slate-900">
                <option value="all">All in window</option>
                <option value="48h">Last 48 hours</option>
                <option value="7d">Last 7 days</option>
              </select>
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={hideResolved} onChange={(e) => setHideResolved(e.target.checked)} />
                Hide reached/dead
              </label>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b text-slate-500" style={{ borderColor: BORDER }}>
                  <th className="pb-2 pr-3 font-medium">Phone</th>
                  <th className="pb-2 pr-3 font-medium">Source</th>
                  <th className="pb-2 pr-3 font-medium">First contact</th>
                  <th className="pb-2 pr-3 font-medium">First-time</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                  <th className="pb-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {worklist.slice(0, 200).map((l, i) => {
                  const status = statusOf(l.phone);
                  return (
                    <tr key={`${l.phone}-${i}`} className="border-b border-[#e2e8f0]/60 last:border-0">
                      <td className="py-2 pr-3 font-medium tabular-nums text-slate-900">{l.phone}</td>
                      <td className="py-2 pr-3">{l.source}</td>
                      <td className="py-2 pr-3 text-slate-500">
                        {fmtDateTime(l.firstContactAt)}
                        <span className="ml-2 inline-flex rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium text-rose-700 ring-1 ring-rose-500/30">{l.firstContactStatus}</span>
                      </td>
                      <td className="py-2 pr-3">{l.firstTimeCaller ? "Yes" : "—"}</td>
                      <td className="py-2 pr-3">
                        <select
                          value={status}
                          onChange={(e) => void patchRecovery(l.phone, { status: e.target.value as RecoveryStatus, first_lost_at: l.firstContactAt })}
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${STATUS_META[status].cls}`}
                        >
                          <option value="new">New</option>
                          <option value="called_back">Called back</option>
                          <option value="reached">Reached</option>
                          <option value="dead">Dead</option>
                        </select>
                      </td>
                      <td className="py-2">
                        <input
                          defaultValue={notesOf(l.phone)}
                          onBlur={(e) => {
                            if (e.target.value !== notesOf(l.phone)) void patchRecovery(l.phone, { notes: e.target.value, first_lost_at: l.firstContactAt });
                          }}
                          placeholder="Add note…"
                          className="w-full rounded border border-[#e2e8f0] bg-white px-2 py-1 text-xs text-slate-900 placeholder:text-slate-400"
                        />
                      </td>
                    </tr>
                  );
                })}
                {report && worklist.length === 0 ? (
                  <tr><td colSpan={6} className="py-4 text-center text-slate-400">Nothing to work in this view 🎉</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Note: CallRail doesn’t expose ring-time, so this is connection leakage (missed/voicemail with no later connect), not seconds-to-answer.
            Est. lost value uses your practice-area economics{report ? ` (${money(report.avgCaseValue)} × ${Math.round(report.expectedSignRate * 100)}%)` : ""}.
          </p>
        </section>
      </main>
    </div>
  );
}
