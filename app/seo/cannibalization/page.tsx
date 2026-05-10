"use client";

/**
 * Keyword cannibalization.
 *
 * Two or more URLs ranking for the same query split link equity and confuse
 * search intent. This page reads the latest snapshot from
 * cannibalization_snapshots, groups issues by severity (high if 2+ URLs in
 * top 10, medium if top 20, low otherwise), and surfaces each keyword with
 * the competing URLs + their positions + a "fix" suggestion.
 *
 * Re-scanning pulls fresh data from Semrush. High/medium issues automatically
 * post to the alerts inbox.
 */

import { useEffect, useState } from "react";

import { SeoShell, formatNumber } from "@/components/seo-shell";

type IssueUrl = { url: string; position: number };
type Issue = {
  keyword: string;
  searchVolume: number;
  urls: IssueUrl[];
  severity: "low" | "medium" | "high";
};

type Snapshot = {
  id: string;
  domain: string;
  issues: Issue[];
  total_issues: number;
  created_at: string;
};

function tonesFor(sev: Issue["severity"]) {
  if (sev === "high") {
    return {
      pill: "bg-red-100 text-red-700 border-red-200",
      stripe: "border-l-red-500",
    };
  }
  if (sev === "medium") {
    return {
      pill: "bg-amber-100 text-amber-700 border-amber-200",
      stripe: "border-l-amber-500",
    };
  }
  return {
    pill: "bg-blue-100 text-blue-700 border-blue-200",
    stripe: "border-l-blue-500",
  };
}

function recommendedAction(urls: IssueUrl[]): string {
  const sorted = [...urls].sort((a, b) => a.position - b.position);
  const winner = sorted[0];
  const losers = sorted.slice(1);
  if (losers.length === 0) return "";
  return `Keep ${winner.url.replace(/^https?:\/\/[^/]+/, "")} (rank ${winner.position}). 301-redirect or canonicalize the other ${losers.length} URL${losers.length === 1 ? "" : "s"} to it.`;
}

