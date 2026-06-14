"use client";

/**
 * SEO Opportunity Radar — the system, not a list.
 *
 * Reads the persistent seo_opportunities table (populated by
 * /api/seo/opportunities/sync). The default view shows only actionable rows:
 * junk/branded/navigational keywords are filtered out (Show excluded reveals
 * them), keywords KM already has a page for are hidden as refresh candidates
 * (Show covered), and keywords already acted on drop out (Show handled).
 *
 * Each row is classified into a KM content type (Practice Page / Blog / Case
 * Result) and practice area. Acting on a row writes back to the table, so it
 * persists across reloads and re-syncs — the module has memory.
 *
 * The per-row "Create Brief" KM wizard + generation land in Phase C.
 */

import { useCallback, useEffect, useState } from "react";

import { KmBriefWizard } from "@/components/km-brief-wizard";
import { formatNumber, SeoShell } from "@/components/seo-shell";

type Opportunity = {
  id: string;
  keyword: string;
  source: string;
  listName: string | null;
  competitor: string | null;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  intent: string | null;
  practiceArea: string | null;
  pillarId: string | null;
  recommendedContentType: string | null;
  relevanceScore: number;
  excluded: boolean;
  excludeReason: string | null;
  flags: string[];
  existingUrl: string | null;
  status: string;
};

type Payload = {
  opportunities: Opportunity[];
  counts: { total: number; actionable: number; excluded: number; covered: number; handled: number };
  lastSyncedAt: string | null;
  error?: string;
};

const SOURCE_LABEL: Record<string, string> = {
  quickwin: "Quick win",
  missing: "Missing target",
  longtail: "Long-tail",
  imported: "Imported",
};

const TYPE_LABEL: Record<string, string> = {
  practice_page: "Practice Page",
  blog_post: "Blog",
  case_result: "Case Result",
};

const TYPE_TONE: Record<string, string> = {
  practice_page: "bg-blue-50 text-blue-700",
  blog_post: "bg-emerald-50 text-emerald-700",
  case_result: "bg-amber-50 text-amber-700",
};

const PRACTICE_LABEL: Record<string, string> = {
  employment: "Employment",
  collections: "Collections",
};

function relevanceTone(score: number): string {
  if (score >= 70) return "bg-emerald-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-red-500";
}

