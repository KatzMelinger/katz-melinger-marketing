import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";

import { MarketingNav } from "@/components/marketing-nav";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SEO | Katz Melinger PLLC",
  description:
    "Organic search performance for katzmelinger.com via Semrush (US).",
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

function formatTraffic(n: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(n);
}

const SEMRUSH_SETUP =
  "Add SEMRUSH_API_KEY to your environment (for example .env.local in development or your host’s env vars in production), then restart the dev server or redeploy.";

function positionBadgeClass(position: number): string {
  if (position >= 1 && position <= 3) {
    return "bg-emerald-500/20 text-emerald-300 ring-emerald-500/35";
  }
  if (position >= 4 && position <= 10) {
    return "bg-sky-500/20 text-sky-300 ring-sky-500/35";
  }
  return "bg-slate-500/25 text-slate-300 ring-slate-500/35";
}

async function SeoDashboardContent({
  semrushConfigured,
}: {
  semrushConfigured: boolean;
}) {
  if (!semrushConfigured) {
    const checkedAt = new Date();
    return (
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            SEO overview
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            katzmelinger.com · Semrush · US database
          </p>
        </div>
        <div
          className="rounded-xl border border-amber-800/50 p-6 text-sm text-amber-100"
          style={{ backgroundColor: "#1a2540" }}
        >
          <p className="text-lg font-semibold text-white">Semrush not configured</p>
          <p className="mt-2 text-slate-300">{SEMRUSH_SETUP}</p>
        </div>
        <p className="text-xs text-slate-500">
          Last checked:{" "}
          {checkedAt.toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
      </main>
    );
  }

  const base = await getRequestOrigin();

  let overview = {
    authorityScore: 0,
    organicKeywords: 0,
    organicTraffic: 0,
    backlinks: 0,
  };
  let backlinks = {
    authorityScore: 0,
    totalBacklinks: 0,
    referringDomains: 0,
  };
  let keywords: Array<{
    keyword: string;
    position: number;
    searchVolume: number;
    url: string;
  }> = [];
  let competitors: Array<{ domain: string; commonKeywords: number }> = [];

  try {
    const [ovRes, blRes, kwRes, compRes] = await Promise.all([
      fetch(`${base}/api/semrush/overview`, { cache: "no-store" }),
      fetch(`${base}/api/semrush/backlinks`, { cache: "no-store" }),
      fetch(`${base}/api/semrush/keywords`, { cache: "no-store" }),
      fetch(`${base}/api/semrush/competitors`, { cache: "no-store" }),
    ]);

    if (ovRes.ok) {
      const j = (await ovRes.json()) as {
        authorityScore?: number;
        organicKeywords?: number;
        organicTraffic?: number;
        backlinks?: number;
      };
      overview = {
        authorityScore: j.authorityScore ?? 0,
        organicKeywords: j.organicKeywords ?? 0,
        organicTraffic: j.organicTraffic ?? 0,
        backlinks: j.backlinks ?? 0,
      };
    }

    if (blRes.ok) {
      const j = (await blRes.json()) as {
        authorityScore?: number;
        totalBacklinks?: number;
        referringDomains?: number;
      };
      backlinks = {
        authorityScore: j.authorityScore ?? 0,
        totalBacklinks: j.totalBacklinks ?? 0,
        referringDomains: j.referringDomains ?? 0,
      };
    }

    if (kwRes.ok) {
      const j = (await kwRes.json()) as {
        keywords?: typeof keywords;
      };
      keywords = Array.isArray(j.keywords) ? j.keywords : [];
    }

    if (compRes.ok) {
      const j = (await compRes.json()) as {
        competitors?: typeof competitors;
      };
      competitors = Array.isArray(j.competitors) ? j.competitors : [];
    }
  } catch {
    /* empty aggregates */
  }

  const dataFetchedAt = new Date();

  return (
    <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            SEO overview
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            katzmelinger.com · Semrush · US database
          </p>
        </div>
        <p className="text-xs text-slate-500 sm:text-right">
          Last updated:{" "}
          {dataFetchedAt.toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <article
          className="rounded-xl border border-white/5 p-5 shadow-sm"
          style={{ backgroundColor: "#185FA5" }}
        >
          <p className="text-sm font-medium text-white/90">Authority Score</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">
            {overview.authorityScore}
          </p>
        </article>
        <article
          className="rounded-xl border border-white/5 p-5 shadow-sm"
          style={{ backgroundColor: "#166534" }}
        >
          <p className="text-sm font-medium text-white/90">Organic keywords</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">
            {formatTraffic(overview.organicKeywords)}
          </p>
        </article>
        <article
          className="rounded-xl border border-white/5 p-5 shadow-sm"
          style={{ backgroundColor: "#b45309" }}
        >
          <p className="text-sm font-medium text-white/90">Monthly traffic</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">
            {formatTraffic(overview.organicTraffic)}
          </p>
        </article>
        <article
          className="rounded-xl border border-white/5 p-5 shadow-sm"
          style={{ backgroundColor: "#475569" }}
        >
          <p className="text-sm font-medium text-white/90">Backlinks</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">
            {formatTraffic(overview.backlinks)}
          </p>
        </article>
      </section>

      <section
        className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm"
        style={{ backgroundColor: "#1a2540" }}
      >
        <h2 className="mb-4 text-lg font-semibold text-white">
          Top organic keywords
        </h2>
        {keywords.length === 0 ? (
          <p className="text-sm text-slate-400">No keyword data available.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#2a3f5f] text-slate-400">
                  <th className="pb-3 pr-4 font-medium">Keyword</th>
                  <th className="pb-3 pr-4 font-medium">Position</th>
                  <th className="pb-3 pr-4 font-medium">Volume</th>
                  <th className="pb-3 font-medium">URL</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {keywords.map((k, i) => (
                  <tr
                    key={`${k.keyword}-${i}`}
                    className="border-b border-[#2a3f5f]/60 last:border-0"
                  >
                    <td className="py-3 pr-4 font-medium text-white">
                      {k.keyword || "—"}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${positionBadgeClass(k.position)}`}
                      >
                        {k.position > 0 ? k.position : "—"}
                      </span>
                    </td>
                    <td className="py-3 pr-4 tabular-nums">
                      {formatTraffic(k.searchVolume)}
                    </td>
                    <td className="max-w-xs py-3">
                      {k.url ? (
                        <a
                          href={k.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block truncate text-sky-400 underline decoration-sky-500/40 underline-offset-2 hover:text-sky-300"
                        >
                          {k.url}
                        </a>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm"
        style={{ backgroundColor: "#1a2540" }}
      >
        <h2 className="mb-3 text-lg font-semibold text-white">
          Backlinks summary
        </h2>
        <p className="mb-4 text-sm text-slate-400">
          Backlink Analytics overview for the root domain.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div
            className="rounded-lg border border-white/10 p-4"
            style={{ backgroundColor: "rgba(15, 23, 41, 0.45)" }}
          >
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Total backlinks
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
              {formatTraffic(backlinks.totalBacklinks)}
            </p>
          </div>
          <div
            className="rounded-lg border border-white/10 p-4"
            style={{ backgroundColor: "rgba(15, 23, 41, 0.45)" }}
          >
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Referring domains
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
              {formatTraffic(backlinks.referringDomains)}
            </p>
          </div>
        </div>
      </section>

      <section
        className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm"
        style={{ backgroundColor: "#1a2540" }}
      >
        <h2 className="mb-4 text-lg font-semibold text-white">
          Organic competitors
        </h2>
        {competitors.length === 0 ? (
          <p className="text-sm text-slate-400">No competitor data available.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#2a3f5f] text-slate-400">
                  <th className="pb-3 pr-4 font-medium">Domain</th>
                  <th className="pb-3 font-medium">Common keywords</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {competitors.map((c) => (
                  <tr
                    key={c.domain}
                    className="border-b border-[#2a3f5f]/60 last:border-0"
                  >
                    <td className="py-3 pr-4 font-medium text-white">
                      {c.domain || "—"}
                    </td>
                    <td className="py-3 tabular-nums">
                      {formatTraffic(c.commonKeywords)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function SeoSkeleton() {
  return (
    <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="h-8 w-56 animate-pulse rounded bg-white/10" />
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-xl bg-white/5"
            style={{ backgroundColor: "#1a2540" }}
          />
        ))}
      </section>
      <div
        className="h-64 animate-pulse rounded-xl bg-white/5"
        style={{ backgroundColor: "#1a2540" }}
      />
    </main>
  );
}

export default async function SeoPage() {
  const semrushConfigured = Boolean(process.env.SEMRUSH_API_KEY?.trim());

  return (
    <div
      className="min-h-full text-white"
      style={{
        backgroundColor: "#0f1729",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <MarketingNav />

      <Suspense fallback={<SeoSkeleton />}>
        <SeoDashboardContent semrushConfigured={semrushConfigured} />
      </Suspense>
    </div>
  );
}
