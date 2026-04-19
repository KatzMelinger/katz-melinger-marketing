import type { Metadata } from "next";
import { headers } from "next/headers";

import { MarketingNav } from "@/components/marketing-nav";
import { RechartsPie } from "@/components/recharts-pie";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Attribution | Katz Melinger Marketing",
};

type CallSummary = {
  totalCalls?: number;
  callsBySource?: { name: string; value: number }[];
};

type FunnelRow = {
  source: string;
  intakes: number;
  matters: number;
  settlements: number;
  revenue: number;
  spend: number;
};

function fmtUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
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

export default async function AttributionPage() {
  const base = await getRequestOrigin();
  const [sumRes, funnelRes] = await Promise.all([
    fetch(`${base}/api/callrail/summary`, { cache: "no-store" }),
    fetch(`${base}/api/cms/funnel-by-source`, { cache: "no-store" }),
  ]);

  const summary = sumRes.ok ? ((await sumRes.json()) as CallSummary) : {};
  const funnelJson = funnelRes.ok
    ? ((await funnelRes.json()) as { rows?: unknown })
    : {};
  const funnelRows: FunnelRow[] = Array.isArray(funnelJson.rows)
    ? (funnelJson.rows as FunnelRow[]).filter(
        (row) =>
          row &&
          typeof row.source === "string" &&
          typeof row.intakes === "number" &&
          typeof row.matters === "number" &&
          typeof row.settlements === "number" &&
          typeof row.revenue === "number" &&
          typeof row.spend === "number",
      )
    : [];

  const callsBySource = summary.callsBySource ?? [];
  const callMap = new Map(callsBySource.map((row) => [row.name, row.value] as const));
  const keys = new Set<string>();
  for (const row of callsBySource) keys.add(row.name);
  for (const row of funnelRows) keys.add(row.source);

  const combinedRows = [...keys]
    .map((source) => {
      const funnel = funnelRows.find((row) => row.source === source);
      const calls = callMap.get(source) ?? 0;
      const intakes = funnel?.intakes ?? 0;
      const matters = funnel?.matters ?? 0;
      const settlements = funnel?.settlements ?? 0;
      const revenue = funnel?.revenue ?? 0;
      const spend = funnel?.spend ?? 0;
      const roiPct = spend > 0 ? ((revenue - spend) / spend) * 100 : 0;
      const cpa = intakes > 0 ? spend / intakes : 0;
      const ltv = settlements > 0 ? revenue / settlements : 0;
      const spendEfficiency = spend > 0 ? revenue / spend : 0;
      return {
        source,
        calls,
        intakes,
        matters,
        settlements,
        revenue,
        spend,
        roiPct,
        cpa,
        ltv,
        spendEfficiency,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.calls - a.calls);

  const totals = combinedRows.reduce(
    (acc, row) => ({
      calls: acc.calls + row.calls,
      intakes: acc.intakes + row.intakes,
      matters: acc.matters + row.matters,
      settlements: acc.settlements + row.settlements,
      revenue: acc.revenue + row.revenue,
      spend: acc.spend + row.spend,
    }),
    { calls: 0, intakes: 0, matters: 0, settlements: 0, revenue: 0, spend: 0 },
  );

  const globalRoiPct =
    totals.spend > 0 ? ((totals.revenue - totals.spend) / totals.spend) * 100 : 0;
  const globalCpa = totals.intakes > 0 ? totals.spend / totals.intakes : 0;
  const globalLtv = totals.settlements > 0 ? totals.revenue / totals.settlements : 0;
  const globalEfficiency = totals.spend > 0 ? totals.revenue / totals.spend : 0;

  const revenuePie = combinedRows
    .filter((row) => row.revenue > 0)
    .map((row) => ({ name: row.source, value: row.revenue }));
  const spendPie = combinedRows
    .filter((row) => row.spend > 0)
    .map((row) => ({ name: row.source, value: row.spend }));

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
            Complete funnel: CallRail calls to CMS intakes, matters, settlements,
            and channel economics.
          </p>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Total calls", value: String(totals.calls), bg: "#185FA5" },
            { label: "Total intakes", value: String(totals.intakes), bg: "#166534" },
            { label: "Total settlements", value: String(totals.settlements), bg: "#b45309" },
            { label: "Settlement revenue", value: fmtUsd(totals.revenue), bg: "#475569" },
          ].map((card) => (
            <article
              key={card.label}
              className="rounded-xl border border-white/5 p-5 shadow-sm"
              style={{ backgroundColor: card.bg }}
            >
              <p className="text-sm font-medium text-white/90">{card.label}</p>
              <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">
                {card.value}
              </p>
            </article>
          ))}
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "ROI (all channels)", value: fmtPct(globalRoiPct), bg: "#1a2540" },
            { label: "CPA", value: fmtUsd(globalCpa), bg: "#1a2540" },
            { label: "Lifetime value", value: fmtUsd(globalLtv), bg: "#1a2540" },
            {
              label: "Spend efficiency",
              value: `${globalEfficiency.toFixed(2)}x`,
              bg: "#1a2540",
            },
          ].map((metric) => (
            <article
              key={metric.label}
              className="rounded-xl border border-[#2a3f5f] p-5 shadow-sm"
              style={{ backgroundColor: metric.bg }}
            >
              <p className="text-sm font-medium text-slate-300">{metric.label}</p>
              <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight text-white">
                {metric.value}
              </p>
            </article>
          ))}
        </section>

        <section
          className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm"
          style={{ backgroundColor: "#1a2540" }}
        >
          <h2 className="mb-4 text-lg font-semibold text-white">
            Source funnel and economics
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#2a3f5f] text-slate-400">
                  <th className="pb-3 pr-4 font-medium">Source</th>
                  <th className="pb-3 pr-4 font-medium">Calls</th>
                  <th className="pb-3 pr-4 font-medium">Intakes</th>
                  <th className="pb-3 pr-4 font-medium">Matters</th>
                  <th className="pb-3 pr-4 font-medium">Settlements</th>
                  <th className="pb-3 pr-4 font-medium">Revenue</th>
                  <th className="pb-3 pr-4 font-medium">Spend</th>
                  <th className="pb-3 pr-4 font-medium">ROI</th>
                  <th className="pb-3 pr-4 font-medium">CPA</th>
                  <th className="pb-3 pr-4 font-medium">LTV</th>
                  <th className="pb-3 font-medium">Spend efficiency</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {combinedRows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-8 text-center text-slate-400">
                      No funnel rows. Confirm CallRail and CMS endpoints.
                    </td>
                  </tr>
                ) : (
                  combinedRows.map((row) => (
                    <tr
                      key={row.source}
                      className="border-b border-[#2a3f5f]/60 last:border-0"
                    >
                      <td className="py-3 pr-4 font-medium text-white">{row.source}</td>
                      <td className="py-3 pr-4 tabular-nums">{row.calls}</td>
                      <td className="py-3 pr-4 tabular-nums">{row.intakes}</td>
                      <td className="py-3 pr-4 tabular-nums">{row.matters}</td>
                      <td className="py-3 pr-4 tabular-nums">{row.settlements}</td>
                      <td className="py-3 pr-4 tabular-nums font-medium text-white">
                        {fmtUsd(row.revenue)}
                      </td>
                      <td className="py-3 pr-4 tabular-nums">{fmtUsd(row.spend)}</td>
                      <td className="py-3 pr-4 tabular-nums">{fmtPct(row.roiPct)}</td>
                      <td className="py-3 pr-4 tabular-nums">{fmtUsd(row.cpa)}</td>
                      <td className="py-3 pr-4 tabular-nums">{fmtUsd(row.ltv)}</td>
                      <td className="py-3 tabular-nums">
                        {row.spendEfficiency.toFixed(2)}x
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section
            className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm"
            style={{ backgroundColor: "#1a2540" }}
          >
            <h2 className="mb-4 text-lg font-semibold text-white">
              Revenue by marketing channel
            </h2>
            <RechartsPie data={revenuePie} />
          </section>
          <section
            className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm"
            style={{ backgroundColor: "#1a2540" }}
          >
            <h2 className="mb-4 text-lg font-semibold text-white">
              Marketing spend by channel
            </h2>
            <RechartsPie data={spendPie} />
          </section>
        </div>
      </main>
    </div>
  );
}
