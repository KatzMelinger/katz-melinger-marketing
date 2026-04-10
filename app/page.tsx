import type { Metadata } from "next";
import Link from "next/link";
import { CallsBySourceChart } from "@/components/calls-by-source-chart";

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

const recentCalls = [
  {
    name: "Sarah Chen",
    phone: "(212) 555-0142",
    source: "Google Ads",
    duration: "5m 04s",
    status: "answered" as const,
    date: "Apr 9, 2026",
  },
  {
    name: "Marcus Williams",
    phone: "(646) 555-0298",
    source: "Organic Search",
    duration: "2m 41s",
    status: "answered" as const,
    date: "Apr 9, 2026",
  },
  {
    name: "Elena Rodriguez",
    phone: "(917) 555-0167",
    source: "Referral",
    duration: "6m 18s",
    status: "missed" as const,
    date: "Apr 8, 2026",
  },
  {
    name: "David Park",
    phone: "(718) 555-0331",
    source: "Direct",
    duration: "3m 55s",
    status: "answered" as const,
    date: "Apr 8, 2026",
  },
  {
    name: "Amanda Foster",
    phone: "(212) 555-0488",
    source: "Avvo",
    duration: "4m 12s",
    status: "answered" as const,
    date: "Apr 7, 2026",
  },
  {
    name: "James O’Brien",
    phone: "(347) 555-0214",
    source: "Google Ads",
    duration: "—",
    status: "missed" as const,
    date: "Apr 7, 2026",
  },
];

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

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export default function Home() {
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
            <p className="text-sm font-medium text-white/90">
              Total calls this month
            </p>
            <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">
              247
            </p>
          </article>
          <article
            className="rounded-xl border border-white/5 p-5 shadow-sm"
            style={{ backgroundColor: "#166534" }}
          >
            <p className="text-sm font-medium text-white/90">Answered calls</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">
              198
            </p>
          </article>
          <article
            className="rounded-xl border border-white/5 p-5 shadow-sm"
            style={{ backgroundColor: "#b45309" }}
          >
            <p className="text-sm font-medium text-white/90">New intakes</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">
              43
            </p>
          </article>
          <article
            className="rounded-xl border border-white/5 p-5 shadow-sm"
            style={{ backgroundColor: "#475569" }}
          >
            <p className="text-sm font-medium text-white/90">Avg duration</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">
              4m 32s
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
          <CallsBySourceChart />
        </section>

        <section
          className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm"
          style={{ backgroundColor: "#1a2540" }}
        >
          <h2 className="mb-4 text-lg font-semibold text-white">Recent calls</h2>
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
                {recentCalls.map((row) => (
                  <tr
                    key={`${row.phone}-${row.date}`}
                    className="border-b border-[#2a3f5f]/60 last:border-0"
                  >
                    <td className="py-3 pr-4 font-medium text-white">
                      {row.name}
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-slate-300">
                      {row.phone}
                    </td>
                    <td className="py-3 pr-4">{row.source}</td>
                    <td className="py-3 pr-4 tabular-nums">{row.duration}</td>
                    <td className="py-3 pr-4">
                      {row.status === "answered" ? (
                        <span className="inline-flex rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/30">
                          Answered
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-rose-500/20 px-2.5 py-0.5 text-xs font-medium text-rose-300 ring-1 ring-rose-500/30">
                          Missed
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-slate-400">{row.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
    </div>
  );
}