export default function SeoOpportunitiesPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const [showCovered, setShowCovered] = useState(false);
  const [showHandled, setShowHandled] = useState(false);
  const [wizardOpp, setWizardOpp] = useState<Opportunity | null>(null);
  const [scratchOpen, setScratchOpen] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [listFilter, setListFilter] = useState<string>("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const include = [
      showExcluded ? "excluded" : null,
      showCovered ? "covered" : null,
      showHandled ? "handled" : null,
    ].filter(Boolean);
    const query = include.length ? `?include=${include.join(",")}` : "";
    try {
      const res = await fetch(`/api/seo/opportunities${query}`, { cache: "no-store" });
      const json = (await res.json()) as Payload;
      if (!res.ok) throw new Error(json?.error || "Failed to load");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [showExcluded, showCovered, showHandled]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const refresh = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/seo/opportunities/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Sync failed");
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const setStatus = async (id: string, status: string) => {
    setData((prev) =>
      prev
        ? { ...prev, opportunities: prev.opportunities.filter((o) => o.id !== id) }
        : prev,
    );
    try {
      await fetch(`/api/seo/opportunities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } catch {
      fetchData();
    }
  };

  const counts = data?.counts;
  const allRows = data?.opportunities ?? [];
  const listNames = Array.from(
    new Set(allRows.map((o) => o.listName).filter((n): n is string => !!n)),
  ).sort();
  const rows =
    listFilter === "all" ? allRows : allRows.filter((o) => o.listName === listFilter);

  return (
    <SeoShell
      title="SEO Opportunity Radar"
      subtitle="Filtered, scored, and classified keyword opportunities — junk and branded terms removed, already-covered terms hidden, and handled keywords stay gone."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Actionable" value={counts?.actionable ?? 0} tone="emerald" />
        <KpiTile label="Filtered out" value={counts?.excluded ?? 0} tone="slate" />
        <KpiTile label="Already covered" value={counts?.covered ?? 0} tone="slate" />
        <KpiTile label="Handled" value={counts?.handled ?? 0} tone="slate" />
      </section>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#e2e8f0] bg-slate-50 px-4 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showExcluded} onChange={(e) => setShowExcluded(e.target.checked)} />
            <span className="text-slate-700">Show excluded (junk / branded)</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showCovered} onChange={(e) => setShowCovered(e.target.checked)} />
            <span className="text-slate-700">Show already covered</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showHandled} onChange={(e) => setShowHandled(e.target.checked)} />
            <span className="text-slate-700">Show handled</span>
          </label>
          {listNames.length > 0 && (
            <label className="inline-flex items-center gap-2">
              <span className="text-slate-500">List:</span>
              <select
                value={listFilter}
                onChange={(e) => setListFilter(e.target.value)}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
              >
                <option value="all">All lists</option>
                {listNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-slate-500">
            {data?.lastSyncedAt
              ? `Synced ${new Date(data.lastSyncedAt).toLocaleString()}`
              : "Never synced"}
          </span>
          <button
            onClick={() => setScratchOpen(true)}
            className="rounded-md border border-brand px-3 py-1.5 font-medium text-brand hover:bg-brand/5"
          >
            New brief from scratch
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="rounded-md border border-brand px-3 py-1.5 font-medium text-brand hover:bg-brand/5"
          >
            Import SEMrush list
          </button>
          <button
            onClick={refresh}
            disabled={syncing}
            className="rounded-md bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand/90 disabled:opacity-50"
          >
            {syncing ? "Refreshing…" : "Refresh opportunities"}
          </button>
        </div>
      </div>

      <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-[#e2e8f0] text-xs text-slate-500">
              <tr>
                <th className="pb-2 pr-3 font-medium">Keyword</th>
                <th className="pb-2 pr-3 font-medium w-32">Relevance</th>
                <th className="pb-2 pr-3 font-medium">Volume</th>
                <th className="pb-2 pr-3 font-medium">Suggested type</th>
                <th className="pb-2 pr-3 font-medium">Status</th>
                <th className="pb-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500">
                    Loading opportunities…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No opportunities yet. Click <b>Refresh opportunities</b> to pull and filter the
                    latest SEMrush gaps.
                  </td>
                </tr>
              )}
              {rows.map((o) => (
                <tr
                  key={o.id}
                  className={`border-b border-[#e2e8f0]/60 last:border-0 hover:bg-slate-50 ${
                    o.excluded ? "opacity-60" : ""
                  }`}
                >
                  <td className="py-2 pr-3">
                    <span className="text-slate-900">{o.keyword}</span>
                    {o.listName && (
                      <span className="ml-2 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                        {o.listName}
                      </span>
                    )}
                    {o.excluded && o.excludeReason && (
                      <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600">
                        {o.excludeReason}
                      </span>
                    )}
                    {o.existingUrl && (
                      <a
                        href={o.existingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 hover:underline"
                        title={o.existingUrl}
                      >
                        Covered ↗
                      </a>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className={`h-full ${relevanceTone(o.relevanceScore)}`}
                          style={{ width: `${o.relevanceScore}%` }}
                        />
                      </div>
                      <span className="tabular-nums text-xs text-slate-600">{o.relevanceScore}</span>
                    </div>
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-slate-700">
                    {o.searchVolume != null ? formatNumber(o.searchVolume) : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    {o.recommendedContentType && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          TYPE_TONE[o.recommendedContentType] ?? "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {TYPE_LABEL[o.recommendedContentType] ?? o.recommendedContentType}
                      </span>
                    )}
                    {o.practiceArea && (
                      <span className="ml-1.5 text-[10px] text-slate-400">
                        {PRACTICE_LABEL[o.practiceArea] ?? o.practiceArea}
                      </span>
                    )}
                    <span className="ml-1.5 text-[10px] text-slate-300">
                      · {SOURCE_LABEL[o.source] ?? o.source}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <StatusChip status={o.status} />
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {o.status === "dismissed" ? (
                      <button
                        onClick={() => setStatus(o.id, "new")}
                        className="text-xs px-2.5 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                      >
                        ↺ Restore
                      </button>
                    ) : (
                      <div className="inline-flex items-center gap-1.5">
                        {!o.excluded && (
                          <button
                            onClick={() => setWizardOpp(o)}
                            className="text-xs px-2.5 py-1 rounded bg-brand text-white font-medium hover:bg-brand/90"
                          >
                            Create Brief
                          </button>
                        )}
                        <button
                          onClick={() => setStatus(o.id, "dismissed")}
                          className="text-xs px-2.5 py-1 rounded border border-slate-300 text-slate-600 hover:border-red-300 hover:text-red-600"
                        >
                          ✕ Dismiss
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {(wizardOpp || scratchOpen) && (
        <KmBriefWizard
          opportunity={wizardOpp ?? undefined}
          onClose={() => {
            setWizardOpp(null);
            setScratchOpen(false);
          }}
          onGenerated={() => {
            fetchData();
          }}
        />
      )}

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={() => {
            setShowImport(false);
            fetchData();
          }}
        />
      )}
    </SeoShell>
  );
}

function ImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [listName, setListName] = useState("");
  const [practiceArea, setPracticeArea] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; excluded: number } | null>(null);

  const submit = async () => {
    if (!file || !listName.trim()) {
      setError("Choose a CSV file and name the list.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("listName", listName.trim());
      if (practiceArea) fd.append("practiceArea", practiceArea);
      const res = await fetch("/api/seo/opportunities/import", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Import failed");
      setResult({ imported: json.imported ?? 0, excluded: json.excluded ?? 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Import a SEMrush list</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Upload a keyword export (Keyword Gap, Organic Research, or Position Tracking). Each
              keyword is filtered, classified, and deduped against your live pages, then tagged with
              the list name.
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">×</button>
        </div>

        {result ? (
          <div className="mt-5 space-y-3 text-center">
            <div className="text-2xl">✓</div>
            <p className="text-sm text-slate-700">
              Imported <b>{result.imported}</b> keywords into &ldquo;{listName.trim()}&rdquo;
              {result.excluded > 0 && <> ({result.excluded} filtered as junk/branded)</>}.
            </p>
            <button
              onClick={onImported}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">List name</span>
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                placeholder="e.g. gap retaliation"
                value={listName}
                onChange={(e) => setListName(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Practice area (optional — inferred per keyword if blank)
              </span>
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                value={practiceArea}
                onChange={(e) => setPracticeArea(e.target.value)}
              >
                <option value="">Infer automatically</option>
                <option value="employment">Employment</option>
                <option value="collections">Collections</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">CSV file</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand/10 file:px-3 file:py-1.5 file:text-brand"
              />
            </label>
            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy}
                className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
              >
                {busy ? "Importing…" : "Import"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "slate";
}) {
  return (
    <article className="rounded-xl border border-[#e2e8f0] bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-2 text-2xl font-semibold tabular-nums ${
          tone === "emerald" ? "text-emerald-600" : "text-slate-900"
        }`}
      >
        {formatNumber(value)}
      </p>
    </article>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    new: { label: "New", cls: "bg-blue-50 text-blue-700" },
    brief: { label: "Brief", cls: "bg-violet-50 text-violet-700" },
    in_production: { label: "In production", cls: "bg-amber-50 text-amber-700" },
    published: { label: "Published", cls: "bg-emerald-50 text-emerald-700" },
    dismissed: { label: "Dismissed", cls: "bg-slate-100 text-slate-500" },
  };
  const s = map[status] ?? map.new;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>{s.label}</span>
  );
}
