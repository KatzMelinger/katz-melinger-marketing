"use client";

/**
 * Backlink Intelligence — interactive.
 *
 * Every stat card now opens a drill-down panel below. The Disavow Manager
 * is a real list with per-domain expand (sample backlinks fetched on
 * demand) plus Copy + Download .txt buttons formatted for Google's
 * Disavow Links tool. The Link Quality table is sortable and each row
 * expands to show actual source URLs.
 */

import { Fragment, useEffect, useMemo, useState } from "react";

import { formatNumber, SeoShell } from "@/components/seo-shell";

type DomainRow = {
  domain: string;
  backlinks: number;
  authorityScore: number;
  toxicityRisk: "low" | "medium" | "high";
  followRatio: number;
};

type BacklinkResponse = {
  overview?: {
    authorityScore: number;
    totalBacklinks: number;
    referringDomains: number;
    followRatio: number;
  };
  domains?: DomainRow[];
  newBacklinksLast30d?: number;
  lostBacklinksLast30d?: number;
  disavowFile?: string;
  linkBuildingOpportunities?: Array<{ domain: string; reason: string }>;
};

type RecentBacklink = {
  sourceUrl: string;
  sourceTitle: string;
  sourceDomain: string;
  pageAuthorityScore: number;
  firstSeenIso: string | null;
  lastSeenIso: string | null;
  nofollow: boolean;
};

type DrillKey = "overview" | "backlinks" | "refdomains" | "new" | "lost" | null;

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return "—";
  }
}

