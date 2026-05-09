import type { Metadata } from "next";

import { formatNumber, SeoShell } from "@/components/seo-shell";
import { getRequestOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SEO Backlinks | Katz Melinger PLLC",
  description: "Backlink profile monitoring, toxic links, and link-building opportunities.",
};

type BacklinkResponse = {
  overview?: {
    authorityScore: number;
    totalBacklinks: number;
    referringDomains: number;
    followRatio: number;
  };
  domains?: Array<{
    domain: string;
    backlinks: number;
    authorityScore: number;
    toxicityRisk: "low" | "medium" | "high";
    followRatio: number;
  }>;
  newBacklinksLast30d?: number;
  lostBacklinksLast30d?: number;
  disavowFile?: string;
  linkBuildingOpportunities?: Array<{ domain: string; reason: string }>;
};

export default async function SeoBacklinksPage() {
  const base = await getRequestOrigin();
  const res = await fetch(`${base}/api/seo/backlinks`, { cache: "no-store" });
  const data = (await res.json()) as BacklinkResponse;

  return (
    <SeoShell
      title="Backlink Intelligence"
      subtitle="Monitor backlink profile quality, detect toxic domains, and identify competitor-informed link opportunities."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Authority score</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.overview?.authorityScore ?? 0)}</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Backlinks</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.overview?.totalBacklinks ?? 0)}</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Referring domains</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.overview?.referringDomains ?? 0)}</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">New backlinks (30d)</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.newBacklinksLast30d ?? 0)}</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Lost backlinks (30d)</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.lostBacklinksLast30d ?? 0)}</p>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
          <h2 className="text-lg font-semibold text-slate-900">Link quality scoring</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="border-b border-[#e2e8f0] text-slate-500">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Domain</th>
                  <th className="pb-2 pr-3 font-medium">Backlinks</th>
                  <th className="pb-2 pr-3 font-medium">Authority</th>
                  <th className="pb-2 pr-3 font-medium">Follow %</th>
                  <th className="pb-2 font-medium">Toxicity</th>
                </tr>
              </thead>
              <tbody>
                {(data.domains ?? []).slice(0, 20).map((item) => (
                  <tr key={item.domain} className="border-b border-[#e2e8f0]/60 last:border-0">
                    <td className="py-2 pr-3 text-slate-900">{item.domain}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatNumber(item.backlinks)}</td>
                    <td className="py-2 pr-3 tabular-nums">{item.authorityScore}</td>
                    <td className="py-2 pr-3 tabular-nums">{item.followRatio}</td>
                    <td className="py-2 text-slate-600">{item.toxicityRisk}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
          <h2 className="text-lg font-semibold text-slate-900">Link building opportunities</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {(data.linkBuildingOpportunities ?? []).map((item) => (
              <li key={item.domain} className="rounded-md border border-[#e2e8f0] bg-[#ffffff] px-3 py-2">
                <p className="font-medium text-slate-900">{item.domain}</p>
                <p className="text-xs text-slate-500">{item.reason}</p>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
        <h2 className="text-lg font-semibold text-slate-900">Disavow manager</h2>
        <p className="mt-1 text-sm text-slate-500">
          Review and export toxic domain candidates for disavow submission.
        </p>
        <textarea
          readOnly
          value={data.disavowFile ?? ""}
          className="mt-3 h-44 w-full rounded-md border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-xs text-slate-700"
        />
      </section>
    </SeoShell>
  );
}

