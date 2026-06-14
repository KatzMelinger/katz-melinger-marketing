"use client";

/**
 * Technical SEO monitoring — Core Web Vitals + schema + crawl errors.
 *
 * Renders the latest cached scan from technical_seo_runs immediately, with
 * a "Re-scan" button that triggers a fresh PageSpeed run (slow, ~60-120s
 * for both mobile + desktop). The previous server-rendered version blocked
 * the page on PageSpeed and timed out on Vercel.
 */

import { useEffect, useRef, useState } from "react";

import { SeoShell, formatNumber } from "@/components/seo-shell";
import { useTenantSiteUrl } from "@/components/tenant-provider";

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

type SuggestedFix = {
  fix_type:
    | "meta_title"
    | "meta_description"
    | "canonical"
    | "schema_jsonld"
    | "og_title"
    | "og_description";
  current_value: string | null;
  suggested_value: string;
  rationale: string;
};

type PageSnapshotSummary = {
  url: string;
  status: number;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  h1: string | null;
  jsonLdBlocks: string[];
  detectedIssues: string[];
};

const FIX_LABELS: Record<SuggestedFix["fix_type"], string> = {
  meta_title: "Meta title",
  meta_description: "Meta description",
  canonical: "Canonical URL",
  schema_jsonld: "JSON-LD schema",
  og_title: "Open Graph title",
  og_description: "Open Graph description",
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
  const tenantSite = useTenantSiteUrl();
  const sitePrefilled = useRef(false);
  const [url, setUrl] = useState("");
  // Prefill the firm's own site once it's known (was hardcoded to KM).
  useEffect(() => {
    if (!sitePrefilled.current && tenantSite) {
      setUrl(tenantSite);
      sitePrefilled.current = true;
    }
  }, [tenantSite]);

  // AutoPilot fix suggestions — populated by /api/seo/technical/suggest-fixes.
  const [snapshot, setSnapshot] = useState<PageSnapshotSummary | null>(null);
  const [fixes, setFixes] = useState<SuggestedFix[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [queuedKeys, setQueuedKeys] = useState<Set<string>>(new Set());
  const [queuingKey, setQueuingKey] = useState<string | null>(null);

  const suggestFixes = async () => {
    setSuggestError(null);
    setSuggesting(true);
    setFixes([]);
    setSnapshot(null);
    setQueuedKeys(new Set());
    try {
      const res = await fetch("/api/seo/technical/suggest-fixes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSuggestError(json?.error ?? "Suggestion failed");
        return;
      }
      setSnapshot(json.snapshot ?? null);
      setFixes((json.fixes as SuggestedFix[]) ?? []);
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : "Suggestion failed");
    } finally {
      setSuggesting(false);
    }
  };

  const queueFix = async (fix: SuggestedFix) => {
    const key = `${fix.fix_type}:${fix.suggested_value.slice(0, 64)}`;
    setQueuingKey(key);
    try {
      const res = await fetch("/api/seo/technical/queue-fixes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page_url: url, fixes: [fix] }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSuggestError(json?.error ?? "Queue failed");
        return;
      }
      setQueuedKeys((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : "Queue failed");
    } finally {
      setQueuingKey(null);
    }
  };

  const queueAllFixes = async () => {
    const remaining = fixes.filter(
      (f) =>
        !queuedKeys.has(`${f.fix_type}:${f.suggested_value.slice(0, 64)}`),
    );
    if (remaining.length === 0) return;
    setQueuingKey("__all__");
    try {
      const res = await fetch("/api/seo/technical/queue-fixes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page_url: url, fixes: remaining }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSuggestError(json?.error ?? "Queue failed");
        return;
      }
      setQueuedKeys((prev) => {
        const next = new Set(prev);
        for (const f of remaining) {
          next.add(`${f.fix_type}:${f.suggested_value.slice(0, 64)}`);
        }
        return next;
      });
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : "Queue failed");
    } finally {
      setQueuingKey(null);
    }
  };

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
          className="flex-1 min-w-64 rounded-md border border-[#e2e8f0] px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
        <button
          onClick={refresh}
          disabled={loading}
          className="rounded-md border border-[#e2e8f0] px-3 py-2 text-sm font-medium text-slate-700 hover:border-brand hover:text-brand disabled:opacity-50"
        >
          {loading ? "Loading…" : "Reload cached"}
        </button>
        <button
          onClick={runScan}
          disabled={scanning}
          className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
        >
          {scanning ? "Scanning… (60-120s)" : "Re-scan"}
        </button>
        <button
          onClick={suggestFixes}
          disabled={suggesting}
          className="rounded-md bg-violet-700 px-3 py-2 text-sm font-medium text-white hover:bg-violet-600 disabled:opacity-50"
          title="Snapshot the page and ask Claude for AutoPilot-ready fixes"
        >
          {suggesting ? "Analyzing…" : "Suggest AutoPilot fixes"}
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

      {(suggestError || snapshot || fixes.length > 0 || suggesting) && (
        <section className="rounded-xl border border-violet-200 bg-violet-50/30 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                AutoPilot fix suggestions
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                Claude snapshots the live page, compares to best practices, and
                proposes fixes. Queue any that look right — the WordPress
                AutoPilot plugin applies them on its next 15-minute sync.
              </p>
            </div>
            {fixes.length > 0 && (
              <button
                onClick={queueAllFixes}
                disabled={queuingKey !== null}
                className="shrink-0 rounded-md bg-violet-700 px-3 py-2 text-sm font-medium text-white hover:bg-violet-600 disabled:opacity-50"
              >
                {queuingKey === "__all__" ? "Queuing…" : "Queue all"}
              </button>
            )}
          </div>

          {suggestError && (
            <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {suggestError}
            </div>
          )}

          {suggesting && (
            <p className="mt-4 text-sm text-slate-600">
              Fetching page and analyzing… 10-30 seconds.
            </p>
          )}

          {snapshot && fixes.length === 0 && !suggesting && (
            <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              No on-page SEO fixes needed — your meta tags, canonical, and OG
              fields look good. (Detected issues: {snapshot.detectedIssues.length})
            </div>
          )}

          {fixes.length > 0 && (
            <ul className="mt-4 space-y-3">
              {fixes.map((fix, i) => {
                const key = `${fix.fix_type}:${fix.suggested_value.slice(0, 64)}`;
                const queued = queuedKeys.has(key);
                const busy = queuingKey === key;
                return (
                  <li
                    key={`${fix.fix_type}-${i}`}
                    className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                        {FIX_LABELS[fix.fix_type]}
                      </span>
                      <button
                        onClick={() => queueFix(fix)}
                        disabled={queued || busy || queuingKey !== null}
                        className={`shrink-0 rounded-md px-3 py-1 text-xs font-medium ${
                          queued
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
                        }`}
                      >
                        {queued
                          ? "Queued ✓"
                          : busy
                            ? "Queuing…"
                            : "Queue fix"}
                      </button>
                    </div>
                    <p className="mt-2 text-xs italic text-slate-600">
                      {fix.rationale}
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          Current
                        </div>
                        <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-700">
{fix.current_value && fix.current_value.length > 0
  ? fix.current_value
  : "(missing)"}
                        </pre>
                      </div>
                      <div className="rounded-md border border-violet-200 bg-violet-50 p-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                          Suggested
                        </div>
                        <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-800">
{fix.suggested_value}
                        </pre>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
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
