import Link from "next/link";
import { headers } from "next/headers";
import { RechartsPie } from "@/components/recharts-pie";

export const dynamic = "force-dynamic";

type BreakdownRow = {
  area_of_law: string;
  total_settlement_value: number;
  settlement_count: number;
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

async function fetchAttribution(): Promise<BreakdownRow[]> {
  try {
    const base = await getRequestOrigin();
    const path = encodeURIComponent("/api/v1/revenue/attribution");
    const res = await fetch(`${base}/api/cms?path=${path}`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const j: unknown = await res.json();
    if (!j || typeof j !== "object" || !Array.isArray((j as { breakdown?: unknown }).breakdown)) {
      return [];
    }
    const arr = (j as { breakdown: unknown[] }).breakdown;
    return arr
      .filter(
        (x): x is BreakdownRow =>
          x != null &&
          typeof x === "object" &&
          typeof (x as { area_of_law?: unknown }).area_of_law === "string" &&
          typeof (x as { total_settlement_value?: unknown }).total_settlement_value ===
            "number" &&
          typeof (x as { settlement_count?: unknown }).settlement_count ===
            "number",
      )
      .map((x) => ({
        area_of_law: (x as BreakdownRow).area_of_law,
        total_settlement_value: (x as BreakdownRow).total_settlement_value,
        settlement_count: (x as BreakdownRow).settlement_count,
      }));
  } catch {
    return [];
  }
}

function fmtUsd(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export default async function AttributionPage() {
  const breakdown = await fetchAttribution();
  const totalRev = breakdown.reduce((s, r) => s + r.total_settlement_value, 0);
  const rows = breakdown.map((r) => {
    const avg =
      r.settlement_count > 0
        ? r.total_settlement_value / r.settlement_count
        : 0;
    const pct = totalRev > 0 ? (r.total_settlement_value / totalRev) * 100 : 0;
    return { ...r, avg, pct };
  });

  const pieData = rows
    .filter((r) => r.total_settlement_value > 0)
    .map((r) => ({ name: r.area_of_law, value: r.total_settlement_value }));

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
            <Link
              href="/"
              className="rounded-md px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-[#1a2540] hover:text-white"
            >
              Dashboard
            </Link>
            <Link
              href="/calls"
              className="rounded-md px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-[#1a2540] hover:text-white"
            >
              Calls
            </Link>
            <Link
              href="/seo"
              className="rounded-md px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-[#1a2540] hover:text-white"
            >
              SEO
            </Link>
            <Link
              href="/reviews"
              className="rounded-md px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-[#1a2540] hover:text-white"
            >
              Reviews
            </Link>
            <Link
              href="/attribution"
              className="rounded-md bg-[#1a2540] px-3 py-2 text-sm text-white"
            >
              Attribution
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">Revenue attribution</h1>
          <p className="mt-1 text-sm text-slate-400">
            Settlement value by practice area from the CMS API (
            <code className="text-slate-300">/api/v1/revenue/attribution</code>).
          </p>
        </div>

        {breakdown.length === 0 ? (
          <div
            className="rounded-xl border border-amber-900/40 p-4 text-sm text-amber-100"
            style={{ backgroundColor: "#1a2540" }}
          >
            No attribution data returned. Set <code className="text-white">CMS_API_URL</code> and{" "}
            <code className="text-white">CMS_API_SECRET_KEY</code> (or{" "}
            <code className="text-white">API_SECRET_KEY</code>) on this app to match the CMS.
          </div>
        ) : null}

        <section
          className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm"
          style={{ backgroundColor: "#1a2540" }}
        >
          <h2 className="mb-4 text-lg font-semibold text-white">
            Settlement value by practice area
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#2a3f5f] text-slate-400">
                  <th className="pb-3 pr-4 font-medium">Area of law</th>
                  <th className="pb-3 pr-4 font-medium">Total matters</th>
                  <th className="pb-3 pr-4 font-medium">Total settlement value</th>
                  <th className="pb-3 pr-4 font-medium">Average settlement</th>
                  <th className="pb-3 font-medium">% of total revenue</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {rows.map((r) => (
                  <tr
                    key={r.area_of_law}
                    className="border-b border-[#2a3f5f]/60 last:border-0"
                  >
                    <td className="py-3 pr-4 font-medium text-white">
                      {r.area_of_law}
                    </td>
                    <td className="py-3 pr-4 tabular-nums">{r.settlement_count}</td>
                    <td className="py-3 pr-4 tabular-nums font-medium text-white">
                      {fmtUsd(r.total_settlement_value)}
                    </td>
                    <td className="py-3 pr-4 tabular-nums">{fmtUsd(r.avg)}</td>
                    <td className="py-3 tabular-nums">{r.pct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section
          className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm"
          style={{ backgroundColor: "#1a2540" }}
        >
          <h2 className="mb-4 text-lg font-semibold text-white">Practice area mix</h2>
          <RechartsPie data={pieData} />
        </section>
      </main>
    </div>
  );
}
