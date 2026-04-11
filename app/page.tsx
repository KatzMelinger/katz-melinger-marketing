import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { Suspense } from "react";
import { CallsBySourceChart } from "@/components/calls-by-source-chart";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Katz Melinger PLLC | Marketing Dashboard",
  description:
    "Marketing analytics dashboard for Katz Melinger PLLC, plaintiff employment law in NYC.",
};

const navItems = [
  { label: "Dashboard", href: "/" },
  { label: "Calls", href: "#calls" },
  { label: "SEO", href: "#seo" },
  { label: "Social", href: "#social" },
  { label: "Reviews", href: "#reviews" },
  { label: "Content", href: "#content" },
  { label: "Attribution", href: "#attribution" },
] as const;

const attributionRows = [
  {
    source: "Google Ads",
    totalCalls: 89,
    intakes: 24,
    matters: 9,
    settlementValue: 2_450_000,
  },
  {
    source: "Organic Search",
    totalCalls: 67,
    intakes: 18,
    matters: 7,
    settlementValue: 1_820_000,
  },
  {
    source: "Referral",
    totalCalls: 45,
    intakes: 14,
    matters: 6,
    settlementValue: 1_340_000,
  },
  {
    source: "Direct",
    totalCalls: 28,
    intakes: 8,
    matters: 3,
    settlementValue: 620_000,
  },
  {
    source: "Avvo",
    totalCalls: 18,
    intakes: 5,
    matters: 2,
    settlementValue: 280_000,
  },
];

type SummaryJson = {
  totalCalls?: number;
  answeredCalls?: number;
  missedCalls?: number;
  avgDuration?: number;
  callsBySource?: { name: string; value: number }[];
  error?: string;
};

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
            style={{ backgroundColor: "#1a2540" }}
          >
            <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
            <div className="mt-3 h-9 w-20 animate-pulse rounded bg-white/10" />
          </article>
        ))}
      </section>
      <section
        className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm"
        style={{ backgroundColor: "#1a2540" }}
      >
        <div className="mb-4 h-6 w-40 animate-pulse rounded bg-white/10" />
        <div className="h-[300px] animate-pulse rounded-lg bg-white/5" />
      </section>
      <section
        className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm"
        style={{ backgroundColor: "#1a2540" }}
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
  const [summary, callsPayload] = await Promise.all([
    fetchSummary(),
    fetchCalls(),
  ]);

  const totalCalls = summary.totalCalls ?? 0;
  const answeredCalls = summary.answeredCalls ?? 0;
  const missedCalls = summary.missedCalls ?? 0;
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

  return (
    <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Katz Melinger PLLC · Plaintiff employment law · NYC
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          <p className="text-sm font-medium text-white/90">Missed calls</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">
            {missedCalls}
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
      </section>

      <section
        id="calls"
        className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm"
        style={{ backgroundColor: "#1a2540" }}
      >
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Calls by source
            </h2>
            <p className="text-sm text-slate-400">Inbound volume by channel</p>
          </div>
        </div>
        <CallsBySourceChart data={chartData} />
      </section>

      <section
        className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm"
        style={{ backgroundColor: "#1a2540" }}
      >
        <h2 className="mb-4 text-lg font-semibold text-white">Recent calls</h2>
        {rawCalls.length === 0 ? (
          <p className="text-sm text-slate-400">
            No recent calls to display.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#2a3f5f] text-slate-400">
                  <th className="pb-3 pr-4 font-medium">Caller</th>
                  <th className="pb-3 pr-4 font-medium">Phone</th>
                  <th className="pb-3 pr-4 font-medium">Source</th>
                  <th className="pb-3 pr-4 font-medium">Duration</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
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
                      className="border-b border-[#2a3f5f]/60 last:border-0"
                    >
                      <td className="py-3 pr-4 font-medium text-white">
                        {callerName}
                      </td>
                      <td className="py-3 pr-4 tabular-nums text-slate-300">
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
                      <td className="py-3 text-slate-400">
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
        className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm"
        style={{ backgroundColor: "#1a2540" }}
      >
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">
            Marketing attribution
          </h2>
          <p className="text-sm text-slate-400">
            Sources tied to intakes, open matters, and settlement value
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#2a3f5f] text-slate-400">
                <th className="pb-3 pr-4 font-medium">Source</th>
                <th className="pb-3 pr-4 font-medium">Total calls</th>
                <th className="pb-3 pr-4 font-medium">Intakes created</th>
                <th className="pb-3 pr-4 font-medium">Matters opened</th>
                <th className="pb-3 font-medium">Settlement value</th>
              </tr>
            </thead>
            <tbody className="text-slate-200">
              {attributionRows.map((row) => (
                <tr
                  key={row.source}
                  className="border-b border-[#2a3f5f]/60 last:border-0"
                >
                  <td className="py-3 pr-4 font-medium text-white">
                    {row.source}
                  </td>
                  <td className="py-3 pr-4 tabular-nums">{row.totalCalls}</td>
                  <td className="py-3 pr-4 tabular-nums">{row.intakes}</td>
                  <td className="py-3 pr-4 tabular-nums">{row.matters}</td>
                  <td className="py-3 font-medium tabular-nums text-white">
                    {formatCurrency(row.settlementValue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default async function Home() {
  return (
    <div
      className="min-h-full text-white"
      style={{
        backgroundColor: "#0f1729",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <header
        className="sticky top-0 z-10 border-b border-[#2a3f5f]"
        style={{ backgroundColor: "#0f1729" }}
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <Link
            href="/"
            className="text-lg font-semibold tracking-tight"
            style={{ color: "#185FA5" }}
          >
            KatzMelinger Marketing
          </Link>
          <nav className="flex flex-wrap items-center gap-1 sm:gap-2">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-2 text-sm transition-colors hover:bg-[#1a2540] hover:text-white ${
                  item.href === "/"
                    ? "bg-[#1a2540] text-white"
                    : "text-slate-300"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardMain />
      </Suspense>
    </div>
  );
}
