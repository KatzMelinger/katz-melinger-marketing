import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { Suspense } from "react";
import { CallsBySourceChart } from "@/components/calls-by-source-chart";
import { MarketingNav } from "@/components/marketing-nav";
import {
  buildAttributionRows,
  type CallSummary,
  type CmsAttributionBreakdown,
  type CmsIntakeSource,
} from "@/lib/attribution-merge";
import { getSupabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Katz Melinger PLLC | Marketing Dashboard",
  description:
    "Marketing analytics dashboard for Katz Melinger PLLC, plaintiff employment law in NYC.",
};

type SummaryJson = {
  totalCalls?: number;
  answeredCalls?: number;
  missedCalls?: number;
  firstTimeCalls?: number;
  avgDuration?: number;
  callsBySource?: { name: string; value: number }[];
  error?: string;
} & CallSummary;

type CallsJson = {
  calls?: Array<{
    id: string;
    customer_name: string | null;
    customer_phone_number: string | null;
    source_name: string | null;
    duration: number | null;
    answered: boolean;
    start_time: string;
  }>;
  error?: string;
};

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDurationSeconds(total: number): string {
  if (!Number.isFinite(total) || total < 0) {
    return "—";
  }
  const rounded = Math.round(total);
  const m = Math.floor(rounded / 60);
  const s = rounded % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function formatStartTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) {
    const proto =
      h.get("x-forwarded-proto") ??
      (host.includes("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }
  const fromEnv =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  return fromEnv ?? "http://localhost:3000";
}

async function fetchSummary(): Promise<SummaryJson> {
  try {
    const base = await getRequestOrigin();
    const res = await fetch(`${base}/api/callrail/summary`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return {};
    }
    return (await res.json()) as SummaryJson;
  } catch {
    return {};
  }
}

async function fetchCalls(): Promise<CallsJson> {
  try {
    const base = await getRequestOrigin();
    const res = await fetch(`${base}/api/callrail/calls`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return {};
    }
    return (await res.json()) as CallsJson;
  } catch {
    return {};
  }
}

async function fetchReputationSnapshot(): Promise<{
  googleAvg: number | null;
  totalReviews: number;
  reviewsThisMonth: number;
  responseRatePct: number;
} | null> {
  try {
    const sb = getSupabaseServer();
    if (!sb) return null;
    const { data, error } = await sb
      .from("reviews")
      .select("platform, rating, status, review_date, created_at");
    if (error || !data) return null;
    const rows = data as {
      platform?: string;
      rating?: number;
      status?: string;
      review_date?: string;
      created_at?: string;
    }[];
    const total = rows.length;
    const google = rows.filter((r) =>
      String(r.platform ?? "")
        .toLowerCase()
        .includes("google"),
    );
    const googleAvg =
      google.length > 0
        ? google.reduce((s, r) => s + (Number(r.rating) || 0), 0) / google.length
        : null;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const reviewsThisMonth = rows.filter((r) => {
      const d = r.review_date
        ? new Date(r.review_date)
        : r.created_at
          ? new Date(r.created_at)
          : null;
      return d && !Number.isNaN(d.getTime()) && d >= monthStart;
    }).length;
    const responded = rows.filter((r) =>
      String(r.status ?? "")
        .toLowerCase()
        .includes("responded"),
    ).length;
    const responseRatePct = total ? Math.round((responded / total) * 100) : 0;
    return { googleAvg, totalReviews: total, reviewsThisMonth, responseRatePct };
  } catch {
    return null;
  }
}

async function fetchIntakesBySource(): Promise<CmsIntakeSource[]> {
  try {
    const base = await getRequestOrigin();
    const res = await fetch(`${base}/api/cms/intakes-by-source`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return [];
    }
    const json: unknown = await res.json();
    if (!Array.isArray(json)) {
      return [];
    }
    return json.filter(
      (x): x is CmsIntakeSource =>
        x != null &&
        typeof x === "object" &&
        typeof (x as { source?: unknown }).source === "string" &&
        typeof (x as { count?: unknown }).count === "number",
    );
  } catch {
    return [];
  }
}

async function fetchCmsAttribution(): Promise<CmsAttributionBreakdown[]> {
  try {
    const base = await getRequestOrigin();
    const res = await fetch(`${base}/api/cms/attribution`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { breakdown?: unknown };
    if (!Array.isArray(j.breakdown)) return [];
    return (j.breakdown as CmsAttributionBreakdown[]).filter(
      (x) =>
        x &&
        typeof x.area_of_law === "string" &&
        typeof x.total_settlement_value === "number" &&
        typeof x.settlement_count === "number",
    );
  } catch {
    return [];
  }
}

type HubSnapshot = {
  primaryValue: string;
  primaryLabel: string;
  detail: string;
};

async function fetchSeoSnapshot(): Promise<HubSnapshot> {
  try {
    const base = await getRequestOrigin();
    const res = await fetch(`${base}/api/seo/keywords`, { cache: "no-store" });
    if (!res.ok) throw new Error("not ok");
    const j = (await res.json()) as {
      tracked?: Array<{ position: number; estimatedTraffic?: number }>;
    };
    const tracked = j.tracked ?? [];
    const top10 = tracked.filter((t) => t.position > 0 && t.position <= 10).length;
    const traffic = tracked.reduce((s, t) => s + (t.estimatedTraffic ?? 0), 0);
    return {
      primaryValue: traffic.toLocaleString(),
      primaryLabel: "est. monthly traffic",
      detail: `${top10} top-10 rankings · ${tracked.length} tracked`,
    };
  } catch {
    return {
      primaryValue: "—",
      primaryLabel: "est. monthly traffic",
      detail: "SEO data unavailable",
    };
  }
}

async function fetchAiSnapshot(): Promise<HubSnapshot> {
  try {
    const base = await getRequestOrigin();
    const res = await fetch(`${base}/api/aeo/dashboard`, { cache: "no-store" });
    if (!res.ok) throw new Error("not ok");
    const j = (await res.json()) as { score?: number; averageScore?: number; totalRuns?: number };
    const score = j.score ?? j.averageScore ?? null;
    return {
      primaryValue: score != null ? Math.round(score).toString() : "—",
      primaryLabel: "AEO score",
      detail: j.totalRuns ? `${j.totalRuns} prompt runs` : "AI visibility tracking",
    };
  } catch {
    return {
      primaryValue: "—",
      primaryLabel: "AEO score",
      detail: "AI metrics not configured",
    };
  }
}

async function fetchSocialSnapshot(): Promise<HubSnapshot> {
  try {
    const base = await getRequestOrigin();
    const res = await fetch(`${base}/api/social/metricool`, { cache: "no-store" });
    if (!res.ok) throw new Error("not ok");
    const j = (await res.json()) as {
      connected?: boolean;
      overview?: Array<{ followers: number; engagementRate: number; postsThisMonth: number }>;
    };
    const total = (j.overview ?? []).reduce((s, r) => s + (r.followers ?? 0), 0);
    const posts = (j.overview ?? []).reduce((s, r) => s + (r.postsThisMonth ?? 0), 0);
    return {
      primaryValue: total > 0 ? total.toLocaleString() : "—",
      primaryLabel: "followers (all platforms)",
      detail: posts > 0 ? `${posts} posts this month` : "Configure Metricool",
    };
  } catch {
    return {
      primaryValue: "—",
      primaryLabel: "followers",
      detail: "Social metrics unavailable",
    };
  }
}

async function fetchCampaignsSnapshot(): Promise<HubSnapshot> {
  try {
    const base = await getRequestOrigin();
    const res = await fetch(`${base}/api/constant-contact/lists`, { cache: "no-store" });
    if (!res.ok) throw new Error("not ok");
    const j = (await res.json()) as {
      lists?: Array<{ membership_count?: number }>;
    };
    const total = (j.lists ?? []).reduce((s, l) => s + (l.membership_count ?? 0), 0);
    return {
      primaryValue: total > 0 ? total.toLocaleString() : "—",
      primaryLabel: "email contacts",
      detail: `${j.lists?.length ?? 0} lists active`,
    };
  } catch {
    return {
      primaryValue: "—",
      primaryLabel: "email contacts",
      detail: "Constant Contact not configured",
    };
  }
}

function DashboardSkeleton() {
  return (
    <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <div className="h-8 w-48 animate-pulse rounded bg-white/10" />
        <div className="mt-2 h-4 w-72 animate-pulse rounded bg-white/5" />
      </div>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <article
            key={i}
            className="rounded-xl border border-white/5 p-5 shadow-sm"
            style={{ backgroundColor: "#ffffff" }}
          >
            <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
            <div className="mt-3 h-9 w-20 animate-pulse rounded bg-white/10" />
          </article>
        ))}
      </section>
      <section
        className="rounded-xl border border-[#e2e8f0] p-6 shadow-sm"
        style={{ backgroundColor: "#ffffff" }}
      >
        <div className="mb-4 h-6 w-40 animate-pulse rounded bg-white/10" />
        <div className="h-[300px] animate-pulse rounded-lg bg-white/5" />
      </section>
      <section
        className="rounded-xl border border-[#e2e8f0] p-6 shadow-sm"
        style={{ backgroundColor: "#ffffff" }}
      >
        <div className="mb-4 h-6 w-36 animate-pulse rounded bg-white/10" />
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-10 animate-pulse rounded bg-white/5"
            />
          ))}
        </div>
      </section>
    </main>
  );
}

