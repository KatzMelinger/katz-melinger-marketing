"use client";

/**
 * Claude-powered marketing recommendations.
 *
 * Pulls the latest AEO + SEO + cannibalization snapshot, sends it to Claude,
 * and renders a prioritized action list with rationale and evidence so the
 * marketer can verify each suggestion against the underlying data.
 *
 * Fast enough to run on demand — single Claude round-trip — so we don't
 * persist; the user clicks Generate whenever they want a fresh take.
 */

import { useEffect, useState } from "react";
import { MarketingNav } from "@/components/marketing-nav";

type HistoryItem = {
  id: string;
  rec_count: number;
  evidence: { aeoRows?: number; keywords?: number; cannibalization?: number };
  created_at: string;
};

type Recommendation = {
  title: string;
  rationale: string;
  category: "seo" | "aeo" | "content" | "technical" | "local" | "social";
  effort: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
  evidence: string;
};

type Result = {
  recommendations: Recommendation[];
  generatedAt: string;
  evidence: { aeoRows: number; keywords: number; cannibalization: number };
};

function Pill({ tone, children }: { tone: "emerald" | "red" | "amber" | "blue" | "violet" | "neutral"; children: React.ReactNode }) {
  const colors: Record<string, string> = {
    emerald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    red: "bg-red-500/15 text-red-700 dark:text-red-400",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    blue: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    violet: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
    neutral: "bg-black/5 dark:bg-white/10 opacity-80",
  };
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${colors[tone]}`}>{children}</span>;
}

function impactTone(s: string): "emerald" | "amber" | "neutral" {
  if (s === "high") return "emerald";
  if (s === "medium") return "amber";
  return "neutral";
}

function effortTone(s: string): "blue" | "amber" | "red" {
  if (s === "low") return "blue";
  if (s === "medium") return "amber";
  return "red";
}

function categoryTone(c: string): "violet" | "blue" | "amber" | "emerald" | "neutral" {
  if (c === "aeo") return "violet";
  if (c === "seo") return "blue";
  if (c === "content") return "emerald";
  if (c === "technical") return "amber";
  return "neutral";
}

export default function RecommendationsPage() {
  const [result, setResult] = useState<Result | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const refreshHistory = async () => {
    try {
      const res = await fetch("/api/recommendations/history");
      const data = await res.json();
      setHistory(data.history ?? []);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    refreshHistory();
  }, []);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/recommendations/generate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to generate");
      setResult(data);
      refreshHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate");
    }
    setGenerating(false);
  };

  const loadFromHistory = async (id: string) => {
    try {
      const res = await fetch(`/api/recommendations/history?id=${id}`);
      const data = await res.json();
      if (!res.ok) return;
      setResult({
        recommendations: data.recommendations,
        evidence: data.evidence,
        generatedAt: data.created_at,
      });
    } catch {
      /* ignore */
    }
  };

  // Sort: high impact + low effort first.
  const sorted = (result?.recommendations ?? []).slice().sort((a, b) => {
    const score = (r: Recommendation) =>
      ({ high: 3, medium: 2, low: 1 }[r.impact] ?? 0) - ({ high: 2, medium: 1, low: 0 }[r.effort] ?? 0);
    return score(b) - score(a);
  });

  return (
    <>
      <MarketingNav />
      <div className="p-6 space-y-6 mx-auto max-w-7xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI recommendations</h1>
          <p className="text-sm opacity-70 mt-1 max-w-2xl">
            Claude reads the firm's latest AEO sweep, tracked SEO keywords, and
            cannibalization snapshot, then suggests prioritized actions with
            evidence pointing back to the rows above.
          </p>
          {result && (
            <p className="text-xs opacity-60 mt-1">
              Generated {new Date(result.generatedAt).toLocaleString()} · evidence:{" "}
              {result.evidence.aeoRows} AEO rows, {result.evidence.keywords} keywords,{" "}
              {result.evidence.cannibalization} cannibalization issues
            </p>
          )}
        </div>
        <button
          onClick={generate}
          disabled={generating}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-foreground text-background disabled:opacity-50"
        >
          {generating ? "Thinking…" : result ? "Regenerate" : "Generate"}
        </button>
      </div>

      {error && (
        <div className="border border-red-500/40 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">{error}</div>
      )}

      {history.length > 0 && (
        <div className="border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium uppercase tracking-wider opacity-60 mb-2">
            Recent generations
          </div>
          <div className="flex flex-wrap gap-2">
            {history.map((h) => (
              <button
                key={h.id}
                onClick={() => loadFromHistory(h.id)}
                className="text-xs px-2 py-1 rounded border border-slate-200 hover:border-[#185FA5] hover:text-[#185FA5] transition-colors"
                title={`${h.rec_count} recs · ${new Date(h.created_at).toLocaleString()}`}
              >
                <span className="font-medium">{new Date(h.created_at).toLocaleDateString()}</span>
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700">
                  {h.rec_count}
                </span>
                <span className="ml-2 opacity-60">
                  {new Date(h.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!result && !generating && (
        <div className="border border-black/10 dark:border-white/10 rounded-lg p-10 text-center space-y-2">
          <div className="text-3xl" aria-hidden>✦</div>
          <h3 className="text-lg font-semibold">No recommendations yet</h3>
          <p className="text-sm opacity-70 max-w-md mx-auto">
            Click Generate to ask Claude for prioritized actions based on your
            current AEO and SEO data.
          </p>
        </div>
      )}

      {generating && !result && (
        <div className="border border-black/10 dark:border-white/10 rounded-lg p-10 text-center text-sm opacity-70">
          Reading your latest data…
        </div>
      )}

      {sorted.length > 0 && (
        <div className="space-y-3">
          {sorted.map((r, i) => (
            <div key={i} className="border border-black/10 dark:border-white/10 rounded-lg p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="text-sm font-medium">{r.title}</div>
                <div className="flex items-center gap-1.5">
                  <Pill tone={categoryTone(r.category)}>{r.category}</Pill>
                  <Pill tone={impactTone(r.impact)}>impact: {r.impact}</Pill>
                  <Pill tone={effortTone(r.effort)}>effort: {r.effort}</Pill>
                </div>
              </div>
              <p className="text-xs opacity-80 mt-2">{r.rationale}</p>
              <p className="text-[11px] opacity-60 italic mt-2 border-l-2 border-black/10 dark:border-white/15 pl-2">
                Evidence: {r.evidence}
              </p>
            </div>
          ))}
        </div>
      )}
      </div>
    </>
  );
}
