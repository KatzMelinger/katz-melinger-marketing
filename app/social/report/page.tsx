"use client";

/**
 * Monthly social report — client-ready recap of Facebook / Instagram / LinkedIn
 * for a calendar month vs the prior month. Reproduces the June-2026 report
 * layout: executive KPIs, a platform comparison table, column charts, and a
 * per-platform detail panel. Data comes from /api/social/report (frozen monthly
 * snapshots, with a live Metricool fallback for un-snapshotted months).
 *
 * "Download PDF" uses the browser print dialog with a print stylesheet so the
 * page prints as a clean one-pager — no extra dependency. Elements marked
 * `.no-print` (nav, controls) are hidden in the printout.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { MarketingNav } from "@/components/marketing-nav";
import { EMPTY_AUDIENCE, type DemoRow, type ReportAudience } from "@/lib/social-audience";

// ---- design tokens (from the report spec) ---------------------------------
const NAVY = "#0F2647";
const GREEN = "#15803D";
const RED = "#B91C1C";
const BORDER = "#e2e8f0";
const PLATFORM_ACCENT: Record<string, string> = {
  facebook: "#1877F2",
  instagram: "#C13584",
  linkedin: "#0A66C2",
  tiktok: "#111111",
};

type ReportMetric = { value: number | null; deltaPct: number | null };
type ReportPlatform = {
  network: string;
  key: string;
  impressions: ReportMetric;
  reach: ReportMetric;
  engagement: ReportMetric;
  clicks: ReportMetric;
  netNewFollowers: ReportMetric;
  totalFollowers: number | null;
  posts: number;
};
type MonthlyReport = {
  connected: boolean;
  error?: string;
  month: string;
  monthLabel: string;
  priorMonth: string;
  priorMonthLabel: string;
  source: "snapshot" | "live" | "mixed" | "none";
  platforms: ReportPlatform[];
  kpis: {
    combinedImpressions: number;
    netNewFollowers: number;
    standout: { label: string; deltaPct: number } | null;
  };
};

const METRIC_ROWS: { key: keyof ReportPlatform; label: string }[] = [
  { key: "impressions", label: "Views / impressions" },
  { key: "reach", label: "Reach / unique viewers" },
  { key: "engagement", label: "Engagement (interactions)" },
  { key: "clicks", label: "Clicks & visits" },
  { key: "netNewFollowers", label: "Net new followers" },
];

function fmt(v: number | null): string {
  return v == null ? "n/a" : v.toLocaleString();
}

function monthOptions(count: number): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ value, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` });
  }
  return out;
}

function Delta({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-slate-400">—</span>;
  const up = pct >= 0;
  return (
    <span style={{ color: up ? GREEN : RED }} className="font-semibold tabular-nums">
      {up ? "▲" : "▼"} {up ? "+" : ""}
      {pct}%
    </span>
  );
}

export default function MonthlyReportPage() {
  const options = useMemo(() => monthOptions(6), []);
  const [month, setMonth] = useState(options[0]?.value ?? "");
  const [platform, setPlatform] = useState<string>("all");
  const [data, setData] = useState<MonthlyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audience, setAudience] = useState<ReportAudience>(EMPTY_AUDIENCE);
  const [editingAudience, setEditingAudience] = useState(false);
  const [savingAudience, setSavingAudience] = useState(false);
  const [audienceMsg, setAudienceMsg] = useState<string | null>(null);

  // Curated Instagram/LinkedIn demographics (Sections 5-6) — loaded once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/social/report/audience", { cache: "no-store" });
        const json = (await res.json()) as { audience?: ReportAudience };
        if (!cancelled && json.audience) setAudience(json.audience);
      } catch {
        /* leave EMPTY_AUDIENCE */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveAudience() {
    setSavingAudience(true);
    setAudienceMsg(null);
    try {
      const res = await fetch("/api/social/report/audience", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ audience }),
      });
      const j = await res.json();
      setAudienceMsg(res.ok ? "Saved." : (j.error ?? "Save failed."));
    } catch {
      setAudienceMsg("Save failed.");
    } finally {
      setSavingAudience(false);
      setTimeout(() => setAudienceMsg(null), 2500);
    }
  }

  useEffect(() => {
    if (!month) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/social/report?month=${month}`, { cache: "no-store" });
        const json = (await res.json()) as MonthlyReport;
        if (cancelled) return;
        setData(json);
        setError(json.error ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [month]);

  const platforms = useMemo(() => {
    const all = data?.platforms ?? [];
    return platform === "all" ? all : all.filter((p) => p.key === platform);
  }, [data, platform]);

  const impressionsChart = platforms.map((p) => ({
    name: p.network,
    key: p.key,
    value: p.impressions.value ?? 0,
  }));
  const followersChart = platforms.map((p) => ({
    name: p.network,
    key: p.key,
    value: p.netNewFollowers.value ?? 0,
  }));

  const totalNet = data?.kpis.netNewFollowers ?? 0;
  const topFollowerPlatform = useMemo(() => {
    const all = data?.platforms ?? [];
    return all.reduce<ReportPlatform | null>((best, p) => {
      const v = p.netNewFollowers.value ?? 0;
      if (!best || v > (best.netNewFollowers.value ?? 0)) return p;
      return best;
    }, null);
  }, [data]);

  const hasAudience = useMemo(() => {
    const { instagram: ig, linkedin: li } = audience;
    if (ig.totalFollowers != null || li.totalFollowers != null) return true;
    return [
      ig.ageGroups, ig.gender, ig.topCities, ig.topCountries,
      li.jobFunction, li.seniority, li.industry, li.companySize, li.location,
    ].some((l) => l.length > 0);
  }, [audience]);

  const showIg = platform === "all" || platform === "instagram";
  const showLi = platform === "all" || platform === "linkedin";

  return (
    <div className="min-h-full text-slate-900" style={{ backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" }}>
      {/* Print styles: hide chrome, keep colors, avoid awkward breaks */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .report-print { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .avoid-break { break-inside: avoid; }
          @page { margin: 12mm; }
        }
      `}</style>

      <div className="no-print">
        <MarketingNav />
      </div>

      <main className="report-print mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        {/* Header + controls */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: NAVY }}>
              Social Ops Hub / Monthly Report
            </p>
            <h1 className="mt-1 text-2xl font-semibold" style={{ color: NAVY }}>
              Organic Social Report — {data?.monthLabel ?? "…"}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Facebook · Instagram · LinkedIn — organic only. Deltas vs {data?.priorMonthLabel ?? "the prior month"}.
            </p>
          </div>

          <div className="no-print flex flex-wrap items-center gap-2">
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="all">All platforms</option>
              {(data?.platforms ?? []).map((p) => (
                <option key={p.key} value={p.key}>
                  {p.network}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-md px-4 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: NAVY }}
            >
              Download PDF
            </button>
          </div>
        </div>

        {loading ? <p className="text-sm text-slate-500">Loading report…</p> : null}

        {error ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
            {error}
          </div>
        ) : null}

        {data && !data.connected && !error ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
            Metricool isn&apos;t returning data. Check the credentials on{" "}
            <a href="/integrations" className="underline">/integrations</a>.
          </div>
        ) : null}

        {data && data.connected ? (
          <>
            {/* Section 1 — Executive KPIs */}
            <section className="grid gap-4 sm:grid-cols-3">
              <article className="avoid-break rounded-xl p-5 text-white" style={{ backgroundColor: NAVY }}>
                <p className="text-xs uppercase tracking-wide text-white/70">Combined views / impressions</p>
                <p className="mt-2 text-3xl font-semibold tabular-nums">
                  {data.kpis.combinedImpressions.toLocaleString()}
                </p>
                <p className="mt-1 text-xs text-white/70">Across all platforms</p>
              </article>
              <article className="avoid-break rounded-xl p-5 text-white" style={{ backgroundColor: NAVY }}>
                <p className="text-xs uppercase tracking-wide text-white/70">Net new followers</p>
                <p className="mt-2 text-3xl font-semibold tabular-nums">
                  {data.kpis.netNewFollowers.toLocaleString()}
                </p>
                <p className="mt-1 text-xs text-white/70">All platforms combined</p>
              </article>
              <article className="avoid-break rounded-xl p-5 text-white" style={{ backgroundColor: NAVY }}>
                <p className="text-xs uppercase tracking-wide text-white/70">Standout metric</p>
                <p className="mt-2 text-2xl font-semibold" style={{ color: "#7CF0BD" }}>
                  {data.kpis.standout
                    ? `${data.kpis.standout.label} ${data.kpis.standout.deltaPct >= 0 ? "+" : ""}${data.kpis.standout.deltaPct}%`
                    : "—"}
                </p>
                <p className="mt-1 text-xs text-white/70">Biggest month-over-month move</p>
              </article>
            </section>

            {/* Section 2 — Platform comparison table */}
            <section className="avoid-break overflow-x-auto rounded-xl border" style={{ borderColor: BORDER }}>
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr style={{ backgroundColor: NAVY }} className="text-left text-white">
                    <th className="px-4 py-3 font-medium">Metric</th>
                    {platforms.map((p) => (
                      <th key={p.key} className="px-4 py-3 font-medium">
                        {p.network}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {METRIC_ROWS.map((row, i) => (
                    <tr key={row.key} className={i % 2 ? "bg-slate-50" : "bg-white"}>
                      <td className="px-4 py-3 font-medium text-slate-700">{row.label}</td>
                      {platforms.map((p) => {
                        const m = p[row.key] as ReportMetric;
                        return (
                          <td key={p.key} className="px-4 py-3 tabular-nums text-slate-900">
                            {fmt(m.value)}{" "}
                            <span className="ml-1 text-xs">
                              <Delta pct={m.deltaPct} />
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <p className="text-xs text-slate-400">
              Meta retired Facebook Reach, so &quot;unique viewers&quot; is shown for FB. &quot;Clicks &amp; visits&quot;
              (profile visits / page views) isn&apos;t exposed by the Metricool API and shows as n/a.
            </p>

            {/* Section 3 — Charts */}
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="avoid-break rounded-xl border p-6" style={{ borderColor: BORDER }}>
                <h2 className="mb-4 text-lg font-semibold" style={{ color: NAVY }}>
                  Views / impressions by platform
                </h2>
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={impressionsChart}>
                      <CartesianGrid stroke={BORDER} strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fill: "#475569", fontSize: 12 }} />
                      <YAxis tick={{ fill: "#475569", fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        <LabelList dataKey="value" position="top" style={{ fontSize: 11, fill: "#475569" }} />
                        {impressionsChart.map((d) => (
                          <Cell key={d.key} fill={PLATFORM_ACCENT[d.key] ?? NAVY} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="avoid-break rounded-xl border p-6" style={{ borderColor: BORDER }}>
                <h2 className="mb-4 text-lg font-semibold" style={{ color: NAVY }}>
                  New followers by platform
                </h2>
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={followersChart}>
                      <CartesianGrid stroke={BORDER} strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fill: "#475569", fontSize: 12 }} />
                      <YAxis tick={{ fill: "#475569", fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        <LabelList dataKey="value" position="top" style={{ fontSize: 11, fill: "#475569" }} />
                        {followersChart.map((d) => (
                          <Cell key={d.key} fill={PLATFORM_ACCENT[d.key] ?? NAVY} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {topFollowerPlatform && totalNet > 0 && platform === "all" ? (
                  <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {topFollowerPlatform.network} drove {topFollowerPlatform.netNewFollowers.value} of {totalNet} net
                    new followers (~{Math.round(((topFollowerPlatform.netNewFollowers.value ?? 0) / totalNet) * 100)}% of
                    audience growth).
                  </p>
                ) : null}
              </section>
            </div>

            {/* Section 4 — Per-platform detail */}
            <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {platforms.map((p) => (
                <article key={p.key} className="avoid-break rounded-xl border" style={{ borderColor: BORDER }}>
                  <div
                    className="rounded-t-xl px-4 py-3 text-sm font-semibold text-white"
                    style={{ backgroundColor: PLATFORM_ACCENT[p.key] ?? NAVY }}
                  >
                    {p.network}
                  </div>
                  <dl className="divide-y" style={{ borderColor: BORDER }}>
                    {[
                      { label: "Views / impressions", m: p.impressions },
                      { label: "Reach / unique viewers", m: p.reach },
                      { label: "Engagement", m: p.engagement },
                      { label: "Clicks & visits", m: p.clicks },
                      { label: "Net new followers", m: p.netNewFollowers },
                    ].map((r) => (
                      <div key={r.label} className="flex items-center justify-between px-4 py-2 text-sm">
                        <dt className="text-slate-500">{r.label}</dt>
                        <dd className="tabular-nums text-slate-900">
                          {fmt(r.m.value)} <Delta pct={r.m.deltaPct} />
                        </dd>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-4 py-2 text-sm">
                      <dt className="text-slate-500">Total followers</dt>
                      <dd className="tabular-nums text-slate-900">{fmt(p.totalFollowers)}</dd>
                    </div>
                    <div className="flex items-center justify-between px-4 py-2 text-sm">
                      <dt className="text-slate-500">Posts</dt>
                      <dd className="tabular-nums text-slate-900">{p.posts}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </section>

            {/* Sections 5-6 — curated audience demographics */}
            {hasAudience || editingAudience ? (
              <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold" style={{ color: NAVY }}>
                    Audience
                  </h2>
                  <div className="no-print flex items-center gap-2">
                    {audienceMsg ? <span className="text-sm text-emerald-600">{audienceMsg}</span> : null}
                    {editingAudience ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void saveAudience()}
                          disabled={savingAudience}
                          className="rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                          style={{ backgroundColor: NAVY }}
                        >
                          {savingAudience ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingAudience(false)}
                          className="rounded-md border px-3 py-1.5 text-sm font-semibold text-slate-600"
                          style={{ borderColor: BORDER }}
                        >
                          Done
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingAudience(true)}
                        className="rounded-md border px-3 py-1.5 text-sm font-semibold"
                        style={{ borderColor: NAVY, color: NAVY }}
                      >
                        Edit audience
                      </button>
                    )}
                  </div>
                </div>

                {editingAudience ? (
                  <AudienceEditor audience={audience} onChange={setAudience} />
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {showIg ? (
                      <PlatformAudience
                        title="Instagram audience"
                        accent={PLATFORM_ACCENT.instagram}
                        totalFollowers={audience.instagram.totalFollowers}
                        blocks={[
                          { label: "Age", rows: audience.instagram.ageGroups },
                          { label: "Gender", rows: audience.instagram.gender },
                          { label: "Top cities", rows: audience.instagram.topCities },
                          { label: "Top countries", rows: audience.instagram.topCountries },
                        ]}
                      />
                    ) : null}
                    {showLi ? (
                      <PlatformAudience
                        title="LinkedIn audience"
                        accent={PLATFORM_ACCENT.linkedin}
                        totalFollowers={audience.linkedin.totalFollowers}
                        blocks={[
                          { label: "Job function", rows: audience.linkedin.jobFunction },
                          { label: "Seniority", rows: audience.linkedin.seniority },
                          { label: "Industry", rows: audience.linkedin.industry },
                          { label: "Company size", rows: audience.linkedin.companySize },
                          { label: "Location", rows: audience.linkedin.location },
                        ]}
                      />
                    ) : null}
                  </div>
                )}
              </section>
            ) : null}

            <p className="text-xs text-slate-400">
              Source: {data.source === "live"
                ? "live Metricool query"
                : data.source === "snapshot"
                  ? "saved monthly snapshot"
                  : data.source === "mixed"
                    ? "saved snapshot + live query"
                    : "—"}
. Audience demographics (Sections 5-6) aren&apos;t exposed by the Metricool API — enter them from
              each platform&apos;s native analytics via &quot;Edit audience&quot; above; they carry over month to month.
            </p>
          </>
        ) : null}
      </main>
    </div>
  );
}

// ---- audience display ------------------------------------------------------

function DemoBlock({ label, rows }: { label: string; rows: DemoRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.pct));
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</h4>
      <div className="mt-2 space-y-1.5">
        {rows.map((r, i) => (
          <div key={`${r.label}-${i}`}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-700">{r.label}</span>
              <span className="tabular-nums text-slate-500">{r.pct}%</span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-slate-100">
              <div className="h-full rounded" style={{ width: `${(r.pct / max) * 100}%`, backgroundColor: NAVY }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlatformAudience({
  title,
  accent,
  totalFollowers,
  blocks,
}: {
  title: string;
  accent: string;
  totalFollowers: number | null;
  blocks: { label: string; rows: DemoRow[] }[];
}) {
  const populated = blocks.filter((b) => b.rows.length > 0);
  if (totalFollowers == null && populated.length === 0) return null;
  return (
    <article className="avoid-break rounded-xl border" style={{ borderColor: BORDER }}>
      <div
        className="flex items-center justify-between rounded-t-xl px-4 py-3 text-sm font-semibold text-white"
        style={{ backgroundColor: accent }}
      >
        <span>{title}</span>
        {totalFollowers != null ? (
          <span className="text-white/80">{totalFollowers.toLocaleString()} followers</span>
        ) : null}
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        {populated.map((b) => (
          <DemoBlock key={b.label} label={b.label} rows={b.rows} />
        ))}
      </div>
    </article>
  );
}

// ---- audience editor -------------------------------------------------------

function AudienceEditor({
  audience,
  onChange,
}: {
  audience: ReportAudience;
  onChange: (a: ReportAudience) => void;
}) {
  const ig = audience.instagram;
  const li = audience.linkedin;
  const setIg = (key: keyof typeof ig, rows: DemoRow[]) =>
    onChange({ ...audience, instagram: { ...ig, [key]: rows } });
  const setLi = (key: keyof typeof li, rows: DemoRow[]) =>
    onChange({ ...audience, linkedin: { ...li, [key]: rows } });

  return (
    <div className="no-print grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border p-4" style={{ borderColor: BORDER }}>
        <FollowerInput
          label="Instagram followers"
          value={ig.totalFollowers}
          onChange={(v) => onChange({ ...audience, instagram: { ...ig, totalFollowers: v } })}
        />
        <EditRows title="Age" rows={ig.ageGroups} onChange={(r) => setIg("ageGroups", r)} placeholder="e.g. 35-44" />
        <EditRows title="Gender" rows={ig.gender} onChange={(r) => setIg("gender", r)} placeholder="e.g. Women" />
        <EditRows title="Top cities" rows={ig.topCities} onChange={(r) => setIg("topCities", r)} placeholder="e.g. New York" />
        <EditRows title="Top countries" rows={ig.topCountries} onChange={(r) => setIg("topCountries", r)} placeholder="e.g. United States" />
      </div>
      <div className="rounded-xl border p-4" style={{ borderColor: BORDER }}>
        <FollowerInput
          label="LinkedIn followers"
          value={li.totalFollowers}
          onChange={(v) => onChange({ ...audience, linkedin: { ...li, totalFollowers: v } })}
        />
        <EditRows title="Job function" rows={li.jobFunction} onChange={(r) => setLi("jobFunction", r)} placeholder="e.g. Legal" />
        <EditRows title="Seniority" rows={li.seniority} onChange={(r) => setLi("seniority", r)} placeholder="e.g. Senior" />
        <EditRows title="Industry" rows={li.industry} onChange={(r) => setLi("industry", r)} placeholder="e.g. Law Practice" />
        <EditRows title="Company size" rows={li.companySize} onChange={(r) => setLi("companySize", r)} placeholder="e.g. 11-50" />
        <EditRows title="Location" rows={li.location} onChange={(r) => setLi("location", r)} placeholder="e.g. NYC metro" />
      </div>
    </div>
  );
}

function FollowerInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-slate-700">{label}</h3>
      <input
        type="number"
        min={0}
        className="w-28 rounded border px-2 py-1 text-sm tabular-nums"
        style={{ borderColor: BORDER }}
        value={value ?? ""}
        onChange={(e) => {
          if (e.target.value === "") return onChange(null);
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? n : null);
        }}
      />
    </div>
  );
}

function EditRows({
  title,
  rows,
  onChange,
  placeholder,
}: {
  title: string;
  rows: DemoRow[];
  onChange: (rows: DemoRow[]) => void;
  placeholder: string;
}) {
  const add = () => onChange([...rows, { label: "", pct: 0 }]);
  const upd = (i: number, patch: Partial<DemoRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const rm = (i: number) => onChange(rows.filter((_, j) => j !== i));
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
        <button type="button" onClick={add} className="text-xs font-semibold" style={{ color: NAVY }}>
          + Add
        </button>
      </div>
      <div className="mt-2 space-y-1.5">
        {rows.length === 0 ? (
          <p className="text-xs text-slate-400">None yet.</p>
        ) : (
          rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="w-full rounded border px-2 py-1 text-sm"
                style={{ borderColor: BORDER }}
                placeholder={placeholder}
                value={r.label}
                onChange={(e) => upd(i, { label: e.target.value })}
              />
              <input
                type="number"
                min={0}
                max={100}
                step="0.1"
                className="w-16 shrink-0 rounded border px-2 py-1 text-sm tabular-nums"
                style={{ borderColor: BORDER }}
                value={r.pct}
                onChange={(e) => upd(i, { pct: Number(e.target.value) || 0 })}
              />
              <span className="shrink-0 text-xs text-slate-400">%</span>
              <button
                type="button"
                onClick={() => rm(i)}
                className="shrink-0 rounded border px-2 py-1 text-xs text-slate-400 hover:text-rose-600"
                style={{ borderColor: BORDER }}
                aria-label="Remove"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
