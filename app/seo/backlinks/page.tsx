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
import { APP_NAME } from "@/lib/app-config";

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
  linkBuildingOpportunities?: Array<{
    domain: string;
    reason: string;
    authorityScore?: number;
    backlinks?: number;
  }>;
};

type DisavowStatus = "pending" | "disavowed" | "outreach_sent" | "safe";

type DisavowAction = {
  domain: string;
  status: DisavowStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
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

  // Disavow manager — status persists to Supabase via /api/seo/backlinks/disavow.
  const [disavowExpanded, setDisavowExpanded] = useState<string | null>(null);
  const [disavowActions, setDisavowActions] = useState<Record<string, DisavowAction>>({});
  const [disavowBusy, setDisavowBusy] = useState<string | null>(null);

  const reloadDisavow = async () => {
    const res = await fetch("/api/seo/backlinks/disavow", { cache: "no-store" });
    const json = (await res.json()) as { actions?: DisavowAction[] };
    const map: Record<string, DisavowAction> = {};
    for (const a of json.actions ?? []) map[a.domain] = a;
    setDisavowActions(map);
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch("/api/seo/backlinks", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/seo/backlinks/disavow", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => ({ actions: [] })),
    ])
      .then(([d, dActions]) => {
        const dr = d as BacklinkResponse & { error?: string };
        if (dr.error) {
          setError(dr.error);
        } else {
          setData(dr);
        }
        const map: Record<string, DisavowAction> = {};
        for (const a of (dActions.actions as DisavowAction[] | undefined) ?? []) {
          map[a.domain] = a;
        }
        setDisavowActions(map);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const setDisavowState = async (domain: string, status: DisavowStatus | null) => {
    setDisavowBusy(domain);
    try {
      if (status === null) {
        await fetch(`/api/seo/backlinks/disavow?domain=${encodeURIComponent(domain)}`, {
          method: "DELETE",
        });
      } else {
        await fetch("/api/seo/backlinks/disavow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain, status }),
        });
      }
      await reloadDisavow();
    } finally {
      setDisavowBusy(null);
    }
  };

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

  // Link quality scoring view excludes domains we've already disavowed in
  // Google Search Console — they shouldn't count toward our visible link
  // profile because Google is being told to ignore them. We still keep the
  // raw `filteredDomains` for the drill-downs (All / By authority) where the
  // intent is to see everything in the dataset.
  const qualityScoreDomains = useMemo(
    () =>
      filteredDomains.filter(
        (d) => disavowActions[d.domain]?.status !== "disavowed",
      ),
    [filteredDomains, disavowActions],
  );
  const disavowedHiddenCount = filteredDomains.length - qualityScoreDomains.length;

  const toxicDomains = useMemo(
    () => (data?.domains ?? []).filter((d) => d.toxicityRisk === "high"),
    [data?.domains],
  );

  // The export only includes domains whose status is "pending" (default):
  // already-disavowed domains shouldn't be re-listed, safe domains were
  // false positives, outreach_sent are being handled out-of-band.
  const pendingForExport = useMemo(
    () =>
      toxicDomains.filter((d) => {
        const action = disavowActions[d.domain];
        return !action || action.status === "pending";
      }),
    [toxicDomains, disavowActions],
  );

  const statusCounts = useMemo(() => {
    const counts = { pending: 0, disavowed: 0, outreach_sent: 0, safe: 0 };
    for (const d of toxicDomains) {
      const status = disavowActions[d.domain]?.status ?? "pending";
      counts[status]++;
    }
    return counts;
  }, [toxicDomains, disavowActions]);

  const disavowText = useMemo(() => {
    const lines = [`# Disavow file generated by ${APP_NAME}`];
    lines.push(`# Generated ${new Date().toISOString().split("T")[0]}`);
    lines.push(
      `# ${pendingForExport.length} pending domains (of ${toxicDomains.length} total toxic-risk)`,
    );
    lines.push("");
    for (const d of pendingForExport) {
      lines.push(`domain:${d.domain}`);
    }
    return lines.join("\n");
  }, [pendingForExport, toxicDomains.length]);

  const copyDisavow = async () => {
    try {
      await navigator.clipboard.writeText(disavowText);
      alert(`Copied ${pendingForExport.length} domain entries to clipboard.`);
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

  /**
   * One-click "Submit to Google":
   *   1. Copies the current disavow .txt to clipboard
   *   2. Opens Google's Disavow Tool in a new tab
   * The user pastes/uploads on Search Console (no API for this step).
   */
  const submitToGoogle = async () => {
    if (pendingForExport.length === 0) {
      alert("No pending domains to disavow.");
      return;
    }
    try {
      await navigator.clipboard.writeText(disavowText);
    } catch {
      /* clipboard might be blocked; we still open the tool */
    }
    window.open("https://search.google.com/search-console/disavow-links", "_blank");
    alert(
      `Copied ${pendingForExport.length} domain entries to clipboard.\n\n` +
        "On the Disavow Tool page that just opened:\n" +
        "1. Select your property in Search Console\n" +
        '2. Click "Upload disavow file"\n' +
        "3. Paste or upload the copied content (or use Download .txt)\n" +
        '4. Come back here and click "Mark all pending as disavowed".',
    );
  };

  const markAllPendingAsDisavowed = async () => {
    if (pendingForExport.length === 0) return;
    if (
      !confirm(
        `Mark ${pendingForExport.length} pending domains as disavowed? ` +
          "Do this after you upload the file to Google Search Console.",
      )
    ) {
      return;
    }
    setDisavowBusy("__bulk__");
    try {
      for (const d of pendingForExport) {
        await fetch("/api/seo/backlinks/disavow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: d.domain, status: "disavowed" }),
        });
      }
      await reloadDisavow();
    } finally {
      setDisavowBusy(null);
    }
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
          label="Authority"
          value={formatNumber(overview?.authorityScore ?? 0)}
          hint="Relative trend — tap to learn more"
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
          {disavowedHiddenCount > 0 ? (
            <p className="mb-2 text-xs text-slate-500">
              Hiding {disavowedHiddenCount} disavowed domain
              {disavowedHiddenCount === 1 ? "" : "s"} — these don&apos;t count toward
              link quality because Google is being told to ignore them.
            </p>
          ) : null}
          <DomainsTable
            rows={qualityScoreDomains.slice(0, 30)}
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
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-slate-900 truncate">{item.domain}</p>
                    {typeof item.authorityScore === "number" && (
                      <AuthorityBadge score={item.authorityScore} />
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {item.reason}
                    {typeof item.backlinks === "number" && item.backlinks > 0 && (
                      <>
                        {" · "}
                        {formatNumber(item.backlinks)} existing backlinks
                      </>
                    )}
                  </p>
                </div>
                <a
                  href={`https://${item.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-xs px-2 py-1 rounded border border-brand text-brand hover:bg-brand/5"
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
              {toxicDomains.length} toxic-risk domains (authority &lt; 20). Click a domain to
              inspect its backlinks before submitting. Status persists across reloads.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={copyDisavow}
              disabled={pendingForExport.length === 0}
              className="text-xs px-3 py-1.5 rounded border border-[#e2e8f0] text-slate-700 hover:border-brand hover:text-brand disabled:opacity-50"
            >
              📋 Copy ({pendingForExport.length})
            </button>
            <button
              onClick={downloadDisavow}
              disabled={pendingForExport.length === 0}
              className="text-xs px-3 py-1.5 rounded border border-[#e2e8f0] text-slate-700 hover:border-brand hover:text-brand disabled:opacity-50"
            >
              ⬇ Download .txt
            </button>
            <button
              onClick={submitToGoogle}
              disabled={pendingForExport.length === 0}
              className="text-xs px-3 py-1.5 rounded bg-brand text-white hover:bg-brand/90 disabled:opacity-50"
              title="Copies the disavow file to clipboard and opens Google's Disavow Tool"
            >
              🚀 Submit to Google →
            </button>
            <button
              onClick={markAllPendingAsDisavowed}
              disabled={pendingForExport.length === 0 || disavowBusy === "__bulk__"}
              className="text-xs px-3 py-1.5 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
              title="After uploading to Google, click here to mark all pending domains as disavowed"
            >
              {disavowBusy === "__bulk__"
                ? "Marking…"
                : `✓ Mark all pending as disavowed`}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          <StatusChip label="Pending" count={statusCounts.pending} tone="amber" />
          <StatusChip label="Disavowed" count={statusCounts.disavowed} tone="emerald" />
          <StatusChip label="Outreach sent" count={statusCounts.outreach_sent} tone="blue" />
          <StatusChip label="Safe" count={statusCounts.safe} tone="neutral" />
        </div>

        <ul className="mt-3 divide-y divide-[#e2e8f0]">
          {toxicDomains.length === 0 && !loading && (
            <li className="py-4 text-sm text-slate-500">No toxic domains detected.</li>
          )}
          {toxicDomains.map((d) => {
            const isExpanded = disavowExpanded === d.domain;
            const action = disavowActions[d.domain];
            const status: DisavowStatus = action?.status ?? "pending";
            const isBusy = disavowBusy === d.domain;
            const samples = domainSamples[d.domain];
            const dim = status === "disavowed" || status === "safe";
            return (
              <li key={d.domain} className={`py-2 ${dim ? "opacity-60" : ""}`}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <button
                    onClick={() => toggleDisavowExpand(d.domain)}
                    className="text-left flex-1 hover:text-brand min-w-0"
                  >
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {isExpanded ? "▾" : "▸"} {d.domain}{" "}
                      <DisavowStatusPill status={status} />
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatNumber(d.backlinks)} backlinks · authority {d.authorityScore}
                    </p>
                  </button>
                  <div className="flex items-center gap-1 flex-wrap">
                    <a
                      href={`https://${d.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs px-2 py-1 rounded border border-[#e2e8f0] text-slate-700 hover:border-brand hover:text-brand"
                    >
                      Visit
                    </a>
                    <DisavowStatusButton
                      currentStatus={status}
                      target="disavowed"
                      label="✓ Disavowed"
                      busy={isBusy}
                      onClick={() => setDisavowState(d.domain, "disavowed")}
                    />
                    <DisavowStatusButton
                      currentStatus={status}
                      target="outreach_sent"
                      label="✉ Outreach"
                      busy={isBusy}
                      onClick={() => setDisavowState(d.domain, "outreach_sent")}
                    />
                    <DisavowStatusButton
                      currentStatus={status}
                      target="safe"
                      label="Safe"
                      busy={isBusy}
                      onClick={() => setDisavowState(d.domain, "safe")}
                    />
                    {status !== "pending" && (
                      <button
                        onClick={() => setDisavowState(d.domain, null)}
                        disabled={isBusy}
                        className="text-xs px-2 py-1 rounded text-slate-400 hover:text-slate-700 disabled:opacity-50"
                        title="Reset to pending"
                      >
                        ↺
                      </button>
                    )}
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
                      <ul className="space-y-1.5 text-xs">
                        {samples.map((s, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <AuthorityBadge score={s.pageAuthorityScore} />
                            <span
                              className={`font-mono shrink-0 text-[10px] px-1 rounded ${
                                s.nofollow
                                  ? "bg-slate-100 text-slate-500"
                                  : "bg-emerald-50 text-emerald-700"
                              }`}
                            >
                              {s.nofollow ? "nofollow" : "follow"}
                            </span>
                            <a
                              href={s.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-brand hover:underline truncate min-w-0"
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
          <summary className="text-xs text-brand cursor-pointer hover:underline">
            Show raw disavow file text ({pendingForExport.length} pending)
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
          ? "border-brand ring-2 ring-brand/20 shadow-sm"
          : "border-[#e2e8f0] hover:border-brand"
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
    <section className="rounded-xl border border-brand/30 bg-white p-5 shadow-sm">
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
    <DrillCard title={`Authority: ${score} — ${verdict}`} onClose={() => {}}>
      <p className="text-sm text-slate-700">
        Authority (0–100) summarizes overall domain quality based on backlink profile
        strength and natural-link signals, derived from DataForSEO&apos;s domain rank.
      </p>
      <p className="mt-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
        Read this as a <b>relative trend</b>, not an absolute number. Each provider scores
        authority on its own proprietary scale, so it&apos;s most useful watched over time and
        compared against competitors — not taken as a fixed grade.
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
                      className="text-left hover:text-brand"
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
                      className="text-xs px-2 py-1 rounded border border-[#e2e8f0] text-slate-700 hover:border-brand hover:text-brand"
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
                                className="text-brand hover:underline truncate"
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

function StatusChip({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "amber" | "emerald" | "blue" | "neutral";
}) {
  const colors: Record<string, string> = {
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    neutral: "border-slate-200 bg-slate-50 text-slate-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full border ${colors[tone]}`}>
      {label}: <b className="tabular-nums">{count}</b>
    </span>
  );
}

function DisavowStatusPill({ status }: { status: DisavowStatus }) {
  if (status === "pending") return null;
  const meta: Record<Exclude<DisavowStatus, "pending">, { label: string; tone: string }> = {
    disavowed: { label: "✓ disavowed", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
    outreach_sent: { label: "✉ outreach sent", tone: "border-blue-200 bg-blue-50 text-blue-700" },
    safe: { label: "safe", tone: "border-slate-200 bg-slate-50 text-slate-600" },
  };
  const m = meta[status];
  return (
    <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded border ${m.tone}`}>
      {m.label}
    </span>
  );
}

function DisavowStatusButton({
  currentStatus,
  target,
  label,
  busy,
  onClick,
}: {
  currentStatus: DisavowStatus;
  target: DisavowStatus;
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  const isActive = currentStatus === target;
  const tones: Record<DisavowStatus, { active: string; inactive: string }> = {
    pending: {
      active: "border-amber-300 bg-amber-50 text-amber-700",
      inactive: "border-[#e2e8f0] text-slate-700 hover:border-amber-300 hover:text-amber-700",
    },
    disavowed: {
      active: "border-emerald-300 bg-emerald-50 text-emerald-700",
      inactive: "border-[#e2e8f0] text-slate-700 hover:border-emerald-300 hover:text-emerald-700",
    },
    outreach_sent: {
      active: "border-blue-300 bg-blue-50 text-blue-700",
      inactive: "border-[#e2e8f0] text-slate-700 hover:border-blue-300 hover:text-blue-700",
    },
    safe: {
      active: "border-slate-300 bg-slate-100 text-slate-700",
      inactive: "border-[#e2e8f0] text-slate-700 hover:border-slate-300",
    },
  };
  const t = tones[target];
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`text-xs px-2 py-1 rounded border disabled:opacity-50 ${
        isActive ? t.active : t.inactive
      }`}
    >
      {label}
    </button>
  );
}

function AuthorityBadge({ score }: { score: number }) {
  const tone =
    score >= 60
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : score >= 40
        ? "bg-blue-50 text-blue-700 border-blue-200"
        : score >= 20
          ? "bg-amber-50 text-amber-700 border-amber-200"
          : "bg-red-50 text-red-700 border-red-200";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${tone}`}>
      AS {score}
    </span>
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
                className="text-sm text-slate-900 hover:text-brand hover:underline"
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
