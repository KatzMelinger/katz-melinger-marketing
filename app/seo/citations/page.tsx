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

type Canonical = { name: string; address: string; phone: string };

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
        body: JSON.stringify({ source }),
      });
      setNewSource("");
      await refresh();
    } finally {
      setBusy(null);
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
      title="Citations"
      subtitle="Keep the firm's Name, Address & Phone identical across every directory and listing — inconsistent NAP hurts local ranking."
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

      <section className="grid gap-4 sm:grid-cols-3">
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Consistent</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-700">{formatNumber(counts.consistent)}</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Inconsistent</p>
          <p className="mt-2 text-2xl font-semibold text-red-700">{formatNumber(counts.inconsistent)}</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Missing / unverified</p>
          <p className="mt-2 text-2xl font-semibold text-amber-700">{formatNumber(counts.open)}</p>
        </article>
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

        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={newSource}
            onChange={(e) => setNewSource(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addManual();
            }}
            placeholder="Source (e.g. Yelp, Bing Places)"
            className="flex-1 rounded-md border border-[#e2e8f0] px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
          <button
            onClick={addManual}
            disabled={!newSource.trim() || busy === newSource.trim()}
            className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
          >
            Add
          </button>
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
          {citations.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-[#e2e8f0] bg-white px-3 py-2"
            >
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
            </li>
          ))}
        </ul>
      </section>
    </SeoShell>
  );
}
