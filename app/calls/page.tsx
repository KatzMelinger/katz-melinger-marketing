"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { MarketingNav } from "@/components/marketing-nav";
import {
  bySource,
  callStatus,
  computeCallStats,
  isIsoDate,
  monthToDate,
  needsCallback,
  sourceLabel,
  type CallStatsRow,
  type CallStatus,
  type RecoveryRow,
  type RecoveryStatus,
} from "@/lib/calls-stats";

type ScoreRow = {
  overall_score: number | null;
  rubric_type: string | null;
  language: string | null;
  scored_at: string | null;
};

type CallRow = CallStatsRow & {
  customer_name: string | null;
  customer_phone_number: string | null;
  source_name: string | null;
  duration: number | null;
  lead_status: string | null;
  agent_email?: string | null;
  transcription_language?: string | null;
  score?: ScoreRow | null;
};

type CallsResponse = { calls?: CallRow[]; error?: string; source?: string; hint?: string };

function formatDurationSeconds(total: number): string {
  if (!Number.isFinite(total) || total < 0) return "—";
  const rounded = Math.round(total);
  const m = Math.floor(rounded / 60);
  const s = rounded % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function formatStartTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

const STATUS_BADGE: Record<CallStatus, { bg: string; ring: string; fg: string; label: string }> = {
  Answered: { bg: "bg-emerald-500/20", ring: "ring-emerald-500/30", fg: "text-emerald-300", label: "Answered" },
  "In progress": { bg: "bg-sky-500/20", ring: "ring-sky-500/30", fg: "text-sky-700", label: "Ringing/in progress" },
  Voicemail: { bg: "bg-amber-500/20", ring: "ring-amber-500/30", fg: "text-amber-700", label: "Voicemail" },
  Missed: { bg: "bg-rose-500/20", ring: "ring-rose-500/30", fg: "text-rose-300", label: "Missed" },
};

function scoreBadgeClass(score: number | null | undefined): { color: string; label: string } {
  if (score == null) return { color: "bg-slate-500/20 text-slate-600 ring-slate-500/30", label: "—" };
  if (score >= 85) return { color: "bg-emerald-500/20 text-emerald-300 ring-emerald-500/30", label: `${score}` };
  if (score >= 70) return { color: "bg-blue-500/20 text-blue-300 ring-blue-500/30", label: `${score}` };
  if (score >= 50) return { color: "bg-amber-500/20 text-amber-700 ring-amber-500/30", label: `${score}` };
  return { color: "bg-rose-500/20 text-rose-300 ring-rose-500/30", label: `${score}` };
}

const RECOVERY_LABEL: Record<RecoveryStatus, string> = {
  new: "New",
  called_back: "Called back",
  reached: "Reached",
  dead: "Dead",
};

async function fetchRange(f: string, t: string): Promise<CallsResponse & { ok: boolean }> {
  const params = new URLSearchParams();
  if (f) params.set("from", f);
  if (t) params.set("to", t);
  const res = await fetch(`/api/calls?${params.toString()}`, { cache: "no-store" });
  const data = (await res.json()) as CallsResponse;
  return { ...data, ok: res.ok };
}

export default function CallsPage() {
  const router = useRouter();
  const [initialRange] = useState(() => monthToDate(Date.now()));
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [monthCalls, setMonthCalls] = useState<CallRow[] | null>(null);
  const [recovery, setRecovery] = useState<Map<string, RecoveryRow>>(new Map());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [src, setSrc] = useState("all");
  const [status, setStatus] = useState<"all" | "answered" | "voicemail" | "missed" | "in_progress">("all");
  const [language, setLanguage] = useState<"all" | "en" | "es" | "mixed" | "unknown">("all");

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true);
    try {
      const data = await fetchRange(f, t);
      setNowMs(Date.now());
      if (!data.ok) {
        setError(data.error ?? "Failed to load calls");
        return;
      }
      setError(data.error ?? null);
      setCalls(Array.isArray(data.calls) ? data.calls : []);
      setSource(data.source ?? null);
      setHint(data.hint ?? null);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  // The callback list always covers the current month to date, whatever the
  // date pickers say (spec 8.4).
  const loadMonth = useCallback(async () => {
    try {
      const mtd = monthToDate(Date.now());
      const data = await fetchRange(mtd.from, mtd.to);
      if (data.ok) setMonthCalls(Array.isArray(data.calls) ? data.calls : []);
    } catch {
      /* callback list is best-effort */
    }
  }, []);

  const loadRecovery = useCallback(async () => {
    try {
      const res = await fetch("/api/leads/recovery", { cache: "no-store" });
      const j = (await res.json()) as { rows?: RecoveryRow[] };
      const m = new Map<string, RecoveryRow>();
      for (const r of j.rows ?? []) m.set(r.phone, r);
      setRecovery(m);
    } catch {
      /* recovery overlay is best-effort */
    }
  }, []);

  useEffect(() => {
    // A half-typed date input: wait for a full date (an empty one means "default").
    if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) return;
    void load(from, to);
  }, [from, to, load]);

  useEffect(() => {
    void loadMonth();
    void loadRecovery();
  }, [loadMonth, loadRecovery]);

  async function reloadAll() {
    await Promise.all([load(from, to), loadMonth(), loadRecovery()]);
  }

  // A full-history sync is longer than one request may run, so the route
  // saves as it goes and returns { done: false, nextPage } when it stops;
  // keep calling from that page until it reports done.
  const [syncProgress, setSyncProgress] = useState<string | null>(null);
  async function runSync() {
    setBusy(true);
    setError(null);
    let page = 1;
    let synced = 0;
    try {
      for (let round = 0; round < 20; round++) {
        const res = await fetch("/api/calls/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ page }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          synced?: number;
          error?: string;
          done?: boolean;
          nextPage?: number;
          totalPages?: number;
        };
        if (!res.ok) {
          setError(
            res.status === 504
              ? "The sync ran out of time. Calls saved so far are kept; click Sync again to continue."
              : (data.error ?? "Sync failed"),
          );
          break;
        }
        synced += data.synced ?? 0;
        if (data.done !== false || !data.nextPage) break;
        page = data.nextPage;
        setSyncProgress(`Synced ${synced} calls (page ${page - 1} of ${data.totalPages ?? "?"})…`);
      }
      await reloadAll();
    } finally {
      setSyncProgress(null);
      setBusy(false);
    }
  }

  async function runScorePending() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/calls/score-pending", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 25, min_duration_seconds: 60 }),
      });
      const data = (await res.json()) as { scored?: number; error?: string };
      if (!res.ok) setError(data.error ?? "Scoring failed");
      await load(from, to);
    } finally {
      setBusy(false);
    }
  }

  /** Same mechanism as the /lead-response worklist: POST /api/leads/recovery. */
  async function markWorked(phone: string, next: RecoveryStatus, lastTry: string) {
    const hadRow = recovery.has(phone);
    const actedAt = new Date().toISOString();
    setRecovery((prev) => {
      const m = new Map(prev);
      m.set(phone, { ...(m.get(phone) ?? {}), phone, status: next, last_action_at: actedAt });
      return m;
    });
    try {
      const res = await fetch("/api/leads/recovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, status: next, ...(hadRow ? {} : { first_lost_at: lastTry }) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setError("Couldn’t save callback status — check connection");
      void loadRecovery();
    }
  }

  const sources = useMemo(() => {
    const m = new Set<string>();
    for (const c of calls) m.add(sourceLabel(c));
    return [...m].sort((a, b) => a.localeCompare(b));
  }, [calls]);

  // Table filters only. The stat cards use `calls` — every call in the range —
  // so switching the status filter never moves the answered rate (spec 8.1).
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return calls.filter((c) => {
      const st = callStatus(c, nowMs);
      if (status === "answered" && st !== "Answered") return false;
      if (status === "voicemail" && st !== "Voicemail") return false;
      if (status === "missed" && st !== "Missed") return false;
      if (status === "in_progress" && st !== "In progress") return false;
      if (language !== "all" && (c.transcription_language ?? "unknown") !== language) return false;
      if (src !== "all" && sourceLabel(c) !== src) return false;
      if (!qq) return true;
      const name = (c.customer_name ?? "").toLowerCase();
      const phone = (c.customer_phone_number ?? "").toLowerCase();
      const agent = (c.agent_email ?? "").toLowerCase();
      return name.includes(qq) || phone.includes(qq) || agent.includes(qq);
    });
  }, [calls, q, src, status, language, nowMs]);

  const stats = useMemo(() => computeCallStats(calls, nowMs), [calls, nowMs]);
  const sourceTable = useMemo(() => bySource(calls, nowMs), [calls, nowMs]);
  const callbacks = useMemo(
    () => (monthCalls ? needsCallback(monthCalls, recovery, nowMs) : []),
    [monthCalls, recovery, nowMs],
  );

  const totalCalls = stats.total;
  const answered = stats.answered;
  const voicemails = stats.voicemail;
  const missed = stats.missed;
  const answeredRate = stats.answeredRatePct;
  const avgDuration = stats.avgDurationSeconds;
  const avgScore = stats.avgScore;

  return (
    <div
      className="min-h-full text-slate-900"
      style={{ backgroundColor: "#ffffff", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Call tracking</h1>
            <p className="mt-1 text-sm text-slate-500">
              CallRail call log with AI sales-coach scoring against the firm&apos;s SOPs
              {source ? ` · source: ${source}` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void runSync()}
              disabled={busy}
              className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-[#1369c4] disabled:opacity-50"
            >
              {syncProgress ?? (busy ? "Working…" : "Sync from CallRail")}
            </button>
            <button
              onClick={() => void runScorePending()}
              disabled={busy}
              className="rounded-lg border border-brand bg-transparent px-3 py-2 text-sm font-medium text-brand hover:bg-slate-50 disabled:opacity-50"
            >
              Score pending
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        ) : null}
        {hint ? (
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">
            {hint}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <article className="rounded-xl border border-white/5 p-5 shadow-sm" style={{ backgroundColor: "#116AB2" }}>
            <p className="text-sm font-medium text-white/90">Total calls</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{loading ? "…" : totalCalls}</p>
            <p className="mt-1 text-xs text-white/70">
              {from || "month start"} to {to || "today"} · all statuses
            </p>
          </article>
          <article className="rounded-xl border border-white/5 p-5 shadow-sm" style={{ backgroundColor: "#166534" }}>
            <p className="text-sm font-medium text-white/90">Answered rate</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{answeredRate}%</p>
            <p className="mt-1 text-xs text-white/70">
              {answered} answered · {voicemails} VM · {missed} missed
              {stats.inProgress ? ` · ${stats.inProgress} ringing` : ""}
            </p>
          </article>
          <article className="rounded-xl border border-white/5 p-5 shadow-sm" style={{ backgroundColor: "#475569" }}>
            <p className="text-sm font-medium text-white/90">Avg duration</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{formatDurationSeconds(avgDuration)}</p>
          </article>
          <article className="rounded-xl border border-white/5 p-5 shadow-sm" style={{ backgroundColor: "#7c3aed" }}>
            <p className="text-sm font-medium text-white/90">Avg coach score</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{avgScore != null ? avgScore : "—"}</p>
            <p className="mt-1 text-xs text-white/70">{stats.scored} of {totalCalls} scored</p>
          </article>
          <article className="rounded-xl border border-white/5 p-5 shadow-sm" style={{ backgroundColor: "#0f4c75" }}>
            <p className="text-sm font-medium text-white/90">Voicemails</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{voicemails}</p>
          </article>
        </section>

        <section
          className="rounded-xl border border-[#e2e8f0] p-4 shadow-sm sm:p-6"
          style={{ backgroundColor: "#ffffff" }}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <input
              className="rounded-lg border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500"
              placeholder="Search name, phone, agent"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <input
              type="date"
              aria-label="From date"
              title="From (drives the stat cards and the table)"
              className="rounded-lg border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-sm text-slate-900"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <input
              type="date"
              aria-label="To date"
              title="To (drives the stat cards and the table)"
              className="rounded-lg border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-sm text-slate-900"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <select
              className="rounded-lg border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-sm text-slate-900"
              value={src}
              onChange={(e) => setSrc(e.target.value)}
            >
              <option value="all">All sources</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className="rounded-lg border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-sm text-slate-900"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="all">All statuses</option>
              <option value="answered">Answered</option>
              <option value="voicemail">Voicemail</option>
              <option value="missed">Missed</option>
              <option value="in_progress">Ringing/in progress</option>
            </select>
            <select
              className="rounded-lg border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-sm text-slate-900"
              value={language}
              onChange={(e) => setLanguage(e.target.value as typeof language)}
            >
              <option value="all">All languages</option>
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="mixed">Mixed</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
        </section>

        <section
          className="rounded-xl border border-[#e2e8f0] p-6 shadow-sm"
          style={{ backgroundColor: "#ffffff" }}
        >
          <h2 className="text-base font-semibold text-slate-900">Needs callback</h2>
          <p className="mt-1 text-sm text-slate-500">
            Callers this month whose latest missed or voicemail call was not followed by an answered call.
            Always covers the current month to date, whatever the dates above say. Marking someone called
            back, reached or dead removes them (same status as the{" "}
            <Link href="/lead-response" className="text-brand hover:underline">
              lead-response
            </Link>{" "}
            worklist).
          </p>
          {monthCalls == null ? (
            <p className="mt-4 text-sm text-slate-500">Loading…</p>
          ) : callbacks.length === 0 ? (
            <p className="mt-4 text-sm text-emerald-700">Nobody is waiting on a callback.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[#e2e8f0] text-slate-500">
                    <th className="pb-3 pr-4 font-medium">Name</th>
                    <th className="pb-3 pr-4 font-medium">Phone</th>
                    <th className="pb-3 pr-4 font-medium">Last try</th>
                    <th className="pb-3 pr-4 font-medium">Tries</th>
                    <th className="pb-3 pr-4 font-medium">Source</th>
                    <th className="pb-3 pr-4 font-medium">Caller</th>
                    <th className="pb-3 font-medium">Mark as worked</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700">
                  {callbacks.map((cb) => {
                    const current = recovery.get(cb.phone)?.status;
                    return (
                      <tr key={cb.phone} className="border-b border-[#e2e8f0]/60 last:border-0">
                        <td className="py-3 pr-4 font-medium text-slate-900">{cb.name}</td>
                        <td className="py-3 pr-4 tabular-nums text-slate-600">
                          <a href={`tel:${cb.phone}`} className="hover:underline">
                            {cb.displayPhone}
                          </a>
                        </td>
                        <td className="py-3 pr-4 text-slate-500">
                          {formatStartTime(cb.lastTry)}
                          <span className="ml-1 text-xs text-slate-400">({cb.lastStatus})</span>
                        </td>
                        <td className="py-3 pr-4 tabular-nums">{cb.tries}</td>
                        <td className="py-3 pr-4">{cb.source}</td>
                        <td className="py-3 pr-4">{cb.firstTime ? "First-time" : "Repeat"}</td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-1">
                            {(["called_back", "reached", "dead"] as const).map((st) => (
                              <button
                                key={st}
                                onClick={() => void markWorked(cb.phone, st, cb.lastTry)}
                                className="rounded-md border border-[#e2e8f0] px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                              >
                                {RECOVERY_LABEL[st]}
                              </button>
                            ))}
                          </div>
                          {current && current !== "new" ? (
                            <p className="mt-1 text-xs text-slate-400">
                              Was {RECOVERY_LABEL[current].toLowerCase()} before this call
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section
          className="rounded-xl border border-[#e2e8f0] p-6 shadow-sm"
          style={{ backgroundColor: "#ffffff" }}
        >
          <h2 className="text-base font-semibold text-slate-900">Calls and share unanswered by source</h2>
          <p className="mt-1 text-sm text-slate-500">
            Inbound calls in the selected date range, by CallRail marketing source. Unanswered = missed or
            voicemail. &quot;(tracking line)&quot; rows have no marketing source on record yet.
          </p>
          {sourceTable.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No inbound calls in this range.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[#e2e8f0] text-slate-500">
                    <th className="pb-3 pr-4 font-medium">Source</th>
                    <th className="pb-3 pr-4 text-right font-medium">Calls</th>
                    <th className="pb-3 pr-4 text-right font-medium">Answered</th>
                    <th className="pb-3 pr-4 text-right font-medium">Unanswered</th>
                    <th className="pb-3 text-right font-medium">Share unanswered</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700">
                  {sourceTable.map((r) => (
                    <tr key={r.source} className="border-b border-[#e2e8f0]/60 last:border-0">
                      <td className="py-2 pr-4">{r.source}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{r.calls}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{r.answered}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{r.unanswered}</td>
                      <td className="py-2 text-right tabular-nums">{r.unansweredPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section
          className="rounded-xl border border-[#e2e8f0] p-6 shadow-sm"
          style={{ backgroundColor: "#ffffff" }}
        >
          <p className="mb-3 text-xs text-slate-500">
            Showing {filtered.length} of {totalCalls} calls in range
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#e2e8f0] text-slate-500">
                  <th className="pb-3 pr-4 font-medium">Caller</th>
                  <th className="pb-3 pr-4 font-medium">Phone</th>
                  <th className="pb-3 pr-4 font-medium">Source</th>
                  <th className="pb-3 pr-4 font-medium">Duration</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 pr-4 font-medium">Lang</th>
                  <th className="pb-3 pr-4 font-medium">Score</th>
                  <th className="pb-3 pr-4 font-medium">Lead</th>
                  <th className="pb-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {filtered.map((row) => {
                  const callerName = row.customer_name?.trim() || "Unknown caller";
                  const callerNumber = row.customer_phone_number?.trim() || "—";
                  const srcLabel = sourceLabel(row);
                  const duration =
                    row.duration == null || row.duration < 0 ? "—" : formatDurationSeconds(row.duration);
                  const st = callStatus(row, nowMs);
                  const stBadge = STATUS_BADGE[st];
                  const score = row.score?.overall_score ?? null;
                  const sb = scoreBadgeClass(score);
                  const lang = row.transcription_language ?? "—";
                  return (
                    <tr
                      key={row.id}
                      onClick={() => router.push(`/calls/${encodeURIComponent(row.id)}`)}
                      className="border-b border-[#e2e8f0]/60 last:border-0 hover:bg-[#f1f5f9] cursor-pointer"
                    >
                      <td className="py-3 pr-4 font-medium text-slate-900">
                        <Link
                          href={`/calls/${encodeURIComponent(row.id)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:underline"
                        >
                          {callerName}
                        </Link>
                      </td>
                      <td className="py-3 pr-4 tabular-nums text-slate-600">{callerNumber}</td>
                      <td className="py-3 pr-4">{srcLabel}</td>
                      <td className="py-3 pr-4 tabular-nums">{duration}</td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${stBadge.bg} ${stBadge.fg} ${stBadge.ring}`}
                        >
                          {stBadge.label}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-xs uppercase text-slate-500">{lang}</td>
                      <td className="py-3 pr-4">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${sb.color}`}>
                          {sb.label}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-slate-500">{row.lead_status?.trim() || "—"}</td>
                      <td className="py-3 text-slate-500">{formatStartTime(row.start_time)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
