"use client";

/**
 * Marketing alerts inbox.
 *
 * The unified place to see everything worth flagging across SEO, AEO, and
 * cannibalization. Each alert can be marked read or dismissed; rules at the
 * bottom let you tune the noise floor (e.g. minimum rank drop to alert on).
 *
 * The AEO evaluator runs automatically after every sweep; SEO rank-drop
 * evaluation is triggered manually here (or from a cron once configured).
 */

import { useEffect, useState } from "react";
import { MarketingNav } from "@/components/marketing-nav";
import { ContentActionsRow, useContentActions } from "@/components/content-actions";

type Alert = {
  id: string;
  type: string;
  severity: "low" | "medium" | "high";
  source: string | null;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  status: "new" | "read" | "dismissed";
  detected_at: string;
};

type ChannelFit = {
  channel: string;
  recommended: boolean;
  score: number;
  rationale: string;
  formats: string[];
};

type SuggestedContent = {
  title: string;
  format: string;
  channel: string;
  why: string;
};

type TopicFit = {
  topic: string;
  verdict: string;
  channels: ChannelFit[];
  suggestedContent: SuggestedContent[];
  analyzed_at?: string;
};

// A previously-cached analysis stored on the alert payload, if present.
function cachedFit(a: Alert): TopicFit | null {
  const tf = (a.payload ?? {})["topic_fit"];
  if (tf && typeof tf === "object" && Array.isArray((tf as TopicFit).channels)) {
    return tf as TopicFit;
  }
  return null;
}

// Pull the most content-relevant phrase out of an alert: an explicit keyword
// from the payload if present, otherwise the alert title.
function topicOf(a: Alert): string {
  const p = a.payload ?? {};
  for (const key of ["keyword", "prompt", "query", "phrase", "topic"]) {
    const v = p[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return a.title;
}

// Map an analysis "format" label to a CONTENT_TYPES id understood by the
// draft generator. Defaults to a blog post.
function formatToContentTypeId(format: string): string {
  const f = format.toLowerCase();
  if (f.includes("faq")) return "faq";
  if (f.includes("guide")) return "guide";
  if (f.includes("case")) return "case_study";
  if (f.includes("landing") || f.includes("service") || f.includes("page") || f.includes("web"))
    return "webpage";
  if (f.includes("email") || f.includes("newsletter")) return "email";
  if (
    f.includes("social") ||
    f.includes("linkedin") ||
    f.includes("instagram") ||
    f.includes("facebook") ||
    f.includes("tweet") ||
    f.includes("twitter") ||
    f.includes("video")
  )
    return "social_post";
  return "blog_post";
}

type Rule = {
  id: string;
  type: string;
  enabled: boolean;
  threshold: Record<string, unknown>;
  notes: string | null;
};

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`border border-black/10 dark:border-white/10 rounded-lg ${className}`}>
      {children}
    </div>
  );
}

