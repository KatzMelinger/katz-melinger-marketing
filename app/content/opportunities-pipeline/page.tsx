"use client";

/**
 * Opportunity → Brief pipeline (Tier 3). One click runs:
 * Semrush opportunities → real trend validation + "worth it?" score →
 * research packet (legal + People-Also-Ask) + SEO brief for the top winners.
 */

import { useEffect, useState } from "react";

type Scored = {
  keyword: string;
  source: "competitor_gap" | "missing_target" | "long_tail";
  searchVolume: number | null;
  trendDirection: "rising" | "stable" | "falling" | "unknown";
  opportunityScore: number | null;
  worthScore: number;
  worthReasons: string[];
  packetId?: string;
  sourceConfidence?: "low" | "medium" | "high";
  legalReviewRequired?: boolean;
  suggestedFaqs?: { question: string; answer_hint: string }[];
  suggestedAngles?: string[];
  brief?: { titleIdeas: string[]; headings: string[]; targetKeywords: string[] };
  deepError?: string;
};

type Result = {
  generatedAt: string;
  candidatesConsidered: number;
  scored: Scored[];
  winners: Scored[];
  notes: string[];
};

const TREND_ICON: Record<Scored["trendDirection"], string> = {
  rising: "↗ rising",
  stable: "→ stable",
  falling: "↘ falling",
  unknown: "· n/a",
};

function scoreColor(s: number): string {
  if (s >= 70) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (s >= 45) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-50 text-slate-600 border-slate-200";
}

export default function OpportunityPipelinePage() {
  const [practiceAreas, setPracticeAreas] = useState<string[]>([]);
  const [practiceArea, setPracticeArea] = useState("");
  const [topN, setTopN] = useState(3);
  const [deep, setDeep] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    fetch("/api/practice-areas")
      .then((r) => r.json())
      .then((d) => setPracticeAreas(Array.isArray(d?.areas) ? d.areas : []))
      .catch(() => {});
  }, []);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/content/opportunity-pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          practiceArea: practiceArea || undefined,
          topN,
          deep,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Pipeline failed");
        return;
      }
      setResult(json as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pipeline failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-slate-900">Opportunity → Brief pipeline</h1>
      <p className="mt-2 max-w-2xl text-sm text-slate-600">
        One click runs the whole workflow: pull Semrush keyword opportunities,
        validate each with real 12-month trend data and a &ldquo;worth it?&rdquo;
        score, then research + brief the top winners (legal-authority match +
        People-Also-Ask). Deep mode takes ~1–2 minutes.
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-[#e2e8f0] bg-white p-4">
        <label className="text-xs text-slate-600">
          Practice area
          <select
            value={practiceArea}
            onChange={(e) => setPracticeArea(e.target.value)}
            className="mt-1 block rounded-md border border-[#e2e8f0] px-2 py-1.5 text-sm"
          >
            <option value="">All</option>
            {practiceAreas.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Winners to brief
          <select
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value))}
            className="mt-1 block rounded-md border border-[#e2e8f0] px-2 py-1.5 text-sm"
          >
            {[1, 2, 3, 5, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={deep}
            onChange={(e) => setDeep(e.target.checked)}
          />
          Deep (research + brief)
        </label>
        <button
          onClick={run}
          disabled={running}
          className="ml-auto rounded-lg bg-[#185FA5] px-4 py-2 text-sm font-medium text-white hover:bg-[#1f6fb8] disabled:opacity-50"
        >
          {running ? "Running…" : "Run pipeline"}
        </button>
      </div>

      {running && (
        <p className="mt-4 text-sm text-slate-500">
          Sourcing opportunities, checking trends, and researching winners… this
          can take 1–2 minutes for deep runs.
        </p>
      )}
      {error && (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-6">
          {result.notes.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {result.notes.map((n, i) => (
                <div key={i}>{n}</div>
              ))}
            </div>
          )}

          {/* Winners */}
          {result.winners.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-slate-900">
                Top {result.winners.length} — researched &amp; briefed
              </h2>
              <div className="mt-3 space-y-4">
                {result.winners.map((w) => (
                  <div key={w.keyword} className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">{w.keyword}</h3>
                        <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                          <span className={`rounded border px-1.5 py-0.5 ${scoreColor(w.worthScore)}`}>
                            Worth {w.worthScore}/100
                          </span>
                          <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-600">
                            {TREND_ICON[w.trendDirection]}
                          </span>
                          {w.searchVolume != null && (
                            <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-600">
                              {w.searchVolume}/mo
                            </span>
                          )}
                          {w.sourceConfidence && (
                            <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-blue-700">
                              legal confidence: {w.sourceConfidence}
                            </span>
                          )}
                          {w.legalReviewRequired && (
                            <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-red-700">
                              needs legal review
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {w.deepError && (
                      <p className="mt-2 text-xs text-red-600">Research failed: {w.deepError}</p>
                    )}

                    {w.brief && (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Suggested outline
                          </p>
                          <ul className="mt-1 ml-4 list-disc text-xs text-slate-700">
                            {w.brief.headings.map((h, i) => (
                              <li key={i}>{h}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          {w.suggestedFaqs && w.suggestedFaqs.length > 0 && (
                            <>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                People-Also-Ask FAQs
                              </p>
                              <ul className="mt-1 ml-4 list-disc text-xs text-slate-700">
                                {w.suggestedFaqs.slice(0, 5).map((f, i) => (
                                  <li key={i}>{f.question}</li>
                                ))}
                              </ul>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {w.suggestedAngles && w.suggestedAngles.length > 0 && (
                      <p className="mt-3 text-xs text-slate-600">
                        <span className="font-medium">Angles:</span>{" "}
                        {w.suggestedAngles.join(" · ")}
                      </p>
                    )}

                    <p className="mt-2 text-[11px] text-slate-400">
                      Score: {w.worthReasons.join("  ·  ")}
                      {w.packetId ? `  ·  packet ${w.packetId.slice(0, 8)}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Full scored radar */}
          <section>
            <h2 className="text-lg font-semibold text-slate-900">
              All scored opportunities ({result.scored.length})
            </h2>
            <div className="mt-3 overflow-x-auto rounded-xl border border-[#e2e8f0] bg-white">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="border-b border-[#e2e8f0] text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Keyword</th>
                    <th className="px-3 py-2 font-medium">Source</th>
                    <th className="px-3 py-2 font-medium">Volume</th>
                    <th className="px-3 py-2 font-medium">Trend</th>
                    <th className="px-3 py-2 font-medium">Worth</th>
                  </tr>
                </thead>
                <tbody>
                  {result.scored.map((s) => (
                    <tr key={s.keyword} className="border-b border-[#e2e8f0]/60 last:border-0">
                      <td className="px-3 py-2 font-medium text-slate-900">{s.keyword}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {s.source.replace(/_/g, " ")}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-slate-700">
                        {s.searchVolume ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {TREND_ICON[s.trendDirection]}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded border px-1.5 py-0.5 text-xs ${scoreColor(s.worthScore)}`}>
                          {s.worthScore}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
