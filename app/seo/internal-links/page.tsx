"use client";

/**
 * Internal linking audit page.
 *
 * Crawls the sitemap, builds a graph of which crawled pages link to which,
 * and surfaces orphans (no inbound links), thin pages (< 3 outbound), and
 * hubs (top inbound). Snapshots persist so the dashboard renders without a
 * fresh crawl every time.
 */

import { useEffect, useRef, useState } from "react";
import { MarketingNav } from "@/components/marketing-nav";
import { useTenantSiteUrl } from "@/components/tenant-provider";

type Audit = {
  id: string;
  domain: string;
  pages: number;
  total_internal_links: number;
  total_external_links: number;
  orphan_pages: { url: string }[];
  thin_pages: { url: string; outbound: number }[];
  hub_pages: { url: string; inbound: number }[];
  page_graph: { url: string; inbound: number; outbound: number }[];
  created_at: string;
};

export default function InternalLinksPage() {
  const [audit, setAudit] = useState<Audit | null>(null);
  const [scanning, setScanning] = useState(false);
  const tenantSite = useTenantSiteUrl();
  const sitePrefilled = useRef(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Prefill the firm's own site once it's known (was hardcoded to KM).
  useEffect(() => {
    if (!sitePrefilled.current && tenantSite) {
      setUrl(tenantSite);
      sitePrefilled.current = true;
    }
  }, [tenantSite]);

  const refresh = async () => {
    const res = await fetch("/api/seo/internal-links/latest", { cache: "no-store" });
    const data = await res.json();
    setAudit(data.audit ?? null);
  };

  useEffect(() => {
    refresh();
  }, []);

  const scan = async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/seo/internal-links/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "scan failed");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "scan failed");
    }
    setScanning(false);
  };

  return (
    <>
      <MarketingNav />
      <div className="p-6 space-y-6 mx-auto max-w-7xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Internal linking</h1>
          <p className="text-sm opacity-70 mt-1 max-w-2xl">
            Crawls up to 30 pages from the sitemap and computes the link graph.
            Orphans (no other crawled page links to them) and thin pages (less
            than 3 outbound internal links) usually need the most attention.
          </p>
          {audit?.created_at && (
            <p className="text-xs opacity-60 mt-1">
              Last audit: {new Date(audit.created_at).toLocaleString()} · {audit.pages} pages,
              {" "}{audit.total_internal_links} internal links
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="px-3 py-2 rounded-md border border-black/15 dark:border-white/15 bg-transparent text-sm"
          />
          <button
            onClick={scan}
            disabled={scanning}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-foreground text-background disabled:opacity-50"
          >
            {scanning ? "Crawling…" : "Re-scan"}
          </button>
        </div>
      </div>

      {error && (
        <div className="border border-red-500/40 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">{error}</div>
      )}

      {!audit && (
        <div className="border border-black/10 dark:border-white/10 rounded-lg p-10 text-center text-sm opacity-70">
          No audit yet — click Re-scan to start.
        </div>
      )}

      {audit && (
        <div className="grid lg:grid-cols-3 gap-4">
          <Section title="Orphan pages" body="Crawled but no other crawled page links here. Use “Fix” to find existing pages that should link to each one." count={audit.orphan_pages.length}>
            {audit.orphan_pages.length === 0 && <p className="text-xs opacity-60">None — every page has inbound links.</p>}
            <ul className="space-y-1.5 text-xs">
              {audit.orphan_pages.map((p) => (
                <OrphanRow key={p.url} url={p.url} />
              ))}
            </ul>
          </Section>

          <Section title="Thin pages" body="Fewer than 3 outbound internal links. Add navigational context so users (and crawlers) can move further into the site." count={audit.thin_pages.length}>
            {audit.thin_pages.length === 0 && <p className="text-xs opacity-60">No thin pages.</p>}
            <ul className="space-y-1 text-xs">
              {audit.thin_pages.slice(0, 30).map((p) => (
                <li key={p.url} className="flex items-center gap-2">
                  <span className="font-mono opacity-60 w-6 text-right">{p.outbound}</span>
                  <a href={p.url} target="_blank" rel="noreferrer" className="truncate underline opacity-90">{p.url}</a>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Hub pages" body="Top inbound link counts. These pages are central to your site's link equity flow." count={audit.hub_pages.length}>
            <ul className="space-y-1 text-xs">
              {audit.hub_pages.map((p) => (
                <li key={p.url} className="flex items-center gap-2">
                  <span className="font-mono opacity-60 w-6 text-right">{p.inbound}</span>
                  <a href={p.url} target="_blank" rel="noreferrer" className="truncate underline opacity-90">{p.url}</a>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}

      {audit && audit.page_graph.length > 0 && (
        <div className="border border-black/10 dark:border-white/10 rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-black/10 dark:border-white/10 text-sm font-medium">
            Full page graph
          </div>
          <table className="w-full text-xs">
            <thead className="text-left opacity-60">
              <tr>
                <th className="px-4 py-2">URL</th>
                <th className="px-4 py-2 w-20 text-right">Inbound</th>
                <th className="px-4 py-2 w-20 text-right">Outbound</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 dark:divide-white/5">
              {audit.page_graph.map((p) => (
                <tr key={p.url}>
                  <td className="px-4 py-2 truncate"><a href={p.url} target="_blank" rel="noreferrer" className="underline opacity-90">{p.url}</a></td>
                  <td className="px-4 py-2 text-right opacity-80">{p.inbound}</td>
                  <td className="px-4 py-2 text-right opacity-80">{p.outbound}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </>
  );
}

function Section({
  title,
  body,
  count,
  children,
}: {
  title: string;
  body: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-black/10 dark:border-white/10 rounded-lg p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs opacity-60">({count})</span>
      </div>
      <p className="text-xs opacity-60 mt-1 mb-3">{body}</p>
      {children}
    </div>
  );
}

type LinkerSource = {
  url: string;
  title: string | null;
  page_type: string;
  matchedTerm: string;
};
type LinkerSuggestion = {
  orphanUrl: string;
  orphanTitle: string | null;
  anchor: string;
  sources: LinkerSource[];
};

/**
 * One orphan page, with an inline "Fix" action that asks the API which existing
 * pages should link to it (and the anchor text to use), so the orphan stops
 * being a dead-end report and becomes actionable.
 */
function OrphanRow({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LinkerSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fix = async () => {
    if (data) {
      setOpen((v) => !v);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/seo/internal-links/suggest-linkers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "failed");
      setData(json);
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setLoading(false);
    }
  };

  const copyAnchor = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.anchor);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };

  return (
    <li className="rounded-md border border-black/10 dark:border-white/10 p-2">
      <div className="flex items-center justify-between gap-2">
        <a href={url} target="_blank" rel="noreferrer" className="truncate underline opacity-90">
          {url}
        </a>
        <button
          onClick={fix}
          disabled={loading}
          className="shrink-0 rounded border border-black/15 dark:border-white/15 px-2 py-0.5 text-[11px] font-medium hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50"
        >
          {loading ? "Finding…" : data ? (open ? "Hide" : "Show fix") : "Fix"}
        </button>
      </div>

      {error && <p className="mt-1 text-[11px] text-red-700 dark:text-red-400">{error}</p>}

      {open && data && (
        <div className="mt-2 space-y-2 border-t border-black/10 dark:border-white/10 pt-2">
          {data.sources.length === 0 ? (
            <p className="text-[11px] opacity-70">
              No related pages found in the cluster map. This topic may need a new
              hub — or the inventory is empty, in which case run a crawl on the{" "}
              <a href="/content/site-map" className="underline">Cluster Map</a> page first.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="opacity-60">Suggested anchor:</span>
                <span className="font-medium">&ldquo;{data.anchor}&rdquo;</span>
                <button
                  onClick={copyAnchor}
                  className="rounded border border-black/15 dark:border-white/15 px-1.5 py-0.5 text-[10px] hover:bg-black/5 dark:hover:bg-white/10"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div>
                <p className="opacity-60 mb-1">Add a link to this page from:</p>
                <ul className="space-y-1">
                  {data.sources.map((s) => (
                    <li key={s.url} className="flex items-start gap-1.5">
                      <span className="rounded-full border border-black/15 dark:border-white/15 px-1.5 py-0.5 text-[9px] opacity-70 shrink-0">
                        {s.page_type}
                      </span>
                      <a href={s.url} target="_blank" rel="noreferrer" className="truncate underline opacity-90">
                        {s.title?.trim() || s.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}
