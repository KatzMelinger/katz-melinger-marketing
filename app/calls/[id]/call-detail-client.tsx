"use client";

import { useCallback, useEffect, useState } from "react";

type Call = {
  id: string;
  customer_name: string | null;
  customer_phone_number: string | null;
  duration: number | null;
  answered: boolean;
  voicemail: boolean;
  direction: string | null;
  source_name: string | null;
  start_time: string | null;
  agent_email: string | null;
  recording_url: string | null;
  recording_player_url: string | null;
  transcription: string | null;
  transcription_language: string | null;
  lead_status: string | null;
};

type DimensionScore = {
  dimension_key: string;
  dimension_name: string;
  score: number;
  max: number;
  evidence: string;
  missed: string;
  do_better: string;
};

type ObjectionLogEntry = {
  objection: string;
  response_used: string;
  alignment: string;
  notes: string;
};

type ComplianceFlag = { phrase: string; severity: "low" | "medium" | "high"; excerpt: string };

type Score = {
  id: string;
  call_id: string;
  rubric_type: string;
  language: string;
  overall_score: number | null;
  case_quality_estimate: string | null;
  case_type_detected: string | null;
  dimension_scores: DimensionScore[];
  objections_log: ObjectionLogEntry[];
  compliance_flags: ComplianceFlag[];
  script_recommendations: string[];
  summary_screener: string | null;
  summary_manager: string | null;
  scored_at: string;
};

type ApiResponse = { call: Call; score: Score | null };

