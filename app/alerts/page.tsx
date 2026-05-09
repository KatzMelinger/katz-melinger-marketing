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
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Marketing alerts</h1>
          <p className="text-sm opacity-70 mt-1 max-w-2xl">
            Rank drops, AI mention gains and losses, sentiment shifts, new
            citations, and cannibalization — all in one inbox. The AEO evaluator
            runs after every sweep; click "Evaluate now" to also re-check SEO
            rank drops.
          </p>
        </div>
        <button
          onClick={evaluate}
          disabled={evaluating}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium border border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50"
        >
          {evaluating ? "Evaluating…" : "Evaluate now"}
        </button>
      </div>

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
                <div className="flex items-center gap-2">
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
  );
}