export default function SeoBacklinksPage() {
  const [data, setData] = useState<BacklinkResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [drill, setDrill] = useState<DrillKey>(null);

  // Drill-down: recent backlinks (new / lost)
  const [recentNew, setRecentNew] = useState<RecentBacklink[] | null>(null);
  const [recentLost, setRecentLost] = useState<RecentBacklink[] | null>(null);
  const [recentLoading, setRecentLoading] = useState(false);

  // Domain table — sort + search
  const [domainSearch, setDomainSearch] = useState("");
  const [domainSort, setDomainSort] = useState<"backlinks" | "authority">("backlinks");
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
  const [domainSamples, setDomainSamples] = useState<Record<string, RecentBacklink[] | "loading">>(
    {},
  );

  // Disavow manager
  const [disavowExpanded, setDisavowExpanded] = useState<string | null>(null);
  const [disavowReviewed, setDisavowReviewed] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch("/api/seo/backlinks", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: BacklinkResponse & { error?: string }) => {
        if (d.error) {
          setError(d.error);
        } else {
          setData(d);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const openDrill = (next: DrillKey) => {
    setDrill((cur) => (cur === next ? null : next));
    if (next === "new" && !recentNew) {
      setRecentLoading(true);
      fetch("/api/seo/backlinks/recent?sort=new&limit=50", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => setRecentNew(j.backlinks ?? []))
        .finally(() => setRecentLoading(false));
    }
    if (next === "lost" && !recentLost) {
      setRecentLoading(true);
      fetch("/api/seo/backlinks/recent?sort=lost&limit=50", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => setRecentLost(j.backlinks ?? []))
        .finally(() => setRecentLoading(false));
    }
  };

  const loadDomainSamples = (domain: string) => {
    if (domainSamples[domain]) return;
    setDomainSamples((m) => ({ ...m, [domain]: "loading" }));
    fetch(`/api/seo/backlinks/by-domain?domain=${encodeURIComponent(domain)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((j) =>
        setDomainSamples((m) => ({ ...m, [domain]: (j.backlinks as RecentBacklink[]) ?? [] })),
      )
      .catch(() => setDomainSamples((m) => ({ ...m, [domain]: [] })));
  };

  const toggleDomainExpand = (domain: string) => {
    setExpandedDomain((cur) => {
      const next = cur === domain ? null : domain;
      if (next) loadDomainSamples(next);
      return next;
    });
  };

  const toggleDisavowExpand = (domain: string) => {
    setDisavowExpanded((cur) => {
      const next = cur === domain ? null : domain;
      if (next) loadDomainSamples(next);
      return next;
    });
  };

  const filteredDomains = useMemo(() => {
    const rows = (data?.domains ?? []).slice();
    const q = domainSearch.trim().toLowerCase();
    const filtered = q ? rows.filter((r) => r.domain.toLowerCase().includes(q)) : rows;
    filtered.sort((a, b) => {
      if (domainSort === "authority") return b.authorityScore - a.authorityScore;
      return b.backlinks - a.backlinks;
    });
    return filtered;
  }, [data?.domains, domainSearch, domainSort]);

  const toxicDomains = useMemo(
    () => (data?.domains ?? []).filter((d) => d.toxicityRisk === "high"),
    [data?.domains],
  );

  const disavowText = useMemo(() => {
    const lines = ["# Disavow file generated by Katz Melinger MarketOS"];
    lines.push(`# Generated ${new Date().toISOString().split("T")[0]}`);
    lines.push(`# ${toxicDomains.length} toxic-risk domains (authority < 20)`);
    lines.push("");
    for (const d of toxicDomains) {
      if (disavowReviewed.has(d.domain)) continue;
      lines.push(`domain:${d.domain}`);
    }
    return lines.join("\n");
  }, [toxicDomains, disavowReviewed]);

  const copyDisavow = async () => {
    try {
      await navigator.clipboard.writeText(disavowText);
      alert(`Copied ${toxicDomains.length - disavowReviewed.size} domain entries to clipboard.`);
    } catch {
      alert("Could not copy. Select the text and copy manually.");
    }
  };

  const downloadDisavow = () => {
    const blob = new Blob([disavowText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `disavow-${new Date().toISOString().split("T")[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const overview = data?.overview;

  return (
    <SeoShell
      title="Backlink Intelligence"
      subtitle="Monitor backlink profile quality, detect toxic domains, and identify competitor-informed link opportunities. Click any stat to drill in."
    >
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {loading && !data && (
        <p className="text-sm text-slate-500">Loading backlink data…</p>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Authority score"
          value={formatNumber(overview?.authorityScore ?? 0)}
          hint="Tap for what this means"
          active={drill === "overview"}
          onClick={() => openDrill("overview")}
        />
        <StatCard
          label="Backlinks"
          value={formatNumber(overview?.totalBacklinks ?? 0)}
          hint={`${overview?.followRatio ?? 0}% dofollow`}
          active={drill === "backlinks"}
          onClick={() => openDrill("backlinks")}
        />
        <StatCard
          label="Referring domains"
          value={formatNumber(overview?.referringDomains ?? 0)}
          hint={`${data?.domains?.length ?? 0} sampled`}
          active={drill === "refdomains"}
          onClick={() => openDrill("refdomains")}
        />
        <StatCard
          label="New backlinks (30d)"
          value={formatNumber(data?.newBacklinksLast30d ?? 0)}
          hint="Tap to see recent"
          active={drill === "new"}
          onClick={() => openDrill("new")}
        />
        <StatCard
          label="Lost backlinks (30d)"
          value={formatNumber(data?.lostBacklinksLast30d ?? 0)}
          hint="Tap to see decaying"
          active={drill === "lost"}
          onClick={() => openDrill("lost")}
        />
      </section>

      {drill === "overview" && <AuthorityScoreExplainer score={overview?.authorityScore ?? 0} />}
      {drill === "backlinks" && (
        <DrillCard title="All referring domains by backlink volume" onClose={() => setDrill(null)}>
          <p className="text-xs text-slate-500 mb-3">
            Domains ranked by raw backlink count. Click any row to see sample source URLs.
          </p>
          <DomainsTable
            rows={filteredDomains.slice(0, 100)}
            expandedDomain={expandedDomain}
            onToggle={toggleDomainExpand}
            samples={domainSamples}
            search={domainSearch}
            setSearch={setDomainSearch}
            sort={domainSort}
            setSort={setDomainSort}
          />
        </DrillCard>
      )}
      {drill === "refdomains" && (
        <DrillCard title="Referring domains by authority" onClose={() => setDrill(null)}>
          <p className="text-xs text-slate-500 mb-3">
            Same dataset, sorted by domain authority. High-AS rows are the relationships worth
            protecting / deepening.
          </p>
          <DomainsTable
            rows={filteredDomains.slice(0, 100)}
            expandedDomain={expandedDomain}
            onToggle={toggleDomainExpand}
            samples={domainSamples}
            search={domainSearch}
            setSearch={setDomainSearch}
            sort={domainSort}
            setSort={setDomainSort}
            defaultSort="authority"
          />
        </DrillCard>
      )}
      {drill === "new" && (
        <RecentBacklinksDrill
          title="New backlinks (newest first)"
          loading={recentLoading}
          rows={recentNew ?? []}
          dateField="firstSeenIso"
          onClose={() => setDrill(null)}
        />
      )}
      {drill === "lost" && (
        <RecentBacklinksDrill
          title="Decaying backlinks (oldest last_seen first)"
          loading={recentLoading}
          rows={recentLost ?? []}
          dateField="lastSeenIso"
          onClose={() => setDrill(null)}
          subtitle="Semrush hasn't refreshed these recently — likely candidates for outreach to confirm or reclaim."
        />
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <h2 className="text-lg font-semibold text-slate-900">Link quality scoring</h2>
            <div className="flex items-center gap-2">
              <input
                value={domainSearch}
                onChange={(e) => setDomainSearch(e.target.value)}
                placeholder="Filter domains…"
                className="px-3 py-1.5 text-xs rounded-md border border-[#e2e8f0]"
              />
              <select
                value={domainSort}
                onChange={(e) => setDomainSort(e.target.value as "backlinks" | "authority")}
                className="px-2 py-1.5 text-xs rounded-md border border-[#e2e8f0]"
              >
                <option value="backlinks">Sort: backlinks</option>
                <option value="authority">Sort: authority</option>
              </select>
            </div>
          </div>
          <DomainsTable
            rows={filteredDomains.slice(0, 30)}
            expandedDomain={expandedDomain}
            onToggle={toggleDomainExpand}
            samples={domainSamples}
            compact
          />
        </article>

        <article className="rounded-xl border border-[#e2e8f0] bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">Link building opportunities</h2>
          <p className="mt-1 text-xs text-slate-500">
            Healthy-authority domains worth pursuing for backlinks.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {(data?.linkBuildingOpportunities ?? []).length === 0 && !loading && (
              <li className="text-xs text-slate-400">No opportunities returned.</li>
            )}
            {(data?.linkBuildingOpportunities ?? []).map((item) => (
              <li
                key={item.domain}
                className="flex items-center justify-between gap-2 rounded-md border border-[#e2e8f0] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{item.domain}</p>
                  <p className="text-xs text-slate-500">{item.reason}</p>
                </div>
                <a
                  href={`https://${item.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-xs px-2 py-1 rounded border border-[#185FA5] text-[#185FA5] hover:bg-[#185FA5]/5"
                >
                  Visit →
                </a>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Disavow manager</h2>
            <p className="mt-1 text-xs text-slate-500">
              {toxicDomains.length} toxic-risk domains (authority &lt; 20).
              Click a domain to inspect its backlinks before disavowing. Mark as reviewed to skip
              in the export.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copyDisavow}
              disabled={toxicDomains.length === 0}
              className="text-xs px-3 py-1.5 rounded border border-[#e2e8f0] text-slate-700 hover:border-[#185FA5] hover:text-[#185FA5] disabled:opacity-50"
            >
              📋 Copy
            </button>
            <button
              onClick={downloadDisavow}
              disabled={toxicDomains.length === 0}
              className="text-xs px-3 py-1.5 rounded bg-[#185FA5] text-white hover:bg-[#1f6fb8] disabled:opacity-50"
            >
              ⬇ Download .txt
            </button>
          </div>
        </div>

        <ul className="mt-3 divide-y divide-[#e2e8f0]">
          {toxicDomains.length === 0 && !loading && (
            <li className="py-4 text-sm text-slate-500">No toxic domains detected.</li>
          )}
          {toxicDomains.map((d) => {
            const isExpanded = disavowExpanded === d.domain;
            const isReviewed = disavowReviewed.has(d.domain);
            const samples = domainSamples[d.domain];
            return (
              <li key={d.domain} className={`py-2 ${isReviewed ? "opacity-50" : ""}`}>
                <div className="flex items-center justify-between gap-3">
                  <button
                    onClick={() => toggleDisavowExpand(d.domain)}
                    className="text-left flex-1 hover:text-[#185FA5]"
                  >
                    <p className="text-sm font-medium text-slate-900">
                      {isExpanded ? "▾" : "▸"} {d.domain}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatNumber(d.backlinks)} backlinks · authority {d.authorityScore}
                    </p>
                  </button>
                  <div className="flex items-center gap-2">
                    <a
                      href={`https://${d.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs px-2 py-1 rounded border border-[#e2e8f0] text-slate-700 hover:border-[#185FA5] hover:text-[#185FA5]"
                    >
                      Visit
                    </a>
                    <button
                      onClick={() =>
                        setDisavowReviewed((s) => {
                          const next = new Set(s);
                          if (next.has(d.domain)) next.delete(d.domain);
                          else next.add(d.domain);
                          return next;
                        })
                      }
                      className={`text-xs px-2 py-1 rounded border ${
                        isReviewed
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-[#e2e8f0] text-slate-700 hover:border-emerald-300 hover:text-emerald-700"
                      }`}
                    >
                      {isReviewed ? "✓ keep" : "Mark safe"}
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="mt-2 ml-4 rounded-md border border-[#e2e8f0] bg-slate-50 p-3">
                    {samples === "loading" && (
                      <p className="text-xs text-slate-500">Loading sample backlinks…</p>
                    )}
                    {samples && samples !== "loading" && samples.length === 0 && (
                      <p className="text-xs text-slate-500">
                        No specific backlinks returned by Semrush for this domain in the latest
                        sample.
                      </p>
                    )}
                    {samples && samples !== "loading" && samples.length > 0 && (
                      <ul className="space-y-1 text-xs">
                        {samples.map((s, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="font-mono text-slate-500 shrink-0">
                              {s.nofollow ? "nofollow" : "follow"}
                            </span>
                            <a
                              href={s.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#185FA5] hover:underline truncate"
                            >
                              {s.sourceTitle || s.sourceUrl}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <details className="mt-4">
          <summary className="text-xs text-[#185FA5] cursor-pointer hover:underline">
            Show raw disavow file text
          </summary>
          <textarea
            readOnly
            value={disavowText}
            className="mt-2 h-44 w-full rounded-md border border-[#e2e8f0] bg-white px-3 py-2 text-xs text-slate-700 font-mono"
          />
        </details>
      </section>
    </SeoShell>
  );
}

function StatCard({
  label,
  value,
  hint,
  active,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl border bg-white p-4 transition ${
        active
          ? "border-[#185FA5] ring-2 ring-[#185FA5]/20 shadow-sm"
          : "border-[#e2e8f0] hover:border-[#185FA5]"
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </button>
  );
}

function DrillCard({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[#185FA5]/30 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700 text-lg"
          aria-label="Close panel"
        >
          ×
        </button>
      </div>
      {children}
    </section>
  );
}

function AuthorityScoreExplainer({ score }: { score: number }) {
  const verdict =
    score >= 50 ? "strong" : score >= 30 ? "moderate" : score >= 20 ? "developing" : "weak";
  return (
    <DrillCard title={`Authority Score: ${score} — ${verdict}`} onClose={() => {}}>
      <p className="text-sm text-slate-700">
        Semrush&apos;s Authority Score (0–100) summarizes overall domain quality based on
        backlink profile strength, organic traffic estimates, and natural-link signals.
      </p>
      <ul className="mt-3 ml-5 list-disc text-sm text-slate-700 space-y-1">
        <li>
          <b>50+</b> — competitive in most legal verticals; comparable to mid-sized firms.
        </li>
        <li>
          <b>30–49</b> — moderate; consistent with focused local + niche firms.
        </li>
        <li>
          <b>20–29</b> — developing; outreach + content scale should be the focus.
        </li>
        <li>
          <b>&lt;20</b> — weak; toxic backlinks may be holding you back.
        </li>
      </ul>
      <p className="mt-3 text-xs text-slate-500">
        To move up: earn links from high-AS legal directories (FindLaw, Avvo, Justia), publish
        original case-result content, and clear out toxic links (use the Disavow Manager below).
      </p>
    </DrillCard>
  );
}

function DomainsTable({
  rows,
  expandedDomain,
  onToggle,
  samples,
  compact,
  search,
  setSearch,
  sort,
  setSort,
  defaultSort,
}: {
  rows: DomainRow[];
  expandedDomain: string | null;
  onToggle: (domain: string) => void;
  samples: Record<string, RecentBacklink[] | "loading">;
  compact?: boolean;
  search?: string;
  setSearch?: (s: string) => void;
  sort?: "backlinks" | "authority";
  setSort?: (s: "backlinks" | "authority") => void;
  defaultSort?: "backlinks" | "authority";
}) {
  return (
    <div className="overflow-x-auto">
      {!compact && setSearch && setSort && (
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <input
            value={search ?? ""}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter domains…"
            className="px-3 py-1.5 text-xs rounded-md border border-[#e2e8f0]"
          />
          <select
            value={sort ?? defaultSort ?? "backlinks"}
            onChange={(e) => setSort(e.target.value as "backlinks" | "authority")}
            className="px-2 py-1.5 text-xs rounded-md border border-[#e2e8f0]"
          >
            <option value="backlinks">Sort: backlinks</option>
            <option value="authority">Sort: authority</option>
          </select>
        </div>
      )}
      <table className="w-full min-w-[620px] text-left text-sm">
        <thead className="border-b border-[#e2e8f0] text-slate-500 text-xs">
          <tr>
            <th className="pb-2 pr-3 font-medium">Domain</th>
            <th className="pb-2 pr-3 font-medium">Backlinks</th>
            <th className="pb-2 pr-3 font-medium">Authority</th>
            <th className="pb-2 pr-3 font-medium">Tox</th>
            <th className="pb-2 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-slate-500 text-xs">
                No rows.
              </td>
            </tr>
          )}
          {rows.map((row) => {
            const isExpanded = expandedDomain === row.domain;
            const s = samples[row.domain];
            return (
              <Fragment key={row.domain}>
                <tr className="border-b border-[#e2e8f0]/60 last:border-0 hover:bg-slate-50">
                  <td className="py-2 pr-3 text-slate-900">
                    <button
                      onClick={() => onToggle(row.domain)}
                      className="text-left hover:text-[#185FA5]"
                    >
                      {isExpanded ? "▾" : "▸"} {row.domain}
                    </button>
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{formatNumber(row.backlinks)}</td>
                  <td className="py-2 pr-3 tabular-nums">{row.authorityScore}</td>
                  <td className="py-2 pr-3">
                    <ToxicityBadge tone={row.toxicityRisk} />
                  </td>
                  <td className="py-2 text-right">
                    <a
                      href={`https://${row.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs px-2 py-1 rounded border border-[#e2e8f0] text-slate-700 hover:border-[#185FA5] hover:text-[#185FA5]"
                    >
                      Visit
                    </a>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="bg-slate-50">
                    <td colSpan={5} className="px-3 py-3">
                      {s === "loading" && (
                        <p className="text-xs text-slate-500">Loading sample backlinks…</p>
                      )}
                      {s && s !== "loading" && s.length === 0 && (
                        <p className="text-xs text-slate-500">
                          No specific backlinks returned for this domain.
                        </p>
                      )}
                      {s && s !== "loading" && s.length > 0 && (
                        <ul className="space-y-1 text-xs">
                          {s.map((b, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <span className="font-mono text-slate-500 shrink-0">
                                {b.nofollow ? "nofollow" : "follow"}
                              </span>
                              <a
                                href={b.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#185FA5] hover:underline truncate"
                              >
                                {b.sourceTitle || b.sourceUrl}
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ToxicityBadge({ tone }: { tone: "low" | "medium" | "high" }) {
  const colors: Record<string, string> = {
    low: "bg-emerald-50 text-emerald-700 border-emerald-200",
    medium: "bg-amber-50 text-amber-700 border-amber-200",
    high: "bg-red-50 text-red-700 border-red-200",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${colors[tone]}`}>{tone}</span>
  );
}

function RecentBacklinksDrill({
  title,
  subtitle,
  loading,
  rows,
  dateField,
  onClose,
}: {
  title: string;
  subtitle?: string;
  loading: boolean;
  rows: RecentBacklink[];
  dateField: "firstSeenIso" | "lastSeenIso";
  onClose: () => void;
}) {
  return (
    <DrillCard title={title} onClose={onClose}>
      {subtitle && <p className="text-xs text-slate-500 mb-3">{subtitle}</p>}
      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {!loading && rows.length === 0 && (
        <p className="text-sm text-slate-500">No backlinks returned.</p>
      )}
      <ul className="divide-y divide-[#e2e8f0]">
        {rows.map((b, i) => (
          <li key={i} className="py-2 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <a
                href={b.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-slate-900 hover:text-[#185FA5] hover:underline"
              >
                {b.sourceTitle || b.sourceUrl}
              </a>
              <p className="text-xs text-slate-500">
                {b.sourceDomain} · AS {b.pageAuthorityScore} ·{" "}
                {b.nofollow ? "nofollow" : "dofollow"} · {formatDate(b[dateField])}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </DrillCard>
  );
}
