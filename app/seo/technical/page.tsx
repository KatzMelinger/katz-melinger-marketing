"use client";

/**
 * Technical SEO monitoring — Core Web Vitals + schema + crawl errors.
 *
 * Renders the latest cached scan from technical_seo_runs immediately, with
 * a "Re-scan" button that triggers a fresh PageSpeed run (slow, ~60-120s
 * for both mobile + desktop). The previous server-rendered version blocked
 * the page on PageSpeed and timed out on Vercel.
 */

import { useEffect, useState } from "react";

import { SeoShell, formatNumber } from "@/components/seo-shell";

type Metric = {
  name: string;
  score: number;
  status: "healthy" | "warning" | "critical";
  detail: string;
};

type CrawlError = {
  url: string;
  issue: string;
  severity: "warning" | "critical";
};

type CachedRun = {
  id?: string;
  mobile: Metric[];
  desktop: Metric[];
  schema_checks: Metric[];
  crawl_errors: CrawlError[];
  status: "success" | "partial" | "failed";
  error: string | null;
  created_at: string;
};

function statusTone(status: string): { dot: string; text: string; bg: string } {
  if (status === "healthy" || status === "success") {
    return {
      dot: "bg-emerald-500",
      text: "text-emerald-700",
      bg: "bg-emerald-50 border-emerald-200",
    };
  }
  if (status === "warning" || status === "partial") {
    return {
      dot: "bg-amber-500",
      text: "text-amber-700",
      bg: "bg-amber-50 border-amber-200",
    };
  }
  return { dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50 border-red-200" };
}

export default function SeoTechnicalPage() {
  const [latest, setLatest] = useState<CachedRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("https://www.katzmelinger.com");

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/seo/technical?url=${encodeURIComponent(url)}`,
        { cache: "no-store" },
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Failed to load");
        return;
      }
      setLatest(json.latest ?? null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/seo/technical?url=${encodeURIComponent(url)}`,
        { method: "POST" },
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Scan failed");
        return;
      }
      setLatest(json.latest ?? null);
    } finally {
      setScanning(false);
    }
  };

  return (
    <SeoShell
      title="Technical SEO Monitoring"
      subtitle="Core Web Vitals (mobile + desktop), schema markup checks, and crawl error tracking."
    >
      <div className="rounded-xl border border-[#e2e8f0] bg-white p-4 flex flex-wrap items-center gap-3">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 min-w-64 rounded-md border border-[#e2e8f0] px-3 py-2 text-sm focus:border-[#185FA5] focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30"
        />
        <button
          onClick={refresh}
          disabled={loading}
          className="rounded-md border border-[#e2e8f0] px-3 py-2 text-sm font-medium text-slate-700 hover:border-[#185FA5] hover:text-[#185FA5] disabled:opacity-50"
        >
          {loading ? "Loading…" : "Reload cached"}
        </button>
        <button
          onClick={runScan}
          disabled={scanning}
          className="rounded-md bg-[#185FA5] px-3 py-2 text-sm font-medium text-white hover:bg-[#1f6fb8] disabled:opacity-50"
        >
          {scanning ? "Scanning… (60-120s)" : "Re-scan"}
        </button>
        {latest && (
          <span className="text-xs text-slate-500 ml-auto">
            Last scan: {new Date(latest.created_at).toLocaleString()}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {!latest && !loading && !scanning && (
        <article className="rounded-xl border border-dashed border-[#e2e8f0] bg-white p-10 text-center">
          <div className="text-3xl mb-2" aria-hidden>
            🚀
          </div>
          <h3 className="text-lg font-semibold">No scan yet</h3>
          <p className="text-sm text-slate-600 mt-2 max-w-md mx-auto">
            Click <span className="font-semibold">Re-scan</span> to run a fresh PageSpeed Insights
            check (mobile + desktop). Each scan takes 60-120 seconds — results are then cached so
            this page renders instantly next time.
          </p>
          <p className="text-xs text-slate-500 mt-3">
            Requires <code className="px-1 py-0.5 rounded bg-slate-100">PAGESPEED_API_KEY</code> env
            var (free Google API).
          </p>
        </article>
      )}

      {scanning && (
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-10 text-center">
          <div className="text-3xl mb-2 animate-pulse" aria-hidden>
            ⚡
          </div>
          <h3 className="text-lg font-semibold">Scanning…</h3>
          <p className="text-sm text-slate-600 mt-2">
            PageSpeed Insights is testing both mobile and desktop. This usually takes 60-120
            seconds.
          </p>
        </article>
      )}

      {latest && (
        <>
          <section className="grid gap-4 lg:grid-cols-2">
            <MetricsBlock title="Mobile performance" metrics={latest.mobile} />
            <MetricsBlock title="Desktop performance" metrics={latest.desktop} />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <MetricsBlock
              title="Schema markup checks"
              metrics={latest.schema_checks}
              emptyHint="No schema checks recorded."
            />
            <article className="rounded-xl border border-[#e2e8f0] bg-white p-5">
              <h2 className="text-lg font-semibold text-slate-900">Crawl errors</h2>
              <p className="text-xs text-slate-500 mt-1">
                Pages flagged with crawl issues from the latest run.
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                {(latest.crawl_errors ?? []).length === 0 && (
                  <li className="text-sm text-slate-500">No crawl errors detected.</li>
                )}
                {(latest.crawl_errors ?? []).map((error) => {
                  const tone = statusTone(error.severity);
                  return (
                    <li
                      key={`${error.url}-${error.issue}`}
                      className={`rounded-md border ${tone.bg} px-3 py-2`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${tone.dot}`}
                          aria-hidden
                        />
                        <span className="text-xs font-medium uppercase tracking-wide">
                          {error.severity}
                        </span>
                      </div>
                      <p className="font-medium text-slate-900 mt-1 truncate">{error.url}</p>
                      <p className="text-xs text-slate-700 mt-0.5">{error.issue}</p>
                    </li>
                  );
                })}
              </ul>
            </article>
          </section>
        </>
      )}
    </SeoShell>
  );
}

function MetricsBlock({
  title,
  metrics,
  emptyHint,
}: {
  title: string;
  metrics: Metric[];
  emptyHint?: string;
}) {
  return (
    <article className="rounded-xl border border-[#e2e8f0] bg-white p-5">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {(metrics ?? []).length === 0 && (
          <li className="text-sm text-slate-500">{emptyHint ?? "No data."}</li>
        )}
        {(metrics ?? []).map((m) => {
          const tone = statusTone(m.status);
          return (
            <li
              key={m.name}
              className={`rounded-md border ${tone.bg} px-3 py-2`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-slate-900">{m.name}</p>
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${tone.dot}`} aria-hidden />
                  <span className={`text-xs font-medium uppercase tracking-wide ${tone.text}`}>
                    {m.status}
                  </span>
                  <span className="text-xs text-slate-700 tabular-nums">
                    {formatNumber(m.score)}
                  </span>
                </div>
              </div>
              <p className="text-xs text-slate-600 mt-1">{m.detail}</p>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
