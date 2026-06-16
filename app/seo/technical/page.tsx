"use client";

/**
 * Technical SEO monitoring — Core Web Vitals + schema + crawl errors.
 *
 * Renders the latest cached scan from technical_seo_runs immediately, with
 * a "Re-scan" button that triggers a fresh PageSpeed run (slow, ~60-120s
 * for both mobile + desktop). The previous server-rendered version blocked
 * the page on PageSpeed and timed out on Vercel.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

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
  const [tab, setTab] = useState<"health" | "autopilot" | "settings">("health");
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
      title="Technical SEO"
      subtitle="Site health, AutoPilot fixes, and connection settings — in one place."
    >
      <nav className="flex gap-1 border-b border-[#e2e8f0]">
        {(
          [
            ["health", "Site Health"],
            ["autopilot", "AutoPilot Fixes"],
            ["settings", "Settings"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "border-brand text-brand"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "autopilot" && <AutoPilotFixesTab siteUrl={url} />}

      {tab === "settings" && <SettingsTab />}

      {tab === "health" && (
      <>
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

// ---------------------------------------------------------------------------
// AutoPilot Fixes — full lifecycle of every fix pushed to WordPress.
// Reads /api/seo/technical/autopilot-fixes (all statuses for the tenant site),
// surfaces failed / needs-manual fixes that the plugin reported back, and lets
// a marketer Retry them (flip back to 'approved' for the next sync).
// ---------------------------------------------------------------------------

type FixStatusKey =
  | "pending"
  | "approved"
  | "applied"
  | "rejected"
  | "reverted"
  | "failed"
  | "needs_manual";

type DashboardFix = {
  id: string;
  page_url: string;
  fix_type: string;
  current_value: string | null;
  suggested_value: string;
  applied_value: string | null;
  status: FixStatusKey;
  failure_reason: string | null;
  failed_at: string | null;
  applied_at: string | null;
  updated_at: string;
  attempts: number;
};

const STATUS_META: Record<
  FixStatusKey,
  { label: string; badge: string; dot: string }
> = {
  pending: {
    label: "Suggested",
    badge: "bg-slate-50 text-slate-600 border-slate-200",
    dot: "bg-slate-400",
  },
  approved: {
    label: "Queued",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-500",
  },
  applied: {
    label: "Applied",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
  },
  needs_manual: {
    label: "Needs manual",
    badge: "bg-orange-50 text-orange-700 border-orange-200",
    dot: "bg-orange-500",
  },
  failed: {
    label: "Failed",
    badge: "bg-red-50 text-red-700 border-red-200",
    dot: "bg-red-500",
  },
  rejected: {
    label: "Rejected",
    badge: "bg-slate-50 text-slate-500 border-slate-200",
    dot: "bg-slate-300",
  },
  reverted: {
    label: "Reverted",
    badge: "bg-slate-50 text-slate-500 border-slate-200",
    dot: "bg-slate-300",
  },
};

const ALL_FIX_LABELS: Record<string, string> = {
  meta_title: "Meta title",
  meta_description: "Meta description",
  canonical: "Canonical URL",
  schema_jsonld: "JSON-LD schema",
  og_title: "Open Graph title",
  og_description: "Open Graph description",
  h1: "H1 heading",
  internal_link_insert: "Internal link",
  alt_text: "Image alt text",
};

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function pagePath(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname || "/";
  } catch {
    return rawUrl;
  }
}

type FixFilter = "all" | "attention" | "queued" | "applied";

function AutoPilotFixesTab({ siteUrl }: { siteUrl: string }) {
  const [items, setItems] = useState<DashboardFix[]>([]);
  const [counts, setCounts] = useState<Record<FixStatusKey, number> | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FixFilter>("all");
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = siteUrl ? `?url=${encodeURIComponent(siteUrl)}` : "";
      const res = await fetch(`/api/seo/technical/autopilot-fixes${qs}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Failed to load fixes");
        return;
      }
      setItems((json.items as DashboardFix[]) ?? []);
      setCounts((json.counts as Record<FixStatusKey, number>) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load fixes");
    } finally {
      setLoading(false);
    }
  }, [siteUrl]);

  useEffect(() => {
    load();
  }, [load]);

  const retry = async (id: string) => {
    setRetryingId(id);
    try {
      const res = await fetch("/api/seo/technical/autopilot-fixes/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Retry failed");
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setRetryingId(null);
    }
  };

  const lastSync = items.find((i) => i.applied_at)?.applied_at ?? null;

  const filtered = items.filter((i) => {
    if (filter === "attention")
      return i.status === "failed" || i.status === "needs_manual";
    if (filter === "queued") return i.status === "approved";
    if (filter === "applied") return i.status === "applied";
    return true;
  });

  const cards: Array<{ key: FixStatusKey; label: string; accent: string }> = [
    { key: "pending", label: "Suggested", accent: "text-slate-700" },
    { key: "approved", label: "Queued", accent: "text-amber-700" },
    { key: "applied", label: "Applied", accent: "text-emerald-700" },
    { key: "needs_manual", label: "Needs manual", accent: "text-orange-700" },
    { key: "failed", label: "Failed", accent: "text-red-700" },
  ];

  const filters: Array<{ key: FixFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "attention", label: "Needs attention" },
    { key: "queued", label: "Queued" },
    { key: "applied", label: "Applied" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">AutoPilot fixes</h2>
          <p className="text-xs text-slate-500 mt-1">
            Full lifecycle of every fix pushed to WordPress.
            {lastSync && (
              <span> Last applied {timeAgo(lastSync)}.</span>
            )}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="shrink-0 rounded-md border border-[#e2e8f0] px-3 py-2 text-sm font-medium text-slate-700 hover:border-brand hover:text-brand disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {cards.map((c) => (
          <div
            key={c.key}
            className="rounded-xl border border-[#e2e8f0] bg-white p-3"
          >
            <div className="text-xs text-slate-500">{c.label}</div>
            <div className={`mt-1 text-2xl font-semibold ${c.accent}`}>
              {counts ? counts[c.key] : "—"}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-md border px-3 py-1 text-xs font-medium ${
              filter === f.key
                ? "border-brand bg-brand/5 text-brand"
                : "border-[#e2e8f0] text-slate-600 hover:text-slate-900"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && items.length === 0 ? (
        <p className="text-sm text-slate-500">Loading fixes…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#e2e8f0] bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-700">No fixes here yet</p>
          <p className="mt-1 text-xs text-slate-500">
            Approve fixes from the <span className="font-medium">Site Health</span>{" "}
            tab and they&apos;ll show up here as they move through the queue.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
          <div className="flex items-center gap-3 border-b border-[#e2e8f0] bg-slate-50 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            <span className="flex-1">Page · fix</span>
            <span className="w-28">Status</span>
            <span className="w-20">Updated</span>
            <span className="w-16 text-right">Action</span>
          </div>
          {filtered.map((fix) => {
            const meta = STATUS_META[fix.status];
            const canRetry =
              fix.status === "failed" || fix.status === "needs_manual";
            const isFailing = canRetry;
            const expanded = expandedId === fix.id;
            return (
              <div
                key={fix.id}
                className={`border-b border-[#e2e8f0] last:border-b-0 ${
                  isFailing ? "bg-red-50/30" : ""
                }`}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    onClick={() => setExpandedId(expanded ? null : fix.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    aria-expanded={expanded}
                  >
                    <span
                      className={`text-slate-400 transition-transform ${
                        expanded ? "rotate-90" : ""
                      }`}
                      aria-hidden
                    >
                      ›
                    </span>
                    <span className="min-w-0">
                      <span
                        className="block truncate text-sm text-slate-900"
                        title={fix.page_url}
                      >
                        {pagePath(fix.page_url)}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {ALL_FIX_LABELS[fix.fix_type] ?? fix.fix_type}
                        {isFailing && fix.failure_reason && (
                          <span className="text-red-600">
                            {" · "}
                            {fix.failure_reason}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                  <span className="w-28">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.badge}`}
                    >
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dot}`}
                        aria-hidden
                      />
                      {meta.label}
                    </span>
                  </span>
                  <span className="w-20 text-xs text-slate-400">
                    {timeAgo(fix.updated_at)}
                  </span>
                  <span className="w-16 text-right">
                    {canRetry ? (
                      <button
                        onClick={() => retry(fix.id)}
                        disabled={retryingId === fix.id}
                        className="text-xs font-medium text-brand hover:underline disabled:opacity-50"
                      >
                        {retryingId === fix.id ? "…" : "Retry"}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </span>
                </div>

                {expanded && (
                  <div className="space-y-2 border-t border-[#e2e8f0] bg-slate-50 px-4 py-3 pl-9 text-xs">
                    {fix.current_value && (
                      <FixValue
                        label="Currently on the page"
                        value={fix.current_value}
                        tone="slate"
                      />
                    )}
                    {fix.status === "applied" && fix.applied_value ? (
                      <FixValue
                        label="Applied to WordPress"
                        value={fix.applied_value}
                        tone="emerald"
                      />
                    ) : (
                      <FixValue
                        label={
                          fix.status === "applied"
                            ? "Value"
                            : "Will be set to"
                        }
                        value={fix.suggested_value}
                        tone="violet"
                      />
                    )}
                    {isFailing && fix.failure_reason && (
                      <FixValue
                        label="Why it didn't apply"
                        value={fix.failure_reason}
                        tone="red"
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SettingsTab() {
  return (
    <div className="space-y-4">
      <article className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-900">
          Connection settings
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          The WordPress domain, AutoPilot token, and plugin connection live on the
          dedicated WordPress settings page — kept in one place so there&apos;s a
          single source of truth for the token.
        </p>
        <Link
          href="/settings/wordpress"
          className="mt-4 inline-flex items-center gap-1 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90"
        >
          Open WordPress settings →
        </Link>
      </article>
      <article className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-900">Sync frequency</h2>
        <p className="mt-1 text-sm text-slate-600">
          The KM AutoPilot plugin polls for approved fixes every ~15 minutes via
          WP-Cron. That cadence is set in the plugin itself — adjust it there, or
          use <span className="font-medium">Sync now</span> in the plugin admin to
          run immediately.
        </p>
      </article>
    </div>
  );
}

function FixValue({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "slate" | "violet" | "emerald" | "red";
}) {
  const toneCls = {
    slate: "border-slate-200 bg-white text-slate-700",
    violet: "border-violet-200 bg-violet-50 text-slate-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    red: "border-red-200 bg-red-50 text-red-800",
  }[tone];
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <pre
        className={`mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border px-2 py-1.5 ${toneCls}`}
      >
        {value}
      </pre>
    </div>
  );
}
