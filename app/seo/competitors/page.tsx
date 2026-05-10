"use client";

/**
 * Competitor management page.
 *
 * Two columns:
 *   - Tracked competitors (left): inline add form + click-through to detail
 *     + remove button per row
 *   - Top 10 organic competitors from Semrush (right): one-click "Track"
 *     for each, with already-tracked status shown
 *
 * Tracked domains persist in Supabase (seo_tracked_competitors) so adds
 * survive Vercel cold boots — previously they didn't.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { SeoShell, formatNumber } from "@/components/seo-shell";

type SuggestedCompetitor = {
  domain: string;
  commonKeywords: number;
  estimatedTraffic: number;
  tracked: boolean;
};

type Payload = {
  trackedDomains: string[];
  semrushCompetitors: { domain: string; commonKeywords: number; estimatedTraffic: number }[];
  suggestedFromSemrush: SuggestedCompetitor[];
};

export default function SeoCompetitorsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newDomain, setNewDomain] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/seo/competitors", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Failed");
        return;
      }
      setData(json);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const add = async (domain: string, source: "manual" | "suggested" = "manual") => {
    setBusy(domain);
    try {
      await fetch("/api/seo/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, source }),
      });
      setNewDomain("");
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const remove = async (domain: string) => {
    if (!confirm(`Remove ${domain} from tracked competitors?`)) return;
    setBusy(domain);
    try {
      await fetch(`/api/seo/competitors?domain=${encodeURIComponent(domain)}`, {
        method: "DELETE",
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const suggested = useMemo(() => (data?.suggestedFromSemrush ?? []).slice(0, 10), [data]);

  return (
    <SeoShell
      title="Competitor Analysis"
      subtitle="Manage tracked competitor domains and discover top organic competitors from Semrush."
    >
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Tracked</p>
          <p className="mt-2 text-2xl font-semibold">
            {formatNumber(data?.trackedDomains.length ?? 0)}
          </p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Suggested by Semrush</p>
          <p className="mt-2 text-2xl font-semibold">
            {formatNumber(data?.suggestedFromSemrush.length ?? 0)}
          </p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Source</p>
          <p className="mt-2 text-sm text-slate-700">
            Tracking persists in Supabase. Add manually or one-click from Semrush suggestions.
          </p>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {/* Tracked competitors */}
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-5">
          <h2 className="text-lg font-semibold">Tracked competitors</h2>
          <p className="mt-1 text-xs text-slate-500">
            These domains feed competitor analysis, keyword battles, and SEO opportunity reports.
          </p>

          <div className="mt-4 flex gap-2">
            <input
              type="text"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newDomain.trim()) add(newDomain.trim());
              }}
              placeholder="competitor-firm.com"
              className="flex-1 rounded-md border border-[#e2e8f0] px-3 py-2 text-sm focus:border-[#185FA5] focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30"
            />
            <button
              onClick={() => newDomain.trim() && add(newDomain.trim())}
              disabled={!newDomain.trim() || busy === newDomain.trim()}
              className="rounded-md bg-[#185FA5] px-3 py-2 text-sm font-medium text-white hover:bg-[#1f6fb8] disabled:opacity-50"
            >
              Add
            </button>
          </div>

          <ul className="mt-4 space-y-2">
            {loading && !data && <li className="text-sm text-slate-500">Loading…</li>}
            {data?.trackedDomains.length === 0 && (
              <li className="text-sm text-slate-500">No tracked competitors yet.</li>
            )}
            {data?.trackedDomains.map((domain) => (
              <li
                key={domain}
                className="flex items-center justify-between rounded-md border border-[#e2e8f0] bg-white px-3 py-2"
              >
                <Link
                  href={`/seo/competitors/${encodeURIComponent(domain)}`}
                  className="text-sm font-medium text-slate-900 hover:text-[#185FA5] hover:underline"
                >
                  {domain}
                </Link>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/seo/competitors/${encodeURIComponent(domain)}`}
                    className="text-xs text-[#185FA5] hover:underline"
                  >
                    Detail →
                  </Link>
                  <button
                    onClick={() => remove(domain)}
                    disabled={busy === domain}
                    className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {busy === domain ? "…" : "Remove"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </article>

        {/* Suggested by Semrush */}
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-5">
          <h2 className="text-lg font-semibold">Top 10 organic competitors</h2>
          <p className="mt-1 text-xs text-slate-500">
            From Semrush's organic-competitors report. One click to start tracking — already-tracked
            domains are marked.
          </p>

          <ul className="mt-4 space-y-2">
            {loading && !data && <li className="text-sm text-slate-500">Loading…</li>}
            {suggested.length === 0 && !loading && (
              <li className="text-sm text-slate-500">
                Semrush returned no organic-competitor data.
              </li>
            )}
            {suggested.map((c) => (
              <li
                key={c.domain}
                className="flex items-center justify-between rounded-md border border-[#e2e8f0] bg-white px-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium">{c.domain}</div>
                  <div className="text-xs text-slate-500">
                    {formatNumber(c.commonKeywords)} common keywords ·{" "}
                    {formatNumber(c.estimatedTraffic)} est. traffic
                  </div>
                </div>
                {c.tracked ? (
                  <span className="text-xs px-2 py-1 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700">
                    ✓ tracked
                  </span>
                ) : (
                  <button
                    onClick={() => add(c.domain, "suggested")}
                    disabled={busy === c.domain}
                    className="text-xs px-2 py-1 rounded border border-[#185FA5] text-[#185FA5] hover:bg-[#185FA5]/5 disabled:opacity-50"
                  >
                    {busy === c.domain ? "…" : "+ Track"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </article>
      </section>
    </SeoShell>
  );
}
