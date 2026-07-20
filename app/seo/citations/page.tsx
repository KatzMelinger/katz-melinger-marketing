"use client";

/**
 * Citations (NAP) page.
 *
 * Tracks the firm's Name / Address / Phone across directory + local listings
 * and flags drift from the canonical NAP (pulled from firm config). Hybrid:
 *   - Canonical NAP shown up top (edit on /brand-voice).
 *   - AI audit: paste listing text from any site; Claude extracts each source's
 *     NAP and flags inconsistencies. Save a finding to start tracking it.
 *   - Manual: record a source's NAP and set its status by hand.
 *
 * Persists in seo_citations via /api/seo/citations.
 */

import { useEffect, useMemo, useState } from "react";

import { SeoShell, formatNumber } from "@/components/seo-shell";
import { DirectoryCoverage } from "@/components/directory-coverage";

type Canonical = { name: string; address: string; phone: string; website: string };

type Snapshot = {
  captured_on: string;
  total: number;
  consistent: number;
  inconsistent: number;
  missing: number;
  unverified: number;
  consistency_pct: number;
};

type Citation = {
  id: string;
  source: string;
  listing_url: string | null;
  nap_name: string | null;
  nap_address: string | null;
  nap_phone: string | null;
  status: string;
  issues: string | null;
  source_type: string;
  last_checked_at: string | null;
  updated_at: string;
};

type Finding = {
  source: string;
  nameFound: string | null;
  addressFound: string | null;
  phoneFound: string | null;
  status: string;
  issues: string | null;
};

const STATUSES = [
  { value: "consistent", label: "Consistent" },
  { value: "inconsistent", label: "Inconsistent" },
  { value: "missing", label: "Missing" },
  { value: "unverified", label: "Unverified" },
];

const STATUS_CLASSES: Record<string, string> = {
  consistent: "border-emerald-300 bg-emerald-50 text-emerald-700",
  inconsistent: "border-red-300 bg-red-50 text-red-700",
  missing: "border-amber-300 bg-amber-50 text-amber-700",
  unverified: "border-slate-300 bg-slate-50 text-slate-600",
};

function statusLabel(value: string): string {
  return STATUSES.find((s) => s.value === value)?.label ?? value;
}

