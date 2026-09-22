"use client";

/**
 * Monthly SEO + Marketing report — spec 4.3 (F1).
 *
 * Two report views (a toggle, not two routes, since they share almost every
 * data source): the SEO Report, and the Marketing Status Report (SEO section
 * plus website/content-pipeline/AI-visibility). "Download PDF" reuses the
 * exact pattern already proven on the social report
 * (app/social/report/page.tsx) — a print stylesheet + window.print() —
 * rather than adding a new PDF-rendering dependency for a second report.
 *
 * Data sources, composed the same way every other page in this app composes
 * several APIs: /api/reports/monthly (the new SEO+pipeline assembly, spec 4.1
 * dependency) plus the GA4, AEO, and AI-bot-crawl endpoints that already
 * exist and already work on their own.
 *
 * Technical SEO's schema and crawl-error checks now run a real live crawl
 * (spec 4.2, lib/technical-seo-crawl.ts) — this page points to /seo/technical
 * for the finding-by-finding detail rather than flattening it into a tile here.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { MarketingNav } from "@/components/marketing-nav";

const NAVY = "#0F2647";
const BRAND = "#2563EB";

type KpiWithTrend = { label: string; current: number; prior: number | null };
type SeoReportData = {
  domain: string;
  kpis: {
    top10Count: KpiWithTrend;
    totalTracked: KpiWithTrend;
    estOrganicTraffic: KpiWithTrend;
    estTrafficValue: KpiWithTrend;
  };
  monthlyTrend: Array<{ month: string; top10Count: number; estOrganicTraffic: number }>;
  positionBands: Array<{ band: string; count: number }>;
  topKeywordsByCluster: Array<{ pillar: string; label: string; keywords: string[] }>;
  backlinks: {
    authorityScore: number;
    totalBacklinks: number;
    referringDomains: number;
    domainsByToxicity: { low: number; medium: number; high: number };
  };
  technical: { mobilePerformance: number; desktopPerformance: number; schemaAndCrawlChecksConnected: true };
  gaps: Array<{ keyword: string; searchVolume: number; reason: string }>;
};
type PipelineCounts = { inProduction: number; awaitingApproval: number; published: number; heldForLegal: number };
type MonthlyPayload = { seo: SeoReportData; pipeline: PipelineCounts; generatedAt: string; error?: string };

type Ga4Overview = { sessions: number; activeUsers: number; newUsers: number; screenPageViews: number; error?: string };
type Ga4Sources = { sources: Array<{ name: string; sessions: number }>; error?: string };
type Ga4Pages = { pages: Array<{ pagePath: string; screenPageViews: number }>; error?: string };
type AeoDashboard = {
  promptCoverage?: { total: number; covered: number; pct: number };
  selfMentionRatePct?: number;
  error?: string;
} | null;
type AiBots = { byBot: Array<{ bot: string; vendor: string; hits: number }>; error?: string };

async function fetchJsonSafe<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function fmt(n: number): string {
  return n.toLocaleString();
}
function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}
function delta(k: KpiWithTrend): string | null {
  if (k.prior === null) return null;
  const diff = k.current - k.prior;
  if (diff === 0) return "no change vs prior month";
  return `${diff > 0 ? "+" : ""}${diff.toLocaleString()} vs prior month`;
}

function KpiTile({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{sub ?? "No prior-month data yet"}</div>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="avoid-break rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">{title}</h3>
      {children}
    </div>
  );
}

export default function ReportsPage() {
  const [view, setView] = useState<"seo" | "marketing">("seo");
  const [monthly, setMonthly] = useState<MonthlyPayload | null>(null);
  const [ga4, setGa4] = useState<Ga4Overview | null>(null);
  const [ga4Sources, setGa4Sources] = useState<Ga4Sources | null>(null);
  const [ga4Pages, setGa4Pages] = useState<Ga4Pages | null>(null);
  const [aeo, setAeo] = useState<AeoDashboard>(null);
  const [aiBots, setAiBots] = useState<AiBots | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [m, g, gs, gp, a, b] = await Promise.all([
        fetchJsonSafe<MonthlyPayload>("/api/reports/monthly"),
        fetchJsonSafe<Ga4Overview>("/api/analytics/overview"),
        fetchJsonSafe<Ga4Sources>("/api/analytics/traffic-sources"),
        fetchJsonSafe<Ga4Pages>("/api/analytics/pages"),
        fetchJsonSafe<AeoDashboard>("/api/aeo/dashboard"),
        fetchJsonSafe<AiBots>("/api/ai-bots/recent?days=30"),
      ]);
      if (cancelled) return;
      setMonthly(m);
      setGa4(g);
      setGa4Sources(gs);
      setGa4Pages(gp);
      setAeo(a);
      setAiBots(b);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const monthLabel = useMemo(
    () => new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    [],
  );

  const seo = monthly?.seo;

  return (
    <div className="min-h-full text-slate-900" style={{ backgroundColor: "#ffffff" }}>
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
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: NAVY }}>
              Reports
            </p>
            <h1 className="mt-1 text-2xl font-semibold" style={{ color: NAVY }}>
              {view === "seo" ? "SEO Report" : "Marketing Status Report"} — {monthLabel}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {seo?.domain ?? "…"} · Generated {monthly?.generatedAt ? new Date(monthly.generatedAt).toLocaleString() : "…"}
            </p>
          </div>
          <div className="no-print flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
              <button
                onClick={() => setView("seo")}
                className={`rounded px-3 py-1 font-medium ${view === "seo" ? "text-white" : "text-slate-500"}`}
                style={view === "seo" ? { backgroundColor: BRAND } : undefined}
              >
                SEO Report
              </button>
              <button
                onClick={() => setView("marketing")}
                className={`rounded px-3 py-1 font-medium ${view === "marketing" ? "text-white" : "text-slate-500"}`}
                style={view === "marketing" ? { backgroundColor: BRAND } : undefined}
              >
                Marketing Status
              </button>
            </div>
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

        {loading && <p className="text-sm text-slate-500">Assembling report…</p>}
        {monthly?.error && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
            {monthly.error}
          </div>
        )}

        {!loading && seo && (
          <>
            {/* Executive summary + KPI tiles — shared by both views */}
            <SectionCard title="Executive summary">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <KpiTile label={seo.kpis.top10Count.label} value={fmt(seo.kpis.top10Count.current)} sub={delta(seo.kpis.top10Count)} />
                <KpiTile label={seo.kpis.totalTracked.label} value={fmt(seo.kpis.totalTracked.current)} sub={delta(seo.kpis.totalTracked)} />
                <KpiTile label={seo.kpis.estOrganicTraffic.label} value={fmt(seo.kpis.estOrganicTraffic.current)} sub={delta(seo.kpis.estOrganicTraffic)} />
                <KpiTile label={seo.kpis.estTrafficValue.label} value={money(seo.kpis.estTrafficValue.current)} sub={delta(seo.kpis.estTrafficValue)} />
              </div>
            </SectionCard>

            {seo.monthlyTrend.length >= 2 ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <SectionCard title="Keywords in top 10 (by month)">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={seo.monthlyTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="top10Count" fill={BRAND} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </SectionCard>
                <SectionCard title="Estimated organic traffic (by month)">
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={seo.monthlyTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="estOrganicTraffic" stroke={NAVY} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </SectionCard>
              </div>
            ) : (
              <SectionCard title="Trend charts">
                <p className="text-sm text-slate-500">
                  Not enough ranking history yet to chart a trend — the tracker started recording
                  {seo.monthlyTrend[0]?.month ? ` in ${seo.monthlyTrend[0].month}` : " recently"}. This
                  fills in automatically as more months of data accumulate.
                </p>
              </SectionCard>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SectionCard title="Rankings by position band">
                <table className="w-full text-sm">
                  <tbody>
                    {seo.positionBands.map((b) => (
                      <tr key={b.band} className="border-b border-slate-100 last:border-0">
                        <td className="py-1.5 text-slate-600">{b.band}</td>
                        <td className="py-1.5 text-right font-medium text-slate-900">{b.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </SectionCard>
              <SectionCard title="Backlinks & domain strength">
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><dt className="text-slate-500">Domain rank</dt><dd className="font-medium">{seo.backlinks.authorityScore}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Referring domains</dt><dd className="font-medium">{fmt(seo.backlinks.referringDomains)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Total backlinks</dt><dd className="font-medium">{fmt(seo.backlinks.totalBacklinks)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Toxicity risk (referring domains)</dt><dd className="font-medium">{seo.backlinks.domainsByToxicity.high} high · {seo.backlinks.domainsByToxicity.medium} medium · {seo.backlinks.domainsByToxicity.low} low</dd></div>
                </dl>
              </SectionCard>
            </div>

            <SectionCard title="Top keywords by cluster">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {seo.topKeywordsByCluster.map((c) => (
                  <div key={c.pillar}>
                    <div className="text-xs font-semibold text-slate-700">{c.label}</div>
                    <ul className="mt-1 space-y-0.5">
                      {c.keywords.map((k) => (
                        <li key={k} className="text-xs text-slate-500">{k}</li>
                      ))}
                    </ul>
                  </div>
                ))}
                {seo.topKeywordsByCluster.length === 0 && (
                  <p className="text-sm text-slate-500">No ranked target keywords yet.</p>
                )}
              </div>
            </SectionCard>

            <SectionCard title="Gaps & opportunities">
              {seo.gaps.length === 0 ? (
                <p className="text-sm text-slate-500">Every tracked target keyword ranks somewhere in the top 100.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-slate-400">
                      <th className="pb-1">Keyword</th>
                      <th className="pb-1 text-right">Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seo.gaps.map((g) => (
                      <tr key={g.keyword} className="border-b border-slate-100 last:border-0">
                        <td className="py-1 text-slate-700">{g.keyword}</td>
                        <td className="py-1 text-right text-slate-500">{fmt(g.searchVolume)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </SectionCard>

            <SectionCard title="AI-search referrals (crawl activity, last 30 days)">
              {aiBots?.byBot?.length ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-slate-400">
                      <th className="pb-1">Bot</th>
                      <th className="pb-1">Vendor</th>
                      <th className="pb-1 text-right">Hits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aiBots.byBot.map((b) => (
                      <tr key={b.bot} className="border-b border-slate-100 last:border-0">
                        <td className="py-1 text-slate-700">{b.bot}</td>
                        <td className="py-1 text-slate-500">{b.vendor}</td>
                        <td className="py-1 text-right font-medium">{fmt(b.hits)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-slate-500">No AI-crawler hits recorded in the last 30 days.</p>
              )}
            </SectionCard>

            <SectionCard title="Connect-to-complete signals">
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><dt className="text-slate-500">Mobile performance</dt><dd className="font-medium">{seo.technical.mobilePerformance}/100</dd></div>
                <div><dt className="text-slate-500">Desktop performance</dt><dd className="font-medium">{seo.technical.desktopPerformance}/100</dd></div>
              </dl>
              <p className="mt-2 text-xs text-slate-400">
                Schema markup and crawl-error findings run on a live crawl —
                see the finding-by-finding detail on{" "}
                <a href="/seo/technical" className="underline hover:text-slate-600">
                  Technical SEO
                </a>
                .
              </p>
            </SectionCard>

            {view === "marketing" && (
              <>
                <SectionCard title="Website (GA4, last 30 days)">
                  {ga4?.error ? (
                    <p className="text-sm text-amber-700">{ga4.error}</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <KpiTile label="Sessions" value={fmt(ga4?.sessions ?? 0)} sub=" " />
                      <KpiTile label="Users" value={fmt(ga4?.activeUsers ?? 0)} sub=" " />
                      <KpiTile label="New users" value={fmt(ga4?.newUsers ?? 0)} sub=" " />
                      <KpiTile label="Page views" value={fmt(ga4?.screenPageViews ?? 0)} sub=" " />
                    </div>
                  )}
                </SectionCard>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <SectionCard title="Traffic sources">
                    {ga4Sources?.sources?.length ? (
                      <table className="w-full text-sm">
                        <tbody>
                          {ga4Sources.sources.slice(0, 8).map((s) => (
                            <tr key={s.name} className="border-b border-slate-100 last:border-0">
                              <td className="py-1 text-slate-600">{s.name}</td>
                              <td className="py-1 text-right font-medium">{fmt(s.sessions)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-sm text-slate-500">{ga4Sources?.error ?? "No data."}</p>
                    )}
                  </SectionCard>
                  <SectionCard title="Top content">
                    {ga4Pages?.pages?.length ? (
                      <table className="w-full text-sm">
                        <tbody>
                          {ga4Pages.pages.slice(0, 8).map((p) => (
                            <tr key={p.pagePath} className="border-b border-slate-100 last:border-0">
                              <td className="py-1 text-slate-600">{p.pagePath}</td>
                              <td className="py-1 text-right font-medium">{fmt(p.screenPageViews)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-sm text-slate-500">{ga4Pages?.error ?? "No data."}</p>
                    )}
                  </SectionCard>
                </div>

                <SectionCard title="Content pipeline">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <KpiTile label="In production" value={fmt(monthly?.pipeline.inProduction ?? 0)} sub=" " />
                    <KpiTile label="Awaiting approval" value={fmt(monthly?.pipeline.awaitingApproval ?? 0)} sub=" " />
                    <KpiTile label="Held for legal" value={fmt(monthly?.pipeline.heldForLegal ?? 0)} sub=" " />
                    <KpiTile label="Published" value={fmt(monthly?.pipeline.published ?? 0)} sub=" " />
                  </div>
                </SectionCard>

                <SectionCard title="AI visibility (tracked prompts)">
                  {aeo?.error || !aeo?.promptCoverage ? (
                    <p className="text-sm text-slate-500">{aeo?.error ?? "No AEO run yet this period."}</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <KpiTile label="Tracked prompts" value={fmt(aeo.promptCoverage.total)} sub=" " />
                      <KpiTile label="Mentioned in" value={`${aeo.promptCoverage.covered} (${aeo.promptCoverage.pct}%)`} sub=" " />
                      <KpiTile label="Self-mention rate" value={`${aeo.selfMentionRatePct ?? 0}%`} sub=" " />
                    </div>
                  )}
                </SectionCard>
              </>
            )}

            <SectionCard title="Priorities">
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                {seo.gaps.length > 0 && (
                  <li>{seo.gaps.length} target keyword{seo.gaps.length === 1 ? "" : "s"} still outside the top 100 — see Gaps & opportunities.</li>
                )}
                {seo.backlinks.domainsByToxicity.high > 0 && (
                  <li>{seo.backlinks.domainsByToxicity.high} referring domain{seo.backlinks.domainsByToxicity.high === 1 ? "" : "s"} flagged high-toxicity — review for a disavow.</li>
                )}
                {(monthly?.pipeline.heldForLegal ?? 0) > 0 && (
                  <li>{monthly?.pipeline.heldForLegal} draft{monthly?.pipeline.heldForLegal === 1 ? "" : "s"} held for legal review — see Content Production.</li>
                )}
                {seo.monthlyTrend.length < 2 && (
                  <li>Rank-history trend charts need another month of data to show a comparison.</li>
                )}
                {seo.gaps.length === 0 &&
                  seo.backlinks.domainsByToxicity.high === 0 &&
                  (monthly?.pipeline.heldForLegal ?? 0) === 0 && <li>No urgent items this period.</li>}
              </ul>
            </SectionCard>
          </>
        )}
      </main>
    </div>
  );
}
