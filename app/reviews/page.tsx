import Link from "next/link";
import { headers } from "next/headers";

import { MarketingNav } from "@/components/marketing-nav";
import { RechartsPie } from "@/components/recharts-pie";

export const dynamic = "force-dynamic";

type ReviewRow = {
  id: string;
  platform?: string;
  reviewer_name?: string;
  rating?: number;
  review_date?: string;
  status?: string;
  review_text?: string;
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

export default async function MarketingReviewsPage() {
  const base = await getRequestOrigin();
  let rows: ReviewRow[] = [];
  let errorMessage: string | null = null;
  try {
    const res = await fetch(`${base}/api/reviews`, { cache: "no-store" });
    const json = (await res.json()) as {
      reviews?: unknown;
      error?: string;
    };
    rows = Array.isArray(json.reviews) ? (json.reviews as ReviewRow[]) : [];
    errorMessage = json.error ?? null;
  } catch {
    rows = [];
    errorMessage = "Network error while loading reviews.";
  }

  const total = rows.length;
  const avg =
    total > 0
      ? rows.reduce(
          (s, r) => s + (Number((r as { rating?: number }).rating) || 0),
          0,
        ) / total
      : 0;
  const responded = rows.filter((r) =>
    String((r as { status?: string }).status ?? "")
      .toLowerCase()
      .includes("responded"),
  ).length;
  const responseRate = total ? Math.round((responded / total) * 100) : 0;

  const byPlatform = new Map<string, number>();
  const byRating = new Map<number, number>();
  for (const r of rows) {
    const p =
      String((r as { platform?: string }).platform ?? "Other").trim() ||
      "Other";
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
      <MarketingNav />

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">Reviews overview</h1>
          <p className="mt-1 text-sm text-slate-400">
            Reputation snapshot from Supabase <code className="text-slate-300">reviews</code>{" "}
            (via secure server API route).
          </p>
        </div>

        {errorMessage ? (
          <div className="rounded-xl border border-rose-900/50 bg-rose-950/40 p-4 text-sm text-rose-200">
            Could not load reviews: {errorMessage}
          </div>
        ) : null}

        <section className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm" style={{ backgroundColor: "#1a2540" }}>
          <h2 className="text-lg font-semibold text-white">Reputation snapshot</h2>
          <p className="mt-1 text-sm text-slate-400">
            Aggregate metrics across all platforms in the table.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <article
              className="rounded-lg border border-white/10 p-5"
              style={{ backgroundColor: "#185FA5" }}
            >
              <p className="text-sm font-medium text-white/90">Average rating</p>
              <p className="mt-3 text-3xl font-semibold tabular-nums text-white">
                {total ? avg.toFixed(2) : "—"}
              </p>
            </article>
            <article
              className="rounded-lg border border-white/10 p-5"
              style={{ backgroundColor: "#166534" }}
            >
              <p className="text-sm font-medium text-white/90">Total reviews</p>
              <p className="mt-3 text-3xl font-semibold tabular-nums text-white">
                {total}
              </p>
            </article>
            <article
              className="rounded-lg border border-white/10 p-5"
              style={{ backgroundColor: "#475569" }}
            >
              <p className="text-sm font-medium text-white/90">Response rate</p>
              <p className="mt-3 text-3xl font-semibold tabular-nums text-white">
                {total ? `${responseRate}%` : "—"}
              </p>
              <p className="mt-1 text-xs text-white/70">
                Rows with status containing &quot;responded&quot;
              </p>
            </article>
          </div>

          {!errorMessage && total === 0 ? (
            <div className="mt-8 rounded-lg border border-dashed border-white/15 bg-[#0f1729]/60 p-8 text-center">
              <p className="text-sm text-slate-300">
                No reviews yet. Add rows to the <code className="text-slate-200">reviews</code> table
                in Supabase or sync from your CMS.
              </p>
              <Link
                href="/reviews#log-review"
                className="mt-4 inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: "#185FA5" }}
              >
                Log your first review
              </Link>
              <p id="log-review" className="mt-6 scroll-mt-24 text-xs text-slate-500">
                Tip: include <code className="text-slate-400">platform</code>,{" "}
                <code className="text-slate-400">rating</code>,{" "}
                <code className="text-slate-400">status</code>, and{" "}
                <code className="text-slate-400">review_date</code> for best results.
              </p>
            </div>
          ) : null}
        </section>

        {total > 0 ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <section
              className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm"
              style={{ backgroundColor: "#1a2540" }}
            >
              <h2 className="mb-4 text-lg font-semibold text-white">
                Platform breakdown
              </h2>
              <RechartsPie data={platformChart} valueMode="number" />
            </section>
            <section
              className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm"
              style={{ backgroundColor: "#1a2540" }}
            >
              <h2 className="mb-4 text-lg font-semibold text-white">
                Rating distribution
              </h2>
              <RechartsPie data={ratingChart} valueMode="number" />
            </section>
          </div>
        ) : null}

        {total > 0 ? (
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
                    const row = r;
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
        ) : null}
      </main>
    </div>
  );
}