export default function CitationsPage() {
  const [canonical, setCanonical] = useState<Canonical | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [loading, setLoading] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newSource, setNewSource] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [importText, setImportText] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [fixId, setFixId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [auditingLinks, setAuditingLinks] = useState(false);
  const [linkResults, setLinkResults] = useState<
    { source: string; listing_url: string; status: string; issues: string | null; fetched: boolean }[]
  >([]);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/seo/citations", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Failed");
        return;
      }
      setCanonical(json.canonical ?? null);
      setCitations(json.citations ?? []);
      setSnapshots(Array.isArray(json.snapshots) ? json.snapshots : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const trackedSources = useMemo(
    () => new Set(citations.map((c) => c.source.toLowerCase())),
    [citations],
  );

  const counts = useMemo(() => {
    const consistent = citations.filter((c) => c.status === "consistent").length;
    const inconsistent = citations.filter((c) => c.status === "inconsistent").length;
    const open = citations.filter(
      (c) => c.status === "missing" || c.status === "unverified",
    ).length;
    return { consistent, inconsistent, open };
  }, [citations]);

  const runAudit = async () => {
    if (!pasteText.trim()) return;
    setAuditing(true);
    setError(null);
    try {
      const res = await fetch("/api/seo/citations/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pasteText }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Audit failed");
        return;
      }
      if (json.canonical) setCanonical(json.canonical);
      setFindings(json.findings ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audit failed");
    } finally {
      setAuditing(false);
    }
  };

  const runLinkAudit = async () => {
    setAuditingLinks(true);
    setError(null);
    setLinkResults([]);
    try {
      const res = await fetch("/api/seo/citations/audit-links", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Audit failed");
        return;
      }
      setLinkResults(json.results ?? []);
      await refresh(); // pick up the updated statuses
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audit failed");
    } finally {
      setAuditingLinks(false);
    }
  };

  const linkedCount = useMemo(
    () => citations.filter((c) => (c.listing_url ?? "").trim()).length,
    [citations],
  );

  const saveFinding = async (f: Finding) => {
    setBusy(f.source);
    try {
      const res = await fetch("/api/seo/citations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: f.source,
          nap_name: f.nameFound,
          nap_address: f.addressFound,
          nap_phone: f.phoneFound,
          status: f.status,
          issues: f.issues,
          source_type: "audit",
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json?.error ?? "Failed to save");
        return;
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const addManual = async () => {
    const source = newSource.trim();
    if (!source) return;
    setBusy(source);
    try {
      await fetch("/api/seo/citations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Include the listing URL so the row is audit-ready (the "Audit N linked
        // listings" count is driven by rows that have a listing_url).
        body: JSON.stringify({ source, listing_url: newUrl.trim() || undefined }),
      });
      setNewSource("");
      setNewUrl("");
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const importListings = async () => {
    const text = importText.trim();
    if (!text) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await fetch("/api/seo/citations/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = await res.json();
      if (!res.ok) {
        setImportMsg(j?.error ?? "Import failed.");
        return;
      }
      setImportMsg(j.message ?? "Imported.");
      setImportText("");
      await refresh();
    } catch {
      setImportMsg("Import failed.");
    } finally {
      setImporting(false);
    }
  };

  const patchStatus = async (id: string, status: string) => {
    setBusy(id);
    try {
      await fetch("/api/seo/citations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const remove = async (c: Citation) => {
    if (!confirm(`Remove ${c.source} from tracked citations?`)) return;
    setBusy(c.id);
    try {
      await fetch(`/api/seo/citations?id=${encodeURIComponent(c.id)}`, { method: "DELETE" });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const pendingFindings = findings.filter((f) => !trackedSources.has(f.source.toLowerCase()));

  return (
    <SeoShell
      title="Directories & Citations"
      subtitle="One page for both questions: are we listed everywhere we should be, and is every listing accurate? Keep the firm's Name, Address & Phone identical across every directory — inconsistent NAP hurts local ranking."
    >
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Canonical NAP */}
      <section className="rounded-xl border border-brand/30 bg-brand/5 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-brand">
            Canonical NAP — the source of truth
          </h2>
          <a href="/brand-voice" className="text-xs text-brand hover:underline">
            Edit on Brand Voice →
          </a>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Name</p>
            <p className="text-sm font-medium text-slate-900">{canonical?.name ?? "…"}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Address</p>
            <p className="text-sm font-medium text-slate-900">{canonical?.address ?? "…"}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Phone</p>
            <p className="text-sm font-medium text-slate-900">{canonical?.phone ?? "…"}</p>
          </div>
        </div>
      </section>

      <CitationSummary citations={citations} snapshots={snapshots} counts={counts} />

      {/* Audit from saved links */}
      <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Audit from saved links</h2>
            <p className="mt-1 text-xs text-slate-500">
              Re-checks every citation that has a listing URL by fetching the page
              and comparing its NAP to canonical — no pasting. Some directories
              (Yelp, Avvo, BBB) block bots; those come back “couldn’t read — paste
              that one instead”.
            </p>
          </div>
          <button
            onClick={runLinkAudit}
            disabled={auditingLinks || linkedCount === 0}
            className="shrink-0 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
            title={linkedCount === 0 ? "No citations have a listing URL yet" : undefined}
          >
            {auditingLinks
              ? "Auditing… (1-3 min)"
              : `Audit ${linkedCount} linked listing${linkedCount === 1 ? "" : "s"}`}
          </button>
        </div>
        {linkResults.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {linkResults.map((r, i) => (
              <li
                key={i}
                className="flex items-start justify-between gap-3 rounded-md border border-[#e2e8f0] px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <span className="font-medium text-slate-900">{r.source}</span>
                  {r.issues && <p className="mt-0.5 text-xs text-slate-500">{r.issues}</p>}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    r.status === "consistent"
                      ? "bg-emerald-50 text-emerald-700"
                      : r.status === "inconsistent"
                        ? "bg-red-50 text-red-700"
                        : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {r.fetched ? statusLabel(r.status) : "couldn’t read"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* AI audit */}
      <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <h2 className="text-lg font-semibold">Audit pasted listings</h2>
        <p className="mt-1 text-xs text-slate-500">
          Copy the Name / Address / Phone block from any directory (Google, Yelp, Bing, a legal
          directory…) and paste it below. Claude extracts each source&apos;s NAP and flags drift from
          your canonical NAP. Paste multiple sources at once — label each if you can.
        </p>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          rows={6}
          placeholder={"Yelp:\nYour Firm LLP\n123 Main Street, Suite 100, City, ST 00000\n(555) 123-4567\n\nBing Places:\n…"}
          className="mt-3 w-full rounded-md border border-[#e2e8f0] px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
        <div className="mt-2 flex justify-end">
          <button
            onClick={runAudit}
            disabled={auditing || !pasteText.trim()}
            className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
          >
            {auditing ? "Auditing…" : "Run audit"}
          </button>
        </div>

        {findings.length > 0 && (
          <ul className="mt-4 space-y-2">
            {findings.map((f) => {
              const tracked = trackedSources.has(f.source.toLowerCase());
              return (
                <li key={f.source} className="rounded-md border border-[#e2e8f0] bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{f.source}</span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                            STATUS_CLASSES[f.status] ?? STATUS_CLASSES.unverified
                          }`}
                        >
                          {statusLabel(f.status)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">
                        {f.nameFound ?? "—"} · {f.addressFound ?? "—"} · {f.phoneFound ?? "—"}
                      </p>
                      {f.issues && <p className="mt-1 text-xs text-red-700">⚠ {f.issues}</p>}
                    </div>
                    {tracked ? (
                      <span className="shrink-0 text-xs text-slate-400">tracked</span>
                    ) : (
                      <button
                        onClick={() => saveFinding(f)}
                        disabled={busy === f.source}
                        className="shrink-0 rounded border border-brand px-2 py-1 text-xs text-brand hover:bg-brand/5 disabled:opacity-50"
                      >
                        {busy === f.source ? "…" : "Save"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
            {pendingFindings.length === 0 && (
              <li className="text-xs text-slate-500">All audited sources are already tracked.</li>
            )}
          </ul>
        )}
      </section>

      {/* Tracked citations */}
      <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <h2 className="text-lg font-semibold">Tracked citations</h2>

        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="text"
            value={newSource}
            onChange={(e) => setNewSource(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addManual();
            }}
            placeholder="Source (e.g. Yelp, Bing Places)"
            className="min-w-[140px] flex-1 rounded-md border border-[#e2e8f0] px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
          <input
            type="url"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addManual();
            }}
            placeholder="Listing URL (so it can be audited)"
            className="min-w-[180px] flex-[2] rounded-md border border-[#e2e8f0] px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
          <button
            onClick={addManual}
            disabled={!newSource.trim() || busy === newSource.trim()}
            className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
          >
            Add
          </button>
        </div>

        {/* Bulk import from the "Local citations Works Completed" sheet. */}
        <div className="mt-2">
          <button
            onClick={() => setImportOpen((v) => !v)}
            className="text-xs font-medium text-brand hover:underline"
          >
            {importOpen ? "− Hide bulk import" : "+ Import from sheet (bulk)"}
          </button>
          {importOpen && (
            <div className="mt-2 rounded-md border border-[#e2e8f0] bg-slate-50 p-3">
              <p className="text-xs text-slate-600">
                Paste one listing URL per line, or <strong>Domain, Citation Link</strong> rows
                (CSV/TSV). Each becomes a tracked listing that the link audit checks. Existing
                sources keep their audited data.
              </p>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={6}
                placeholder={"https://www.avvo.com/attorneys/...\nFindLaw, https://lawyers.findlaw.com/...\nhttps://www.justia.com/lawyers/..."}
                className="mt-2 w-full rounded-md border border-[#e2e8f0] px-3 py-2 font-mono text-xs focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
              <div className="mt-2 flex items-center gap-3">
                <button
                  onClick={importListings}
                  disabled={importing || !importText.trim()}
                  className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
                >
                  {importing ? "Importing…" : "Import listings"}
                </button>
                {importMsg && <span className="text-xs text-slate-600">{importMsg}</span>}
              </div>
            </div>
          )}
        </div>

        <ul className="mt-4 space-y-2">
          {loading && citations.length === 0 && (
            <li className="text-sm text-slate-500">Loading…</li>
          )}
          {!loading && citations.length === 0 && (
            <li className="text-sm text-slate-500">
              No citations tracked yet. Run an audit above or add a source manually.
            </li>
          )}
          {citations.map((c) => {
            const needsFix = c.status === "inconsistent" || c.status === "missing";
            return (
              <li
                key={c.id}
                className="rounded-md border border-[#e2e8f0] bg-white px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-[160px] flex-1">
                    <div className="text-sm font-medium text-slate-900">{c.source}</div>
                    {(c.nap_name || c.nap_address || c.nap_phone) && (
                      <p className="text-xs text-slate-500">
                        {c.nap_name ?? "—"} · {c.nap_address ?? "—"} · {c.nap_phone ?? "—"}
                      </p>
                    )}
                    {c.issues && <p className="text-xs text-red-700">⚠ {c.issues}</p>}
                  </div>

                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                      STATUS_CLASSES[c.status] ?? STATUS_CLASSES.unverified
                    }`}
                  >
                    {statusLabel(c.status)}
                  </span>

                  {needsFix && (
                    <button
                      onClick={() => setFixId((cur) => (cur === c.id ? null : c.id))}
                      className="rounded-md border border-brand/40 bg-brand/5 px-2 py-1 text-xs font-medium text-brand hover:bg-brand/10"
                    >
                      {fixId === c.id ? "Hide fix" : "Fix →"}
                    </button>
                  )}

                  <select
                    value={c.status}
                    onChange={(e) => patchStatus(c.id, e.target.value)}
                    disabled={busy === c.id}
                    className="rounded-md border border-[#e2e8f0] px-2 py-1 text-xs focus:border-brand focus:outline-none"
                  >
                    {STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => remove(c)}
                    disabled={busy === c.id}
                    className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {busy === c.id ? "…" : "Remove"}
                  </button>
                </div>

                {needsFix && fixId === c.id && (
                  <FixPanel citation={c} canonical={canonical} />
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <DirectoryCoverage />
    </SeoShell>
  );
}

/**
 * Weekly summary — the "digest" shown in-app instead of emailed. The Monday
 * cron re-audits + snapshots; this panel reads the current state so the results
 * are always front-and-center: consistency % now, week-over-week movement, what
 * needs attention, when it was last audited, and the trend sparkline (once
 * snapshots exist). Always renders when there are tracked citations.
 */
function CitationSummary({
  citations,
  snapshots,
  counts,
}: {
  citations: Citation[];
  snapshots: Snapshot[];
  counts: { consistent: number; inconsistent: number; open: number };
}) {
  const verifiable = counts.consistent + counts.inconsistent;
  const consistencyPct = verifiable ? Math.round((counts.consistent / verifiable) * 100) : 0;

  // Change vs the previous audit's snapshot. Snapshots are written per audit
  // (not strictly weekly), so we label it with that snapshot's date rather than
  // claiming "last week".
  const prev = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
  const delta = prev ? consistencyPct - prev.consistency_pct : null;

  // Most recent audit timestamp across all listings.
  const lastAudited = citations.reduce<string | null>((max, c) => {
    if (!c.last_checked_at) return max;
    return !max || c.last_checked_at > max ? c.last_checked_at : max;
  }, null);

  // Sparkline geometry (only when there's history).
  const W = 320;
  const H = 40;
  const pts = snapshots.map((s, i) => {
    const x = snapshots.length === 1 ? W : (i / (snapshots.length - 1)) * W;
    const y = H - (Math.max(0, Math.min(100, s.consistency_pct)) / 100) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-brand">This week</h2>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-semibold text-slate-900">{consistencyPct}%</span>
            <span className="text-sm text-slate-500">NAP consistent</span>
            {delta !== null && (
              <span
                className={`text-xs font-medium ${
                  delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-600" : "text-slate-400"
                }`}
              >
                {delta > 0 ? "▲" : delta < 0 ? "▼" : "±"} {Math.abs(delta)} pts vs {prev?.captured_on}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {counts.consistent} of {verifiable || 0} checkable listing(s) match ·{" "}
            {lastAudited
              ? `last audited ${new Date(lastAudited).toLocaleDateString()}`
              : "not audited yet"}{" "}
            · auto-refreshes every Monday
          </p>
        </div>
        {snapshots.length > 0 && (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full max-w-[320px]"
            preserveAspectRatio="none"
            height={H}
          >
            <line x1="0" y1={H} x2={W} y2={H} stroke="#e2e8f0" strokeWidth="1" />
            {snapshots.length > 1 ? (
              <polyline
                points={pts.join(" ")}
                fill="none"
                stroke="#116AB2"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : (
              <circle cx={W} cy={pts[0]?.split(",")[1] ?? H} r="3" fill="#116AB2" />
            )}
          </svg>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-[#e2e8f0] bg-slate-50 p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Consistent</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-700">{formatNumber(counts.consistent)}</p>
        </div>
        <div className="rounded-lg border border-[#e2e8f0] bg-slate-50 p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Inconsistent</p>
          <p className="mt-1 text-2xl font-semibold text-red-700">{formatNumber(counts.inconsistent)}</p>
        </div>
        <div className="rounded-lg border border-[#e2e8f0] bg-slate-50 p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Missing / unverified</p>
          <p className="mt-1 text-2xl font-semibold text-amber-700">{formatNumber(counts.open)}</p>
        </div>
      </div>
    </section>
  );
}

/** Copy-to-clipboard field: the correct value the listing should show. */
function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <code className="flex-1 rounded bg-white px-2 py-1 text-xs text-slate-800">{value}</code>
      <button
        onClick={() => {
          // Only flip to "Copied" if the write actually succeeded (the Clipboard
          // API rejects in insecure contexts); swallow the rejection either way.
          navigator.clipboard
            ?.writeText(value)
            .then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            })
            .catch(() => {});
        }}
        className="rounded border border-[#e2e8f0] px-2 py-1 text-[11px] text-slate-600 hover:border-brand hover:text-brand"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/**
 * Guided update: the exact corrected field values (from the canonical profile)
 * plus a direct link to edit/claim the listing. We never write to the directory
 * ourselves (most have no write API, and the guardrail forbids it) — you make
 * the change, then the next audit confirms it's fixed.
 */
function FixPanel({ citation, canonical }: { citation: Citation; canonical: Canonical | null }) {
  const claimUrl =
    citation.listing_url ||
    `https://www.google.com/search?q=${encodeURIComponent(`claim ${citation.source} listing ${canonical?.name ?? ""}`)}`;
  return (
    <div className="mt-2 rounded-md border border-brand/30 bg-brand/5 p-3">
      <p className="text-xs font-semibold text-slate-700">
        Correct values — paste these into {citation.source}:
      </p>
      <div className="mt-2 space-y-1.5">
        <CopyField label="Name" value={canonical?.name ?? ""} />
        <CopyField label="Address" value={canonical?.address ?? ""} />
        <CopyField label="Phone" value={canonical?.phone ?? ""} />
        <CopyField label="Website" value={canonical?.website ?? ""} />
      </div>
      {citation.issues && (
        <p className="mt-2 text-xs text-red-700">What&apos;s off now: {citation.issues}</p>
      )}
      <div className="mt-2 flex items-center gap-3">
        <a
          href={claimUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
        >
          {citation.listing_url ? "Open listing to edit →" : "Find claim page →"}
        </a>
        <span className="text-[11px] text-slate-500">
          We never change a live listing for you — edit it there, then re-audit.
        </span>
      </div>
    </div>
  );
}