function Pill({ tone, children }: { tone: "emerald" | "red" | "amber" | "blue" | "neutral"; children: React.ReactNode }) {
  const colors: Record<string, string> = {
    emerald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    red: "bg-red-500/15 text-red-700 dark:text-red-400",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    blue: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    neutral: "bg-black/5 dark:bg-white/10 opacity-80",
  };
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${colors[tone]}`}>{children}</span>;
}

function severityTone(s: string): "red" | "amber" | "blue" {
  if (s === "high") return "red";
  if (s === "medium") return "amber";
  return "blue";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function AlertsPage() {
  const [status, setStatus] = useState<"new" | "read" | "dismissed" | "all">("new");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [summary, setSummary] = useState({ new: 0, read: 0, dismissed: 0 });
  const [loading, setLoading] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [sweepMsg, setSweepMsg] = useState<string | null>(null);

  // Topic-fit analysis modal state.
  const [analysisFor, setAnalysisFor] = useState<Alert | null>(null);
  const [analysis, setAnalysis] = useState<TopicFit | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Shared Ideas / Fan-out / Create content flow (same as the SEO pages).
  const contentActions = useContentActions();

  const analyze = async (a: Alert, force = false) => {
    setAnalysisFor(a);
    setAnalysisError(null);

    // Instant path: reuse the cached analysis stored on the alert payload
    // unless the user explicitly asked to re-run it.
    const cached = force ? null : cachedFit(a);
    if (cached) {
      setAnalysis(cached);
      setAnalysisLoading(false);
      return;
    }

    setAnalysis(null);
    setAnalysisLoading(true);
    try {
      const res = await fetch("/api/content/intelligence/topic-fit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topicOf(a),
          context: [a.type, a.body].filter(Boolean).join(" — "),
          alertId: a.id,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAnalysisError(json?.error ?? "Analysis failed");
        return;
      }
      setAnalysis(json as TopicFit);
      // Embed into local state so the button flips to "View analysis" and a
      // re-open is instant without another round-trip.
      setAlerts((prev) =>
        prev.map((x) =>
          x.id === a.id ? { ...x, payload: { ...x.payload, topic_fit: json } } : x,
        ),
      );
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalysisLoading(false);
    }
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const [a, r] = await Promise.all([
        fetch(`/api/alerts?status=${status}`).then((res) => res.json()),
        fetch("/api/alerts/rules").then((res) => res.json()),
      ]);
      setAlerts(a.alerts ?? []);
      setSummary(a.summary ?? { new: 0, read: 0, dismissed: 0 });
      setRules(r.rules ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [status]);

  const setStatusOf = async (a: Alert, next: "read" | "dismissed") => {
    await fetch(`/api/alerts/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    refresh();
  };

  const evaluate = async () => {
    setEvaluating(true);
    try {
      await fetch("/api/alerts/evaluate", { method: "POST" });
      refresh();
    } finally {
      setEvaluating(false);
    }
  };

  // One-click AEO sweep. Runs across the configured AI providers; AEO alerts
  // are evaluated automatically when it finishes (and the FIRST sweep just
  // seeds the baseline, since alerts come from diffing against the prior run).
  const runSweep = async () => {
    setSweeping(true);
    setSweepMsg(null);
    try {
      const res = await fetch("/api/aeo/runs/start", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSweepMsg(json?.error ?? "Failed to start sweep");
        return;
      }
      setSweepMsg(
        "AEO sweep started — it runs in the background (a few minutes). New AI-mention alerts appear here once it finishes.",
      );
    } catch (e) {
      setSweepMsg(e instanceof Error ? e.message : "Failed to start sweep");
    } finally {
      setSweeping(false);
    }
  };

  const setRule = async (rule: Rule, patch: Partial<Rule>) => {
    await fetch(`/api/alerts/rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    refresh();
  };

  const tabs: { id: typeof status; label: string; count?: number }[] = [
    { id: "new", label: "New", count: summary.new },
    { id: "read", label: "Read", count: summary.read },
    { id: "dismissed", label: "Dismissed", count: summary.dismissed },
    { id: "all", label: "All" },
  ];

  return (
    <>
      <MarketingNav />
      <div className="p-6 space-y-6 mx-auto max-w-7xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Marketing alerts</h1>
          <p className="text-sm opacity-70 mt-1 max-w-2xl">
            Rank drops, AI mention gains and losses, sentiment shifts, new
            citations, and cannibalization — all in one inbox. The AEO evaluator
            runs after every sweep; click &quot;Evaluate now&quot; to also re-check SEO
            rank drops.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runSweep}
            disabled={sweeping}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-foreground text-background hover:opacity-90 disabled:opacity-50"
            title="Run an AEO sweep now to refresh AI-mention alerts"
          >
            {sweeping ? "Starting sweep…" : "Run AEO sweep now"}
          </button>
          <button
            onClick={evaluate}
            disabled={evaluating}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium border border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50"
          >
            {evaluating ? "Evaluating…" : "Evaluate now"}
          </button>
        </div>
      </div>

      {sweepMsg && (
        <div className="rounded-md border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] px-3 py-2 text-xs opacity-80">
          {sweepMsg}
        </div>
      )}

      <div className="flex gap-2 border-b border-black/10 dark:border-white/10 pb-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setStatus(t.id)}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium ${
              status === t.id
                ? "bg-foreground text-background"
                : "hover:bg-black/5 dark:hover:bg-white/10"
            }`}
          >
            {t.label}
            {typeof t.count === "number" && (
              <span className="text-[11px] opacity-70">({t.count})</span>
            )}
          </button>
        ))}
      </div>

      <Card>
        {loading && (
          <div className="p-6 text-sm opacity-70">Loading…</div>
        )}
        {!loading && alerts.length === 0 && (
          <div className="p-10 text-center opacity-70 text-sm">
            No alerts in this view. Run an AEO sweep or refresh tracked keywords
            to populate the inbox.
          </div>
        )}
        {!loading && alerts.length > 0 && (
          <div className="divide-y divide-black/5 dark:divide-white/5">
            {alerts.map((a) => (
              <div key={a.id} className="p-4 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Pill tone={severityTone(a.severity)}>{a.severity}</Pill>
                    <Pill tone="neutral">{a.type}</Pill>
                    {a.source && <Pill tone="blue">{a.source}</Pill>}
                    <span className="text-xs opacity-60">{fmtDate(a.detected_at)}</span>
                  </div>
                  <div className="mt-1 text-sm font-medium">{a.title}</div>
                  {a.body && <div className="mt-0.5 text-xs opacity-80">{a.body}</div>}
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <button
                    onClick={() => analyze(a)}
                    disabled={analysisLoading && analysisFor?.id === a.id}
                    className="text-xs px-2 py-1 rounded border border-brand text-brand hover:bg-brand/10 disabled:opacity-50"
                    title="Assess this topic for SEO / AEO / Social and suggest content"
                  >
                    {analysisLoading && analysisFor?.id === a.id
                      ? "Analyzing…"
                      : cachedFit(a)
                        ? "View analysis"
                        : "Analyze"}
                  </button>
                  <ContentActionsRow
                    keyword={topicOf(a)}
                    actions={contentActions}
                    originSource="marketing_alert"
                    originContext={{ alert_id: a.id, alert_type: a.type }}
                  />
                  {a.status === "new" && (
                    <button
                      onClick={() => setStatusOf(a, "read")}
                      className="text-xs px-2 py-1 rounded border border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      Mark read
                    </button>
                  )}
                  {a.status !== "dismissed" && (
                    <button
                      onClick={() => setStatusOf(a, "dismissed")}
                      className="text-xs px-2 py-1 rounded border border-red-500/30 text-red-700 dark:text-red-400 hover:bg-red-500/10"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="text-sm font-medium mb-3">Alert rules</div>
        <div className="space-y-2">
          {rules.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 text-sm border border-black/10 dark:border-white/10 rounded-md px-3 py-2"
            >
              <button
                onClick={() => setRule(r, { enabled: !r.enabled })}
                className={`px-2 py-1 rounded text-xs font-medium ${
                  r.enabled
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : "bg-black/5 dark:bg-white/10 opacity-60"
                }`}
              >
                {r.enabled ? "On" : "Off"}
              </button>
              <span className="font-mono text-xs">{r.type}</span>
              <span className="text-xs opacity-70 truncate flex-1">{r.notes ?? ""}</span>
              <code className="text-[11px] opacity-70">{JSON.stringify(r.threshold)}</code>
            </div>
          ))}
        </div>
      </Card>
      </div>

      {analysisFor && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setAnalysisFor(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white dark:bg-neutral-900 shadow-2xl border border-black/10 dark:border-white/15"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 px-5 py-4">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide opacity-60">Topic analysis</p>
                <h3 className="mt-1 text-lg font-semibold truncate">{topicOf(analysisFor)}</h3>
                {analysis?.analyzed_at && !analysisLoading && (
                  <p className="mt-0.5 text-[11px] opacity-50">
                    Cached · analyzed {fmtDate(analysis.analyzed_at)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => analyze(analysisFor, true)}
                  disabled={analysisLoading}
                  className="text-xs px-2 py-1 rounded border border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50"
                  title="Run a fresh analysis (replaces the cached result)"
                >
                  {analysisLoading ? "…" : "Re-analyze"}
                </button>
                <button
                  onClick={() => setAnalysisFor(null)}
                  className="rounded p-1 opacity-60 hover:opacity-100"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {analysisLoading && (
                <p className="text-sm opacity-70">Analyzing SEO / AEO / Social fit… (typically 5-10s)</p>
              )}
              {analysisError && (
                <div className="rounded-md border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                  {analysisError}
                </div>
              )}

              {analysis && !analysisLoading && (
                <>
                  {analysis.verdict && (
                    <p className="text-sm rounded-md border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] px-3 py-2">
                      {analysis.verdict}
                    </p>
                  )}

                  <div className="grid gap-3 sm:grid-cols-3">
                    {analysis.channels.map((c) => (
                      <div
                        key={c.channel}
                        className="rounded-lg border border-black/10 dark:border-white/10 p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold">{c.channel}</span>
                          <Pill tone={c.recommended ? "emerald" : "neutral"}>
                            {c.recommended ? "Worth it" : "Skip"}
                          </Pill>
                        </div>
                        <div className="mt-2 h-1.5 w-full rounded-full bg-black/10 dark:bg-white/10">
                          <div
                            className={`h-1.5 rounded-full ${
                              c.score >= 67
                                ? "bg-emerald-500"
                                : c.score >= 34
                                  ? "bg-amber-500"
                                  : "bg-red-500"
                            }`}
                            style={{ width: `${Math.max(0, Math.min(100, c.score))}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[11px] opacity-60">{c.score}/100</p>
                        <p className="mt-1 text-xs opacity-80">{c.rationale}</p>
                        {c.formats?.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {c.formats.map((f) => (
                              <span
                                key={f}
                                className="rounded border border-black/10 dark:border-white/15 px-1.5 py-0.5 text-[10px] opacity-80"
                              >
                                {f}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div>
                    <p className="text-sm font-medium mb-2">Suggested content</p>
                    {analysis.suggestedContent.length === 0 && (
                      <p className="text-xs opacity-60">
                        No content suggested — this topic isn&apos;t a strong fit right now.
                      </p>
                    )}
                    <ul className="space-y-2">
                      {analysis.suggestedContent.map((s) => {
                        const busyKey = `alert-fit:${s.title}`;
                        const isBusy = contentActions.creatingKey === busyKey;
                        return (
                          <li
                            key={s.title}
                            className="flex items-start justify-between gap-3 rounded-md border border-black/10 dark:border-white/10 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{s.title}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                                <span className="rounded bg-blue-500/15 text-blue-700 dark:text-blue-400 px-1.5 py-0.5">
                                  {s.channel}
                                </span>
                                <span className="rounded border border-black/10 dark:border-white/15 px-1.5 py-0.5 opacity-80">
                                  {s.format}
                                </span>
                              </div>
                              {s.why && <p className="mt-1 text-[11px] opacity-60">{s.why}</p>}
                            </div>
                            <button
                              onClick={() =>
                                contentActions.createDraft({
                                  topic: s.title,
                                  keyword: analysis.topic,
                                  contentTypeId: formatToContentTypeId(s.format),
                                  busyKey,
                                  originSource: "marketing_alert_analysis",
                                  originContext: {
                                    alert_id: analysisFor.id,
                                    channel: s.channel,
                                    format: s.format,
                                  },
                                })
                              }
                              disabled={isBusy}
                              className="shrink-0 rounded bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-50"
                            >
                              {isBusy ? "…" : "Create"}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {contentActions.modal}
    </>
  );
}
