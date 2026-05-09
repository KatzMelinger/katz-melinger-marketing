"use client";

/**
 * Keyword cannibalization page.
 *
 * Shows the latest cached snapshot immediately, with a button to re-scan.
 * Each issue lists the URLs competing for the same keyword and a severity
 * (high if 2+ rank in top 10, medium if top 20, otherwise low).
 */

import { useEffect, useState } from "react";
import { MarketingNav } from "@/components/marketing-nav";

type Issue = {
  keyword: string;
  searchVolume: number;
  urls: { url: string; position: number }[];
  severity: "low" | "medium" | "high";
};

type Snapshot = {
  id: string;
  domain: string;
  issues: Issue[];
  total_issues: number;
  created_at: string;
};

function Pill({ tone, children }: { tone: "red" | "amber" | "blue" | "neutral"; children: React.ReactNode }) {
  const colors: Record<string, string> = {
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

export default function CannibalizationPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/seo/cannibalization/latest");
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

  const grouped = (snapshot?.issues ?? []).reduce<Record<string, Issue[]>>((acc, i) => {
    (acc[i.severity] ??= []).push(i);
    return acc;
  }, {});

  return (
    <>
      <MarketingNav />
      <div className="p-6 space-y-6 mx-auto max-w-7xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Keyword cannibalization</h1>
          <p className="text-sm opacity-70 mt-1 max-w-2xl">
            Two or more URLs ranking for the same query split link equity and
            confuse search intent. Re-scanning pulls fresh data from Semrush;
            high/medium issues automatically post to the alerts inbox.
          </p>
          {snapshot?.created_at && (
            <p className="text-xs opacity-60 mt-1">
              Last scan: {new Date(snapshot.created_at).toLocaleString()} · {snapshot.total_issues} issues
            </p>
          )}
        </div>
        <button
          onClick={scan}
          disabled={scanning}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-foreground text-background disabled:opacity-50"
        >
          {scanning ? "Scanning…" : "Re-scan"}
        </button>
      </div>

      {error && (
        <div className="border border-red-500/40 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">{error}</div>
      )}

      {loading && !snapshot && (
        <div className="border border-black/10 dark:border-white/10 rounded-lg p-10 text-center text-sm opacity-70">
          Loading…
        </div>
      )}

      {snapshot && snapshot.issues.length === 0 && (
        <div className="border border-black/10 dark:border-white/10 rounded-lg p-10 text-center text-sm opacity-70">
          No cannibalization issues detected. 🎉
        </div>
      )}

      {(["high", "medium", "low"] as const).map((sev) => {
        const list = grouped[sev] ?? [];
        if (list.length === 0) return null;
        return (
          <div key={sev} className="border border-black/10 dark:border-white/10 rounded-lg overflow-hidden">
            <div className="px-4 py-2 border-b border-black/10 dark:border-white/10 flex items-center gap-2">
              <Pill tone={severityTone(sev)}>{sev}</Pill>
              <span className="text-sm font-medium">{list.length} issues</span>
            </div>
            <div className="divide-y divide-black/5 dark:divide-white/5">
              {list.map((i) => (
                <div key={i.keyword} className="p-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{i.keyword}</span>
                    <Pill tone="neutral">{i.searchVolume.toLocaleString()} vol</Pill>
                  </div>
                  <ul className="mt-2 space-y-1 text-xs">
                    {i.urls.map((u) => (
                      <li key={u.url} className="flex items-center gap-2">
                        <span className="font-mono opacity-60 w-8 shrink-0">#{u.position}</span>
                        <a href={u.url} target="_blank" rel="noreferrer" className="underline truncate opacity-90">
                          {u.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      </div>
    </>
  );
}