export default function CannibalizationPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [search, setSearch] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/seo/cannibalization/latest", { cache: "no-store" });
      const data = await res.json();
      setSnapshot(data.snapshot ?? null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const scan = async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/seo/cannibalization/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "scan failed");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "scan failed");
    }
    setScanning(false);
  };

  const issues = (snapshot?.issues ?? []).filter((i) => {
    if (filter !== "all" && i.severity !== filter) return false;
    if (search.trim() && !i.keyword.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = (snapshot?.issues ?? []).reduce(
    (acc, i) => {
      acc[i.severity] += 1;
      return acc;
    },
    { high: 0, medium: 0, low: 0 },
  );

  const totalAffectedTraffic = (snapshot?.issues ?? []).reduce(
    (sum, i) => sum + (i.searchVolume ?? 0),
    0,
  );

  return (
    <SeoShell
      title="Keyword Cannibalization"
      subtitle="Pages competing for the same query split link equity and confuse search intent."
    >
      <div className="rounded-xl border border-[#e2e8f0] bg-white p-4 flex flex-wrap items-center gap-3">
        {snapshot?.created_at ? (
          <span className="text-xs text-slate-500">
            Last scan {new Date(snapshot.created_at).toLocaleString()} · {snapshot.total_issues}{" "}
            issues
          </span>
        ) : (
          <span className="text-xs text-slate-500">No scans yet.</span>
        )}
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search keywords…"
            className="px-3 py-1.5 text-sm rounded-md border border-[#e2e8f0] focus:border-[#185FA5] focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="px-3 py-1.5 text-sm rounded-md border border-[#e2e8f0]"
          >
            <option value="all">All severities</option>
            <option value="high">High only</option>
            <option value="medium">Medium only</option>
            <option value="low">Low only</option>
          </select>
          <button
            onClick={scan}
            disabled={scanning}
            className="rounded-md bg-[#185FA5] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1f6fb8] disabled:opacity-50"
          >
            {scanning ? "Scanning…" : "Re-scan"}
          </button>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total issues" value={formatNumber(snapshot?.total_issues ?? 0)} />
        <Stat label="High severity" value={formatNumber(counts.high)} tone="red" />
        <Stat label="Medium severity" value={formatNumber(counts.medium)} tone="amber" />
        <Stat
          label="Affected monthly volume"
          value={formatNumber(totalAffectedTraffic)}
          hint="Sum of search volume across all cannibalized keywords."
        />
      </section>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && !snapshot && (
        <div className="rounded-xl border border-[#e2e8f0] bg-white p-10 text-center text-sm text-slate-500">
          Loading…
        </div>
      )}

      {snapshot && snapshot.issues.length === 0 && (
        <div className="rounded-xl border border-[#e2e8f0] bg-white p-10 text-center">
          <div className="text-3xl mb-2" aria-hidden>
            🎉
          </div>
          <h3 className="text-lg font-semibold">No cannibalization detected</h3>
          <p className="text-sm text-slate-600 mt-2 max-w-md mx-auto">
            Every ranking keyword in the top 30 currently maps to one URL. Run a fresh scan
            anytime — high/medium issues will also fire alerts in the inbox.
          </p>
        </div>
      )}

      {issues.length === 0 && snapshot && snapshot.issues.length > 0 && (
        <div className="rounded-xl border border-[#e2e8f0] bg-white p-10 text-center text-sm text-slate-500">
          No issues match these filters.
        </div>
      )}

      {issues.length > 0 && (
        <section className="space-y-3">
          {issues.map((issue) => {
            const tones = tonesFor(issue.severity);
            return (
              <article
                key={issue.keyword}
                className={`rounded-xl border border-[#e2e8f0] border-l-4 ${tones.stripe} bg-white p-5`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-slate-900">{issue.keyword}</h3>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${tones.pill}`}
                      >
                        {issue.severity}
                      </span>
                      <span className="text-xs text-slate-500">
                        {formatNumber(issue.searchVolume)}/mo
                      </span>
                      <span className="text-xs text-slate-500">
                        · {issue.urls.length} competing URLs
                      </span>
                    </div>
                    <a
                      href={`https://www.google.com/search?q=${encodeURIComponent(issue.keyword + " site:katzmelinger.com")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#185FA5] hover:underline mt-1 inline-block"
                    >
                      Verify on Google ↗
                    </a>
                  </div>
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500 border-b border-[#e2e8f0]">
                        <th className="py-2 pr-3 font-medium w-16">Rank</th>
                        <th className="py-2 pr-3 font-medium">URL</th>
                        <th className="py-2 font-medium w-24 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {issue.urls.map((u, i) => {
                        const isWinner = i === 0;
                        return (
                          <tr key={u.url} className="border-b border-[#e2e8f0]/60 last:border-0">
                            <td className="py-2 pr-3 tabular-nums font-mono text-xs">
                              <span
                                className={`px-1.5 py-0.5 rounded ${
                                  u.position <= 10
                                    ? "bg-emerald-100 text-emerald-700"
                                    : u.position <= 20
                                      ? "bg-amber-100 text-amber-700"
                                      : "bg-slate-100 text-slate-700"
                                }`}
                              >
                                #{u.position}
                              </span>
                            </td>
                            <td className="py-2 pr-3">
                              <a
                                href={u.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-slate-700 hover:text-[#185FA5] hover:underline truncate block max-w-[600px]"
                                title={u.url}
                              >
                                {u.url.replace(/^https?:\/\/(www\.)?[^/]+/, "")}
                              </a>
                            </td>
                            <td className="py-2 text-right">
                              {isWinner ? (
                                <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">
                                  Keep
                                </span>
                              ) : (
                                <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                                  Redirect
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 rounded-md bg-slate-50 border border-slate-200 px-3 py-2">
                  <div className="text-[11px] font-medium text-slate-600 uppercase tracking-wide">
                    Recommended fix
                  </div>
                  <p className="text-xs text-slate-700 mt-0.5">{recommendedAction(issue.urls)}</p>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </SeoShell>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "red" | "amber";
}) {
  const color =
    tone === "red"
      ? "text-red-700"
      : tone === "amber"
        ? "text-amber-700"
        : "text-slate-900";
  return (
    <article className="rounded-xl border border-[#e2e8f0] bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${color}`}>{value}</p>
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </article>
  );
}
