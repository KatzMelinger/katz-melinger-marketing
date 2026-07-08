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
  organicCompetitors: { domain: string; commonKeywords: number; estimatedTraffic: number }[];
  suggestedCompetitors: SuggestedCompetitor[];
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

  const suggested = useMemo(() => (data?.suggestedCompetitors ?? []).slice(0, 10), [data]);

  return (
    <SeoShell
      title="Competitor Analysis"
      subtitle="Manage tracked competitor domains and discover top organic competitors from DataForSEO."
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
          <p className="text-xs uppercase tracking-wide text-slate-500">Suggested competitors</p>
          <p className="mt-2 text-2xl font-semibold">
            {formatNumber(data?.suggestedCompetitors.length ?? 0)}
          </p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Source</p>
          <p className="mt-2 text-sm text-slate-700">
            Tracking persists in Supabase. Add manually or one-click from suggested competitors.
          </p>
        </article>
      </section>

      <AuthorityComparison />

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
              className="flex-1 rounded-md border border-[#e2e8f0] px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <button
              onClick={() => newDomain.trim() && add(newDomain.trim())}
              disabled={!newDomain.trim() || busy === newDomain.trim()}
              className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
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
                  className="text-sm font-medium text-slate-900 hover:text-brand hover:underline"
                >
                  {domain}
                </Link>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/seo/competitors/${encodeURIComponent(domain)}`}
                    className="text-xs text-brand hover:underline"
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

        {/* Suggested competitors */}
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-5">
          <h2 className="text-lg font-semibold">Top 10 organic competitors</h2>
          <p className="mt-1 text-xs text-slate-500">
            From DataForSEO's organic-competitors report. One click to start tracking — already-tracked
            domains are marked.
          </p>

          <ul className="mt-4 space-y-2">
            {loading && !data && <li className="text-sm text-slate-500">Loading…</li>}
            {suggested.length === 0 && !loading && (
              <li className="text-sm text-slate-500">
                DataForSEO returned no organic-competitor data.
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
                    className="text-xs px-2 py-1 rounded border border-brand text-brand hover:bg-brand/5 disabled:opacity-50"
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

type AuthorityPayload = {
  ownDomain: string;
  domains: string[];
  dates: string[];
  authority: Record<string, Record<string, number | null>>;
  current: Record<string, number | null>;
  live: boolean;
  note?: string;
};

// Distinct colors for up to 6 domains (own domain always index 0 → brand-ish).
const SERIES_COLORS = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2"];

/**
 * Our authority vs. tracked competitors — a current side-by-side plus a trend
 * line once daily snapshots accrue. Authority is a RELATIVE trend (DataForSEO
 * domain rank ÷ 10), most useful watched over time and compared across domains.
 */
function AuthorityComparison() {
  const [data, setData] = useState<AuthorityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/seo/competitors/authority", { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) {
          setError(json?.error ?? "Failed to load authority comparison");
          return;
        }
        setData(json);
      } catch {
        setError("Failed to load authority comparison");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const ranked = useMemo(() => {
    if (!data) return [];
    return data.domains
      .map((domain) => ({ domain, score: data.current[domain] ?? null }))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }, [data]);

  const hasTrend = (data?.dates.length ?? 0) >= 2;
  const maxScore = Math.max(100, ...ranked.map((r) => r.score ?? 0));

  return (
    <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Authority comparison</h2>
          <p className="mt-1 text-xs text-slate-500">
            Your domain authority vs. tracked competitors. Read it as a{" "}
            <span
              className="underline decoration-dotted cursor-help"
              title="Authority is DataForSEO's domain rank scaled to 0–100. Providers each use their own proprietary scale, so it's most useful as a relative trend and a competitor comparison — not an absolute grade."
            >
              relative trend
            </span>
            , not an absolute number.
          </p>
        </div>
        {data?.live && (
          <span className="shrink-0 text-[10px] px-2 py-1 rounded-full border border-amber-300 bg-amber-50 text-amber-700">
            Live — trend builds from the next daily refresh
          </span>
        )}
      </div>

      {loading && <p className="mt-4 text-sm text-slate-500">Loading…</p>}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {data && !loading && ranked.length > 0 && (
        <>
          {/* Current side-by-side */}
          <div className="mt-4 space-y-2">
            {ranked.map(({ domain, score }, i) => {
              const isOwn = domain === data.ownDomain;
              const color = isOwn ? SERIES_COLORS[0] : SERIES_COLORS[(i % 5) + 1];
              return (
                <div key={domain} className="flex items-center gap-3">
                  <div
                    className={`w-44 shrink-0 truncate text-sm ${isOwn ? "font-semibold text-slate-900" : "text-slate-600"}`}
                    title={domain}
                  >
                    {domain}
                    {isOwn && <span className="ml-1 text-[10px] text-blue-600">(you)</span>}
                  </div>
                  <div className="flex-1 h-5 rounded bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded transition-all"
                      style={{
                        width: `${score != null ? (score / maxScore) * 100 : 0}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>
                  <div className="w-10 shrink-0 text-right text-sm tabular-nums font-medium">
                    {score ?? "—"}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Trend over time */}
          {hasTrend ? (
            <AuthorityTrendChart data={data} />
          ) : (
            <p className="mt-4 text-xs text-slate-500">
              Trend chart appears once at least two daily snapshots exist
              {data.note ? ` — ${data.note}` : "."}
            </p>
          )}
        </>
      )}

      {data && !loading && ranked.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">
          No authority data yet. Track a competitor or two and check back after the next refresh.
        </p>
      )}
    </section>
  );
}

/** Minimal multi-series SVG line chart of authority over time. */
function AuthorityTrendChart({ data }: { data: AuthorityPayload }) {
  const W = 640;
  const H = 180;
  const PAD = 28;
  const dates = data.dates;
  const xFor = (i: number) =>
    PAD + (dates.length === 1 ? 0 : (i / (dates.length - 1)) * (W - PAD * 2));
  const yFor = (score: number) => H - PAD - (score / 100) * (H - PAD * 2);

  return (
    <div className="mt-5">
      <p className="mb-2 text-xs font-medium text-slate-600">Authority trend</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Authority trend over time">
        {/* axis baseline */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#e2e8f0" strokeWidth={1} />
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line x1={PAD} y1={yFor(g)} x2={W - PAD} y2={yFor(g)} stroke="#f1f5f9" strokeWidth={1} />
            <text x={4} y={yFor(g) + 3} fontSize={9} fill="#94a3b8">
              {g}
            </text>
          </g>
        ))}
        {data.domains.map((domain, di) => {
          const isOwn = domain === data.ownDomain;
          const color = isOwn ? SERIES_COLORS[0] : SERIES_COLORS[(di % 5) + 1];
          const pts = dates
            .map((d, i) => {
              const v = data.authority[domain]?.[d];
              return v == null ? null : `${xFor(i)},${yFor(v)}`;
            })
            .filter((p): p is string => p !== null);
          if (pts.length === 0) return null;
          return (
            <polyline
              key={domain}
              points={pts.join(" ")}
              fill="none"
              stroke={color}
              strokeWidth={isOwn ? 2.5 : 1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      {/* legend */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {data.domains.map((domain, di) => {
          const isOwn = domain === data.ownDomain;
          const color = isOwn ? SERIES_COLORS[0] : SERIES_COLORS[(di % 5) + 1];
          return (
            <span key={domain} className="flex items-center gap-1.5 text-[11px] text-slate-600">
              <span className="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: color }} />
              {domain}
              {isOwn && <span className="text-blue-600">(you)</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