async function DashboardMain() {
  const [
    summary,
    callsPayload,
    intakeBySource,
    attributionBreakdown,
    reputation,
    seoSnap,
    aiSnap,
    socialSnap,
    campaignsSnap,
  ] = await Promise.all([
    fetchSummary(),
    fetchCalls(),
    fetchIntakesBySource(),
    fetchCmsAttribution(),
    fetchReputationSnapshot(),
    fetchSeoSnapshot(),
    fetchAiSnapshot(),
    fetchSocialSnapshot(),
    fetchCampaignsSnapshot(),
  ]);

  const totalCalls = summary.totalCalls ?? 0;
  const answeredCalls = summary.answeredCalls ?? 0;
  const newIntakes = summary.firstTimeCalls ?? 0;
  const avgDuration = summary.avgDuration ?? 0;

  const chartData =
    summary.callsBySource?.map(({ name, value }) => ({
      name,
      calls: value,
    })) ?? [];

  const rawCalls = Array.isArray(callsPayload.calls)
    ? [...callsPayload.calls]
    : [];
  rawCalls.sort(
    (a, b) =>
      new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
  );

  const attributionRows = buildAttributionRows(
    summary,
    attributionBreakdown,
    intakeBySource,
  );

  return (
    <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Katz Melinger PLLC · Plaintiff employment law · NYC
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
          Ops Hubs
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <HubTile
            href="/seo"
            eyebrow="SEO Ops"
            title="Organic search"
            primaryValue={seoSnap.primaryValue}
            primaryLabel={seoSnap.primaryLabel}
            detail={seoSnap.detail}
            tone="#185FA5"
          />
          <HubTile
            href="/ai"
            eyebrow="AI Ops"
            title="AI visibility"
            primaryValue={aiSnap.primaryValue}
            primaryLabel={aiSnap.primaryLabel}
            detail={aiSnap.detail}
            tone="#7C3AED"
          />
          <HubTile
            href="/social"
            eyebrow="Social Ops"
            title="Owned + earned reach"
            primaryValue={socialSnap.primaryValue}
            primaryLabel={socialSnap.primaryLabel}
            detail={socialSnap.detail}
            tone="#166534"
          />
          <HubTile
            href="/campaigns"
            eyebrow="Campaigns Ops"
            title="Paid + email"
            primaryValue={campaignsSnap.primaryValue}
            primaryLabel={campaignsSnap.primaryLabel}
            detail={campaignsSnap.detail}
            tone="#B45309"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Link
            href="/alerts"
            className="rounded-md border border-[#e2e8f0] bg-white px-3 py-1.5 text-slate-700 hover:border-[#185FA5] hover:text-[#185FA5]"
          >
            🔔 Alerts
          </Link>
          <Link
            href="/recommendations"
            className="rounded-md border border-[#e2e8f0] bg-white px-3 py-1.5 text-slate-700 hover:border-[#185FA5] hover:text-[#185FA5]"
          >
            💡 Recommendations
          </Link>
          <Link
            href="/analytics"
            className="rounded-md border border-[#e2e8f0] bg-white px-3 py-1.5 text-slate-700 hover:border-[#185FA5] hover:text-[#185FA5]"
          >
            ▣ Analytics
          </Link>
          <Link
            href="/attribution"
            className="rounded-md border border-[#e2e8f0] bg-white px-3 py-1.5 text-slate-700 hover:border-[#185FA5] hover:text-[#185FA5]"
          >
            ⎔ Attribution
          </Link>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
          Acquisition snapshot
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <article
          className="rounded-xl border border-white/5 p-5 shadow-sm"
          style={{ backgroundColor: "#185FA5" }}
        >
          <p className="text-sm font-medium text-white/90">Total calls</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">
            {totalCalls}
          </p>
        </article>
        <article
          className="rounded-xl border border-white/5 p-5 shadow-sm"
          style={{ backgroundColor: "#166534" }}
        >
          <p className="text-sm font-medium text-white/90">Answered calls</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">
            {answeredCalls}
          </p>
        </article>
        <article
          className="rounded-xl border border-white/5 p-5 shadow-sm"
          style={{ backgroundColor: "#b45309" }}
        >
          <p className="text-sm font-medium text-white/90">New intakes</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">
            {newIntakes}
          </p>
          <p className="mt-1 text-xs text-white/70">
            First-time callers (CallRail)
          </p>
        </article>
        <article
          className="rounded-xl border border-white/5 p-5 shadow-sm"
          style={{ backgroundColor: "#475569" }}
        >
          <p className="text-sm font-medium text-white/90">Avg duration</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">
            {formatDurationSeconds(avgDuration)}
          </p>
        </article>
        </div>
      </section>

      <section
        id="calls"
        className="rounded-xl border border-[#e2e8f0] p-6 shadow-sm"
        style={{ backgroundColor: "#ffffff" }}
      >
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Calls by source
            </h2>
            <p className="text-sm text-slate-500">Inbound volume by channel</p>
          </div>
        </div>
        <CallsBySourceChart data={chartData} />
      </section>

      <section
        className="rounded-xl border border-[#e2e8f0] p-6 shadow-sm"
        style={{ backgroundColor: "#ffffff" }}
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Recent calls</h2>
        {rawCalls.length === 0 ? (
          <p className="text-sm text-slate-500">
            No recent calls to display.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#e2e8f0] text-slate-500">
                  <th className="pb-3 pr-4 font-medium">Caller</th>
                  <th className="pb-3 pr-4 font-medium">Phone</th>
                  <th className="pb-3 pr-4 font-medium">Source</th>
                  <th className="pb-3 pr-4 font-medium">Duration</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {rawCalls.map((row) => {
                  const callerName =
                    row.customer_name?.trim() || "Unknown caller";
                  const callerNumber =
                    row.customer_phone_number?.trim() || "—";
                  const source = row.source_name?.trim() || "—";
                  const duration = formatDurationSeconds(row.duration ?? 0);
                  const durationDisplay =
                    row.duration == null || row.duration < 0 ? "—" : duration;

                  return (
                    <tr
                      key={row.id}
                      className="border-b border-[#e2e8f0]/60 last:border-0"
                    >
                      <td className="py-3 pr-4 font-medium text-slate-900">
                        {callerName}
                      </td>
                      <td className="py-3 pr-4 tabular-nums text-slate-600">
                        {callerNumber}
                      </td>
                      <td className="py-3 pr-4">{source}</td>
                      <td className="py-3 pr-4 tabular-nums">
                        {durationDisplay}
                      </td>
                      <td className="py-3 pr-4">
                        {row.answered ? (
                          <span className="inline-flex rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/30">
                            Answered
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-rose-500/20 px-2.5 py-0.5 text-xs font-medium text-rose-300 ring-1 ring-rose-500/30">
                            Missed
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-slate-500">
                        {formatStartTime(row.start_time)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        id="attribution"
        className="rounded-xl border border-[#e2e8f0] p-6 shadow-sm"
        style={{ backgroundColor: "#ffffff" }}
      >
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Marketing attribution
          </h2>
          <p className="text-sm text-slate-500">
            Sources tied to intakes, open matters, and settlement value
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#e2e8f0] text-slate-500">
                <th className="pb-3 pr-4 font-medium">Source</th>
                <th className="pb-3 pr-4 font-medium">Total calls</th>
                <th className="pb-3 pr-4 font-medium">Intakes created</th>
                <th className="pb-3 pr-4 font-medium">Matters opened</th>
                <th className="pb-3 pr-4 font-medium">Settlement value</th>
                <th className="pb-3 pr-4 font-medium">Conversion</th>
                <th className="pb-3 font-medium">Avg settlement</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {attributionRows.map((row) => (
                <tr
                  key={row.source}
                  className="border-b border-[#e2e8f0]/60 last:border-0"
                >
                  <td className="py-3 pr-4 font-medium text-slate-900">
                    {row.source}
                  </td>
                  <td className="py-3 pr-4 tabular-nums">{row.totalCalls}</td>
                  <td className="py-3 pr-4 tabular-nums">{row.intakes}</td>
                  <td className="py-3 pr-4 tabular-nums">
                    {row.mattersOpened}
                  </td>
                  <td className="py-3 pr-4 font-medium tabular-nums text-slate-900">
                    {formatCurrency(row.totalSettlementValue)}
                  </td>
                  <td className="py-3 pr-4 tabular-nums">
                    {row.conversionRate.toFixed(1)}%
                  </td>
                  <td className="py-3 tabular-nums">
                    {formatCurrency(row.avgSettlement)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section
        id="reputation"
        className="rounded-xl border border-[#e2e8f0] p-6 shadow-sm"
        style={{ backgroundColor: "#ffffff" }}
      >
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Reputation snapshot</h2>
            <p className="text-sm text-slate-500">From Supabase reviews (same data as CMS)</p>
          </div>
          <Link href="/reviews" className="text-sm text-sky-300 hover:text-slate-900">
            Reviews dashboard →
          </Link>
        </div>
        {reputation ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <article className="rounded-lg border border-white/10 p-4" style={{ backgroundColor: "#185FA5" }}>
              <p className="text-xs font-medium text-white/90">Avg Google rating</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {reputation.googleAvg != null ? reputation.googleAvg.toFixed(2) : "—"}
              </p>
            </article>
            <article className="rounded-lg border border-white/10 p-4" style={{ backgroundColor: "#166534" }}>
              <p className="text-xs font-medium text-white/90">Total reviews</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{reputation.totalReviews}</p>
            </article>
            <article className="rounded-lg border border-white/10 p-4" style={{ backgroundColor: "#b45309" }}>
              <p className="text-xs font-medium text-white/90">Reviews this month</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{reputation.reviewsThisMonth}</p>
            </article>
            <article className="rounded-lg border border-white/10 p-4" style={{ backgroundColor: "#475569" }}>
              <p className="text-xs font-medium text-white/90">Response rate</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{reputation.responseRatePct}%</p>
            </article>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Reviews could not be loaded. Configure{" "}
            <code className="text-slate-700">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className="text-slate-700">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{" "}
            (or service role for server-only paths).
          </p>
        )}
      </section>
    </main>
  );
}

export default async function Home() {
  return (
    <div
      className="min-h-full text-slate-900"
      style={{
        backgroundColor: "#ffffff",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <MarketingNav />

      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardMain />
      </Suspense>
    </div>
  );
}

function HubTile({
  href,
  eyebrow,
  title,
  primaryValue,
  primaryLabel,
  detail,
  tone,
}: {
  href: string;
  eyebrow: string;
  title: string;
  primaryValue: string;
  primaryLabel: string;
  detail: string;
  tone: string;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-xl border border-transparent p-5 shadow-sm transition hover:border-white/30 hover:shadow-md"
      style={{ backgroundColor: tone }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">
        {eyebrow}
      </p>
      <p className="mt-1 text-base font-semibold text-white">{title}</p>
      <p className="mt-3 text-3xl font-semibold tabular-nums text-white">
        {primaryValue}
      </p>
      <p className="mt-0.5 text-[11px] text-white/80">{primaryLabel}</p>
      <p className="mt-3 text-xs text-white/80">{detail}</p>
      <p className="mt-3 text-xs font-medium text-white/90 group-hover:underline">
        Open hub →
      </p>
    </Link>
  );
}
