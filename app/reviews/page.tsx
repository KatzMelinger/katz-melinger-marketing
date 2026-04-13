import Link from "next/link";
import { supabaseServer } from "@/lib/supabase-server";
import { RechartsPie } from "@/components/recharts-pie";

export const dynamic = "force-dynamic";

function fmtUsd(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export default async function MarketingReviewsPage() {
  const { data, error } = await supabaseServer
    .from("reviews")
    .select("*")
    .order("review_date", { ascending: false, nullsFirst: false })
    .limit(500);

  const rows = data ?? [];
  const total = rows.length;
  const avg =
    total > 0
      ? rows.reduce((s, r) => s + (Number((r as { rating?: number }).rating) || 0), 0) /
        total
      : 0;
  const responded = rows.filter(
    (r) =>
      String((r as { status?: string }).status ?? "")
        .toLowerCase()
        .includes("responded"),
  ).length;
  const responseRate = total ? Math.round((responded / total) * 100) : 0;

  const byPlatform = new Map<string, number>();
  const byRating = new Map<number, number>();
  for (const r of rows) {
    const p = String((r as { platform?: string }).platform ?? "Other").trim() || "Other";
    byPlatform.set(p, (byPlatform.get(p) ?? 0) + 1);
    const rt = Math.round(Number((r as { rating?: number }).rating) || 0);
    const key = Math.min(5, Math.max(1, rt));
    byRating.set(key, (byRating.get(key) ?? 0) + 1);
  }

  const platformChart = [...byPlatform.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  const ratingChart = [1, 2, 3, 4, 5].map((n) => ({
    name: `${n}★`,
    value: byRating.get(n) ?? 0,
  }));

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
              className="rounded-md bg-[#1a2540] px-3 py-2 text-sm text-white"
            >
              Reviews
            </Link>
            <Link
              href="/attribution"
              className="rounded-md px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-[#1a2540] hover:text-white"
            >
              Attribution
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">Reviews overview</h1>
          <p className="mt-1 text-sm text-slate-400">
            Shared reputation data from the CMS Supabase `reviews` table.
          </p>
        </div>

        {error ? (
          <div className="rounded-xl border border-rose-900/50 bg-rose-950/40 p-4 text-sm text-rose-200">
            Could not load reviews: {error.message}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Total reviews", value: String(total) },
            { label: "Average rating", value: total ? avg.toFixed(2) : "—" },
            { label: "Response rate", value: `${responseRate}%` },
            {
              label: "Google subset avg",
              value: (() => {
                const g = rows.filter((r) =>
                  String((r as { platform?: string }).platform ?? "")
                    .toLowerCase()
                    .includes("google"),
                );
                if (!g.length) return "—";
                const a =
                  g.reduce((s, r) => s + (Number((r as { rating?: number }).rating) || 0), 0) /
                  g.length;
                return a.toFixed(2);
              })(),
            },
          ].map((c) => (
            <article
              key={c.label}
              className="rounded-xl border border-[#2a3f5f] p-5 shadow-sm"
              style={{ backgroundColor: "#1a2540" }}
            >
              <p className="text-sm font-medium text-slate-400">{c.label}</p>
              <p className="mt-3 text-3xl font-semibold tabular-nums text-white">
                {c.value}
              </p>
            </article>
          ))}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section
            className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm"
            style={{ backgroundColor: "#1a2540" }}
          >
            <h2 className="mb-4 text-lg font-semibold text-white">
              Platform breakdown
            </h2>
            <RechartsPie data={platformChart} />
          </section>
          <section
            className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm"
            style={{ backgroundColor: "#1a2540" }}
          >
            <h2 className="mb-4 text-lg font-semibold text-white">
              Rating distribution
            </h2>
            <RechartsPie data={ratingChart} />
          </section>
        </div>

        <section
          className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm"
          style={{ backgroundColor: "#1a2540" }}
        >
          <h2 className="mb-4 text-lg font-semibold text-white">Recent reviews</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm text-slate-200">
              <thead>
                <tr className="border-b border-[#2a3f5f] text-slate-400">
                  <th className="pb-3 pr-4 font-medium">Platform</th>
                  <th className="pb-3 pr-4 font-medium">Reviewer</th>
                  <th className="pb-3 pr-4 font-medium">Rating</th>
                  <th className="pb-3 pr-4 font-medium">Date</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 font-medium">Excerpt</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 25).map((r) => {
                  const row = r as {
                    id: string;
                    platform?: string;
                    reviewer_name?: string;
                    rating?: number;
                    review_date?: string;
                    status?: string;
                    review_text?: string;
                  };
                  const excerpt = (row.review_text ?? "").slice(0, 120);
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-[#2a3f5f]/60 last:border-0"
                    >
                      <td className="py-3 pr-4 font-medium text-white">
                        {row.platform ?? "—"}
                      </td>
                      <td className="py-3 pr-4">{row.reviewer_name ?? "—"}</td>
                      <td className="py-3 pr-4 tabular-nums">{row.rating ?? "—"}</td>
                      <td className="py-3 pr-4 text-slate-400">
                        {row.review_date ?? "—"}
                      </td>
                      <td className="py-3 pr-4">{row.status ?? "—"}</td>
                      <td className="py-3 text-slate-300">
                        {excerpt}
                        {(row.review_text ?? "").length > 120 ? "…" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
