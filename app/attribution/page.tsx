import type { Metadata } from "next";
import { headers } from "next/headers";

import { MarketingNav } from "@/components/marketing-nav";
import { RechartsPie } from "@/components/recharts-pie";
import {
  buildAttributionRows,
  type CallSummary,
  type CmsAttributionBreakdown,
  type CmsIntakeSource,
} from "@/lib/attribution-merge";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Attribution | Katz Melinger Marketing",
};

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

function fmtUsd(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export default async function AttributionPage() {
  const base = await getRequestOrigin();
  const [sumRes, attrRes, intakeRes] = await Promise.all([
    fetch(`${base}/api/callrail/summary`, { cache: "no-store" }),
    fetch(`${base}/api/cms/attribution`, { cache: "no-store" }),
    fetch(`${base}/api/cms/intakes-by-source`, { cache: "no-store" }),
  ]);

  const summary = sumRes.ok
    ? ((await sumRes.json()) as CallSummary)
    : ({} as CallSummary);
  const attrJson = attrRes.ok ? ((await attrRes.json()) as { breakdown?: unknown }) : {};
  const breakdown: CmsAttributionBreakdown[] = Array.isArray(attrJson.breakdown)
    ? (attrJson.breakdown as CmsAttributionBreakdown[]).filter(
        (x) =>
          x &&
          typeof x.area_of_law === "string" &&
          typeof x.total_settlement_value === "number" &&
          typeof x.settlement_count === "number",
      )
    : [];

  const intakesRaw = intakeRes.ok ? ((await intakeRes.json()) as unknown) : [];
  const intakesBySource: CmsIntakeSource[] = Array.isArray(intakesRaw)
    ? intakesRaw.filter(
        (x): x is CmsIntakeSource =>
          x != null &&
          typeof x === "object" &&
          typeof (x as { source?: unknown }).source === "string" &&
          typeof (x as { count?: unknown }).count === "number",
      )
    : [];

  const rows = buildAttributionRows(summary, breakdown, intakesBySource);

  const totalCalls = summary.totalCalls ?? 0;
  const totalIntakes = intakesBySource.reduce((s, r) => s + r.count, 0);
  const totalMatters = rows.reduce((s, r) => s + r.mattersOpened, 0);
  const totalSettlement = rows.reduce(
    (s, r) => s + r.totalSettlementValue,
    0,
  );

  const pieData = rows
    .filter((r) => r.totalSettlementValue > 0)
    .map((r) => ({ name: r.source, value: r.totalSettlementValue }));

  return (
    <div
      className="min-h-full text-white"
      style={{
        backgroundColor: "#0f1729",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <MarketingNav />

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">Attribution</h1>
          <p className="mt-1 text-sm text-slate-400">
            CallRail calls + CMS intakes and settlement data by source /
            practice area.
          </p>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Total calls", value: String(totalCalls), bg: "#185FA5" },
            { label: "Total intakes", value: String(totalIntakes), bg: "#166534" },
            { label: "Matters (settlements)", value: String(totalMatters), bg: "#b45309" },
            {
              label: "Total settlement value",
              value: fmtUsd(totalSettlement),
              bg: "#475569",
            },
          ].map((c) => (
            <article
              key={c.label}
              className="rounded-xl border border-white/5 p-5 shadow-sm"
              style={{ backgroundColor: c.bg }}
            >
              <p className="text-sm font-medium text-white/90">{c.label}</p>
              <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">
                {c.value}
              </p>
            </article>
          ))}
        </section>

        <section
          className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm"
          style={{ backgroundColor: "#1a2540" }}
        >
          <h2 className="mb-4 text-lg font-semibold text-white">
            Full attribution
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#2a3f5f] text-slate-400">
                  <th className="pb-3 pr-4 font-medium">Source</th>
                  <th className="pb-3 pr-4 font-medium">Total calls</th>
                  <th className="pb-3 pr-4 font-medium">Intakes created</th>
                  <th className="pb-3 pr-4 font-medium">Matters opened</th>
                  <th className="pb-3 pr-4 font-medium">Settlement value</th>
                  <th className="pb-3 pr-4 font-medium">Conversion</th>
                  <th className="pb-3 font-medium">Avg settlement</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      No attribution rows. Configure CMS and CallRail.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr
                      key={row.source}
                      className="border-b border-[#2a3f5f]/60 last:border-0"
                    >
                      <td className="py-3 pr-4 font-medium text-white">
                        {row.source}
                      </td>
                      <td className="py-3 pr-4 tabular-nums">{row.totalCalls}</td>
                      <td className="py-3 pr-4 tabular-nums">{row.intakes}</td>
                      <td className="py-3 pr-4 tabular-nums">
                        {row.mattersOpened}
                      </td>
                      <td className="py-3 pr-4 tabular-nums font-medium text-white">
                        {fmtUsd(row.totalSettlementValue)}
                      </td>
                      <td className="py-3 pr-4 tabular-nums">
                        {row.conversionRate.toFixed(1)}%
                      </td>
                      <td className="py-3 tabular-nums">
                        {fmtUsd(row.avgSettlement)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section
          className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm"
          style={{ backgroundColor: "#1a2540" }}
        >
          <h2 className="mb-4 text-lg font-semibold text-white">
            Settlement value by source
          </h2>
          <RechartsPie data={pieData} />
        </section>
      </main>
    </div>
  );
}
