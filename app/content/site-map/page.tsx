"use client";

/**
 * Cluster Map / Site Inventory.
 *
 * Shows every page on the site (crawled from the sitemap), grouped by pillar,
 * so writers can see what already exists before writing — and so the
 * content-overlap checks have data to work with. Re-crawl button + manual
 * pillar override.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

type SitePage = {
  id: string;
  url: string;
  title: string | null;
  h1: string | null;
  page_type: string;
  pillar: string | null;
  practice_area: string | null;
  topics: string[];
  last_crawled_at: string | null;
};

const PILLARS: { id: string; label: string }[] = [
  { id: "wage-theft", label: "Wage Theft and Overtime" },
  { id: "wrongful-termination", label: "Wrongful Termination" },
  { id: "discrimination", label: "Workplace Discrimination" },
  { id: "sexual-harassment", label: "Sexual Harassment" },
  { id: "leave", label: "Leave and Accommodations" },
  { id: "hostile", label: "Hostile Work Environment" },
  { id: "collections-hub", label: "Collections Hub" },
  { id: "judgment-enforcement", label: "Judgment Enforcement" },
  { id: "domestication", label: "Domestication of Judgments" },
];
const PILLAR_LABEL: Record<string, string> = Object.fromEntries(
  PILLARS.map((p) => [p.id, p.label]),
);

const TYPE_LABEL: Record<string, string> = {
  blog_post: "Blog",
  service_page: "Service",
  pillar: "Pillar",
  cluster: "Cluster",
  case_result: "Case result",
  practice_area: "Practice area",
  other: "Other",
};

export default function SiteMapPage() {
  const [pages, setPages] = useState<SitePage[]>([]);
  const [loading, setLoading] = useState(true);
  const [crawling, setCrawling] = useState(false);
  const [crawlMsg, setCrawlMsg] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/content/site-inventory", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setPages(json.pages ?? []);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function recrawl() {
    setCrawling(true);
    setCrawlMsg(null);
    try {
      const res = await fetch("/api/content/site-inventory/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const json = await res.json();
      if (!res.ok) {
        setCrawlMsg(json?.error ?? "crawl failed");
        return;
      }
      setCrawlMsg(
        `Crawled ${json.crawled} pages, ${json.classified} classified into pillars, ${json.skipped} skipped.`,
      );
      load();
    } catch (e) {
      setCrawlMsg(e instanceof Error ? e.message : "crawl failed");
    } finally {
      setCrawling(false);
    }
  }

  async function setPillar(id: string, pillar: string) {
    await fetch("/api/content/site-inventory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, pillar: pillar || null }),
    });
    setPages((prev) =>
      prev.map((p) => (p.id === id ? { ...p, pillar: pillar || null } : p)),
    );
  }

  const filtered = useMemo(
    () => (typeFilter ? pages.filter((p) => p.page_type === typeFilter) : pages),
    [pages, typeFilter],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, SitePage[]>();
    for (const p of filtered) {
      const key = p.pillar ?? "__unassigned__";
      const arr = map.get(key) ?? [];
      arr.push(p);
      map.set(key, arr);
    }
    return map;
  }, [filtered]);

  const orderedKeys = [
    ...PILLARS.map((p) => p.id).filter((id) => grouped.has(id)),
    ...(grouped.has("__unassigned__") ? ["__unassigned__"] : []),
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Content / Cluster Map
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Site Inventory</h1>
        <p className="mt-1 text-sm text-slate-600">
          Every page on the site, crawled from the sitemap and grouped by
          pillar. This is what the content-overlap check reads from — so a
          writer is told quid-pro-quo already has a blog post before they
          redefine it.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <button
          onClick={recrawl}
          disabled={crawling}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {crawling ? "Crawling… (1-3 min)" : "Re-crawl sitemap"}
        </button>
        <select
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">All page types</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <span className="text-sm text-slate-500">{pages.length} pages indexed</span>
        {crawlMsg && <span className="text-xs text-slate-600">{crawlMsg}</span>}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : pages.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          No pages indexed yet. Click <strong>Re-crawl sitemap</strong> to build
          the cluster map from katzmelinger.com/sitemap.xml.
        </div>
      ) : (
        <div className="space-y-6">
          {orderedKeys.map((key) => {
            const rows = grouped.get(key) ?? [];
            return (
              <section key={key}>
                <h2 className="mb-2 text-sm font-semibold text-slate-900">
                  {key === "__unassigned__"
                    ? `Unassigned (${rows.length})`
                    : `${PILLAR_LABEL[key] ?? key} (${rows.length})`}
                </h2>
                <ul className="space-y-1.5">
                  {rows.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-start justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2"
                    >
                      <div className="min-w-0">
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-slate-900 hover:underline"
                        >
                          {p.title ?? p.h1 ?? p.url}
                        </a>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600">
                            {TYPE_LABEL[p.page_type] ?? p.page_type}
                          </span>
                          <span className="truncate">{p.url}</span>
                        </div>
                      </div>
                      <select
                        className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs"
                        value={p.pillar ?? ""}
                        onChange={(e) => setPillar(p.id, e.target.value)}
                        title="Override pillar (locks it against re-crawl)"
                      >
                        <option value="">— pillar —</option>
                        {PILLARS.map((pl) => (
                          <option key={pl.id} value={pl.id}>
                            {pl.label}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
