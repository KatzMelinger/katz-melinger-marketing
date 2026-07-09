"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { MarketingNav } from "@/components/marketing-nav";

type ScoreRow = {
  overall_score: number | null;
  rubric_type: string | null;
  language: string | null;
  scored_at: string | null;
};

type CallRow = {
  id: string;
  customer_name: string | null;
  customer_phone_number: string | null;
  source_name: string | null;
  duration: number | null;
  answered: boolean;
  voicemail?: boolean;
  direction?: string | null;
  start_time: string;
  lead_status: string | null;
  agent_email?: string | null;
  transcription_language?: string | null;
  score?: ScoreRow | null;
};

type CallStatus = "Answered" | "Voicemail" | "Missed";

function callStatus(row: Pick<CallRow, "answered" | "voicemail">): CallStatus {
  if (row.voicemail === true) return "Voicemail";
  if (row.answered === true) return "Answered";
  return "Missed";
}

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

export default function CallsPage() {
  const router = useRouter();
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [src, setSrc] = useState("all");
  const [status, setStatus] = useState<"all" | "answered" | "voicemail" | "missed">("all");
  const [language, setLanguage] = useState<"all" | "en" | "es" | "mixed" | "unknown">("all");

  async function load() {
    try {
      const res = await fetch("/api/calls", { cache: "no-store" });
      const data = (await res.json()) as { calls?: CallRow[]; error?: string; source?: string; hint?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to load calls");
        return;
      }
      setCalls(Array.isArray(data.calls) ? data.calls : []);
      setSource(data.source ?? null);
      setHint(data.hint ?? null);
      if (data.error) setError(data.error);
    } catch {
      setError("Network error");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function runSync() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/calls/sync", { method: "POST" });
      const data = (await res.json()) as { synced?: number; error?: string };
      if (!res.ok) setError(data.error ?? "Sync failed");
      await load();
    } finally {
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
      await load();
    } finally {
      setBusy(false);
    }
  }

  const sources = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of calls) {
      const s = c.source_name?.trim() || "Unknown";
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return [...m.keys()].sort((a, b) => a.localeCompare(b));
  }, [calls]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const fromD = from ? new Date(`${from}T00:00:00`) : null;
    const toD = to ? new Date(`${to}T23:59:59`) : null;
    return calls.filter((c) => {
      const st = callStatus(c);
      if (status === "answered" && st !== "Answered") return false;
      if (status === "voicemail" && st !== "Voicemail") return false;
      if (status === "missed" && st !== "Missed") return false;
      if (language !== "all" && (c.transcription_language ?? "unknown") !== language) return false;
      if (src !== "all") {
        const s = c.source_name?.trim() || "Unknown";
        if (s !== src) return false;
      }
      const t = new Date(c.start_time);
      if (fromD && !Number.isNaN(fromD.getTime()) && t < fromD) return false;
      if (toD && !Number.isNaN(toD.getTime()) && t > toD) return false;
      if (!qq) return true;
      const name = (c.customer_name ?? "").toLowerCase();
      const phone = (c.customer_phone_number ?? "").toLowerCase();
      const agent = (c.agent_email ?? "").toLowerCase();
      return name.includes(qq) || phone.includes(qq) || agent.includes(qq);
    });
  }, [calls, q, from, to, src, status, language]);

  const totalCalls = filtered.length;
  const answered = filtered.filter((c) => callStatus(c) === "Answered").length;
  const voicemails = filtered.filter((c) => callStatus(c) === "Voicemail").length;
  const missed = filtered.filter((c) => callStatus(c) === "Missed").length;
  const answeredRate = totalCalls ? Math.round((answered / totalCalls) * 1000) / 10 : 0;
  const durSum = filtered.reduce((s, c) => s + (c.duration ?? 0), 0);
  const avgDuration = totalCalls ? durSum / totalCalls : 0;
  const scored = filtered.filter((c) => c.score?.overall_score != null);
  const avgScore = scored.length
    ? Math.round(scored.reduce((s, c) => s + (c.score?.overall_score ?? 0), 0) / scored.length)
    : null;

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
              {busy ? "Working…" : "Sync from CallRail"}
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
            <p className="text-sm font-medium text-white/90">Total (filtered)</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{totalCalls}</p>
          </article>
          <article className="rounded-xl border border-white/5 p-5 shadow-sm" style={{ backgroundColor: "#166534" }}>
            <p className="text-sm font-medium text-white/90">Answered rate</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{answeredRate}%</p>
            <p className="mt-1 text-xs text-white/70">
              {answered} answered · {voicemails} VM · {missed} missed
            </p>
          </article>
          <article className="rounded-xl border border-white/5 p-5 shadow-sm" style={{ backgroundColor: "#475569" }}>
            <p className="text-sm font-medium text-white/90">Avg duration</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{formatDurationSeconds(avgDuration)}</p>
          </article>
          <article className="rounded-xl border border-white/5 p-5 shadow-sm" style={{ backgroundColor: "#7c3aed" }}>
            <p className="text-sm font-medium text-white/90">Avg coach score</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{avgScore != null ? avgScore : "—"}</p>
            <p className="mt-1 text-xs text-white/70">{scored.length} of {totalCalls} scored</p>
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
              className="rounded-lg border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-sm text-slate-900"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <input
              type="date"
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
                  const sourceLabel = row.source_name?.trim() || "—";
                  const duration =
                    row.duration == null || row.duration < 0 ? "—" : formatDurationSeconds(row.duration);
                  const st = callStatus(row);
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
                      <td className="py-3 pr-4">{sourceLabel}</td>
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