function fmtDuration(s: number | null): string {
  if (!s || s < 0) return "—";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${String(r).padStart(2, "0")}s`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

function callStatus(c: Pick<Call, "answered" | "voicemail">): "Answered" | "Voicemail" | "Missed" {
  if (c.voicemail) return "Voicemail";
  if (c.answered) return "Answered";
  return "Missed";
}

const STATUS_COLOR: Record<string, string> = {
  Answered: "bg-emerald-500/20 text-emerald-300 ring-emerald-500/30",
  Voicemail: "bg-amber-500/20 text-amber-200 ring-amber-500/30",
  Missed: "bg-rose-500/20 text-rose-300 ring-rose-500/30",
};

const ALIGN_COLOR: Record<string, string> = {
  matches_1st_attempt: "bg-emerald-500/20 text-emerald-300",
  matches_2nd_attempt: "bg-blue-500/20 text-blue-300",
  matches_last_resort: "bg-amber-500/20 text-amber-200",
  deviated: "bg-rose-500/20 text-rose-300",
  missed: "bg-slate-500/20 text-slate-300",
};

const SEVERITY_COLOR: Record<string, string> = {
  low: "bg-slate-500/20 text-slate-300",
  medium: "bg-amber-500/20 text-amber-200",
  high: "bg-rose-500/20 text-rose-300",
};

function scoreColor(pct: number): string {
  if (pct >= 85) return "text-emerald-300";
  if (pct >= 70) return "text-blue-300";
  if (pct >= 50) return "text-amber-300";
  return "text-rose-300";
}

export function CallDetailClient({ callId }: { callId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"manager" | "screener">("manager");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/calls/${encodeURIComponent(callId)}`, { cache: "no-store" });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setError(e.error ?? `Failed to load (${res.status})`);
        return;
      }
      setData((await res.json()) as ApiResponse);
      setError(null);
    } catch (e) {
      setError((e as Error).message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }, [callId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runScore(rubricType?: "intake" | "consultation") {
    setScoring(true);
    setError(null);
    try {
      const res = await fetch(`/api/calls/${encodeURIComponent(callId)}/score`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(rubricType ? { rubric_type: rubricType } : {}),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setError(e.error ?? `Score failed (${res.status})`);
      }
      await load();
    } finally {
      setScoring(false);
    }
  }

  if (loading) return <p className="text-slate-400">Loading…</p>;
  if (!data) return <p className="text-rose-400">{error ?? "Call not found"}</p>;

  const c = data.call;
  const score = data.score;
  const status = callStatus(c);
  const earned = score?.dimension_scores?.reduce((s, d) => s + d.score, 0) ?? 0;
  const possible = score?.dimension_scores?.reduce((s, d) => s + d.max, 0) ?? 0;

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {error}
        </div>
      ) : null}

      {/* ---- Header card ---- */}
      <section className="rounded-xl border border-[#2a3f5f] p-6" style={{ backgroundColor: "#1a2540" }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-white">{c.customer_name?.trim() || "Unknown caller"}</h1>
            <p className="mt-1 text-sm text-slate-400">
              {c.customer_phone_number ?? "—"} · {fmtDate(c.start_time)} · {fmtDuration(c.duration)} · {c.source_name ?? "—"}
              {c.agent_email ? ` · agent: ${c.agent_email}` : ""}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${STATUS_COLOR[status]}`}>
                {status}
              </span>
              {c.transcription_language ? (
                <span className="inline-flex rounded-full bg-slate-500/20 px-2.5 py-0.5 text-xs uppercase text-slate-300 ring-1 ring-slate-500/30">
                  {c.transcription_language}
                </span>
              ) : null}
              {c.direction ? (
                <span className="inline-flex rounded-full bg-slate-500/20 px-2.5 py-0.5 text-xs uppercase text-slate-300 ring-1 ring-slate-500/30">
                  {c.direction}
                </span>
              ) : null}
              {c.lead_status ? (
                <span className="inline-flex rounded-full bg-blue-500/20 px-2.5 py-0.5 text-xs text-blue-200 ring-1 ring-blue-500/30">
                  Lead: {c.lead_status}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col items-end gap-3">
            {score?.overall_score != null ? (
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-slate-400">Coach score</p>
                <p className={`text-5xl font-bold tabular-nums ${scoreColor(score.overall_score)}`}>{score.overall_score}</p>
                <p className="text-xs text-slate-400">
                  {earned}/{possible} pts · rubric: {score.rubric_type}
                </p>
              </div>
            ) : (
              <p className="text-xs italic text-slate-500">Not scored yet</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => void runScore()}
                disabled={scoring || !c.transcription}
                className="rounded-lg bg-[#185FA5] px-3 py-2 text-xs font-medium text-white hover:bg-[#1369c4] disabled:opacity-50"
              >
                {scoring ? "Scoring…" : score ? "Re-score" : "Score this call"}
              </button>
              {score ? (
                <>
                  <button
                    onClick={() => void runScore("intake")}
                    disabled={scoring}
                    className="rounded-lg border border-[#185FA5] bg-transparent px-3 py-2 text-xs font-medium text-[#5fa1d8] hover:bg-[#1a2540] disabled:opacity-50"
                  >
                    As intake
                  </button>
                  <button
                    onClick={() => void runScore("consultation")}
                    disabled={scoring}
                    className="rounded-lg border border-[#185FA5] bg-transparent px-3 py-2 text-xs font-medium text-[#5fa1d8] hover:bg-[#1a2540] disabled:opacity-50"
                  >
                    As consult
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>

        {c.recording_player_url ? (
          <div className="mt-4">
            <a
              href={c.recording_player_url}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-2 rounded-lg bg-[#0f1729] px-4 py-2 text-sm text-white ring-1 ring-[#2a3f5f] hover:bg-[#172037]"
            >
              ▶ Open CallRail recording
            </a>
          </div>
        ) : null}
      </section>

      {/* ---- Score views ---- */}
      {score ? (
        <>
          <section className="rounded-xl border border-[#2a3f5f] p-6" style={{ backgroundColor: "#1a2540" }}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Coach feedback</h2>
              <div className="flex gap-1 rounded-lg bg-[#0f1729] p-1 ring-1 ring-[#2a3f5f]">
                <button
                  onClick={() => setView("manager")}
                  className={`rounded-md px-3 py-1 text-xs font-medium ${
                    view === "manager" ? "bg-[#185FA5] text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  Manager view
                </button>
                <button
                  onClick={() => setView("screener")}
                  className={`rounded-md px-3 py-1 text-xs font-medium ${
                    view === "screener" ? "bg-[#185FA5] text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  Screener view
                </button>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg bg-[#0f1729] p-4 ring-1 ring-[#2a3f5f]">
                <p className="text-xs uppercase text-slate-400">Case type detected</p>
                <p className="mt-1 text-sm font-medium text-white">{score.case_type_detected ?? "Unclear"}</p>
              </div>
              <div className="rounded-lg bg-[#0f1729] p-4 ring-1 ring-[#2a3f5f]">
                <p className="text-xs uppercase text-slate-400">Case quality</p>
                <p className="mt-1 text-sm font-medium text-white">{score.case_quality_estimate ?? "—"}</p>
              </div>
              <div className="rounded-lg bg-[#0f1729] p-4 ring-1 ring-[#2a3f5f]">
                <p className="text-xs uppercase text-slate-400">Compliance flags</p>
                <p className="mt-1 text-sm font-medium text-white">
                  {score.compliance_flags.length === 0 ? "None" : score.compliance_flags.length}
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-lg bg-[#0f1729] p-4 ring-1 ring-[#2a3f5f]">
              <p className="text-xs uppercase text-slate-400">
                {view === "manager" ? "Manager summary (English)" : `Screener summary (${score.language})`}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-slate-100">
                {(view === "manager" ? score.summary_manager : score.summary_screener) || "—"}
              </p>
            </div>
          </section>

          {/* Rubric dimensions */}
          <section className="rounded-xl border border-[#2a3f5f] p-6" style={{ backgroundColor: "#1a2540" }}>
            <h2 className="mb-4 text-lg font-semibold text-white">Rubric scores</h2>
            <div className="space-y-3">
              {score.dimension_scores.map((d) => {
                const pct = d.max > 0 ? Math.round((d.score / d.max) * 100) : 0;
                const barColor = pct >= 85 ? "bg-emerald-500" : pct >= 70 ? "bg-blue-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";
                return (
                  <div key={d.dimension_key} className="rounded-lg bg-[#0f1729] p-4 ring-1 ring-[#2a3f5f]">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-white">{d.dimension_name}</p>
                      <p className="text-sm tabular-nums text-slate-400">
                        {d.score}/{d.max}
                      </p>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#2a3f5f]">
                      <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                    {d.evidence ? (
                      <p className="mt-3 text-xs italic text-slate-300">&ldquo;{d.evidence}&rdquo;</p>
                    ) : null}
                    {d.missed ? (
                      <p className="mt-2 text-xs text-rose-300">
                        <span className="font-semibold uppercase tracking-wide">Missed:</span> {d.missed}
                      </p>
                    ) : null}
                    {d.do_better ? (
                      <p className="mt-2 text-xs text-emerald-300">
                        <span className="font-semibold uppercase tracking-wide">Do better:</span> {d.do_better}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Objections */}
          {score.objections_log.length > 0 ? (
            <section className="rounded-xl border border-[#2a3f5f] p-6" style={{ backgroundColor: "#1a2540" }}>
              <h2 className="mb-4 text-lg font-semibold text-white">Objections handled</h2>
              <div className="space-y-3">
                {score.objections_log.map((o, i) => (
                  <div key={i} className="rounded-lg bg-[#0f1729] p-4 ring-1 ring-[#2a3f5f]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-white">&ldquo;{o.objection}&rdquo;</p>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs ${
                          ALIGN_COLOR[o.alignment] ?? "bg-slate-500/20 text-slate-300"
                        }`}
                      >
                        {o.alignment.replaceAll("_", " ")}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-300">
                      <span className="text-slate-500">Response:</span> {o.response_used || "—"}
                    </p>
                    {o.notes ? <p className="mt-2 text-xs text-slate-400">{o.notes}</p> : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* Compliance flags */}
          {score.compliance_flags.length > 0 ? (
            <section className="rounded-xl border border-rose-500/30 p-6" style={{ backgroundColor: "#2a1a24" }}>
              <h2 className="mb-4 text-lg font-semibold text-rose-100">Compliance flags</h2>
              <div className="space-y-2">
                {score.compliance_flags.map((f, i) => (
                  <div key={i} className="rounded-lg bg-[#1a0f15] p-3 ring-1 ring-rose-500/20">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-rose-200">&ldquo;{f.phrase}&rdquo;</p>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${SEVERITY_COLOR[f.severity] ?? ""}`}>
                        {f.severity}
                      </span>
                    </div>
                    {f.excerpt ? <p className="mt-1 text-xs italic text-rose-300/80">{f.excerpt}</p> : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* Script recommendations */}
          {score.script_recommendations.length > 0 ? (
            <section className="rounded-xl border border-[#2a3f5f] p-6" style={{ backgroundColor: "#1a2540" }}>
              <h2 className="mb-4 text-lg font-semibold text-white">Script recommendations</h2>
              <ul className="space-y-2 text-sm text-slate-200">
                {score.script_recommendations.map((s, i) => (
                  <li key={i} className="rounded-lg bg-[#0f1729] p-3 ring-1 ring-[#2a3f5f]">
                    {s}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      {/* Transcript */}
      <section className="rounded-xl border border-[#2a3f5f] p-6" style={{ backgroundColor: "#1a2540" }}>
        <h2 className="mb-3 text-lg font-semibold text-white">Transcript</h2>
        {c.transcription ? (
          <pre className="max-h-[500px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-[#0f1729] p-4 text-sm text-slate-200 ring-1 ring-[#2a3f5f]">
            {c.transcription}
          </pre>
        ) : (
          <p className="text-sm italic text-slate-500">No transcript available from CallRail yet.</p>
        )}
      </section>
    </div>
  );
}
