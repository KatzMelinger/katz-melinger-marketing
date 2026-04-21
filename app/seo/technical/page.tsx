import type { Metadata } from "next";

import { SeoShell } from "@/components/seo-shell";
import { getRequestOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Technical SEO | Katz Melinger PLLC",
  description: "Core Web Vitals, mobile usability, schema checks, and crawl issue monitoring.",
};

type TechnicalResponse = {
  url?: string;
  mobile?: Array<{ name: string; score: number; status: string; detail: string }>;
  desktop?: Array<{ name: string; score: number; status: string; detail: string }>;
  schemaChecks?: Array<{ name: string; score: number; status: string; detail: string }>;
  crawlErrors?: Array<{ url: string; issue: string; severity: "warning" | "critical" }>;
};

function statusClass(status: string): string {
  if (status === "healthy") return "text-emerald-300";
  if (status === "warning") return "text-amber-300";
  return "text-rose-300";
}

export default async function SeoTechnicalPage() {
  const base = await getRequestOrigin();
  const res = await fetch(`${base}/api/seo/technical`, { cache: "no-store" });
  const data = (await res.json()) as TechnicalResponse;

  return (
    <SeoShell
      title="Technical SEO Monitoring"
      subtitle="Performance and crawl health tracking with Core Web Vitals and schema validation checks."
    >
      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-5">
          <h2 className="text-lg font-semibold text-white">Mobile performance</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {(data.mobile ?? []).map((metric) => (
              <li key={metric.name} className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2">
                <p className="font-medium text-white">{metric.name}</p>
                <p className={`text-xs ${statusClass(metric.status)}`}>{metric.status} · score {metric.score}</p>
                <p className="text-xs text-slate-400">{metric.detail}</p>
              </li>
            ))}
          </ul>
        </article>
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-5">
          <h2 className="text-lg font-semibold text-white">Desktop performance</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {(data.desktop ?? []).map((metric) => (
              <li key={metric.name} className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2">
                <p className="font-medium text-white">{metric.name}</p>
                <p className={`text-xs ${statusClass(metric.status)}`}>{metric.status} · score {metric.score}</p>
                <p className="text-xs text-slate-400">{metric.detail}</p>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-5">
          <h2 className="text-lg font-semibold text-white">Schema markup validation</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {(data.schemaChecks ?? []).map((metric) => (
              <li key={metric.name} className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2">
                <p className="font-medium text-white">{metric.name}</p>
                <p className={`text-xs ${statusClass(metric.status)}`}>{metric.status} · score {metric.score}</p>
                <p className="text-xs text-slate-400">{metric.detail}</p>
              </li>
            ))}
          </ul>
        </article>
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-5">
          <h2 className="text-lg font-semibold text-white">Crawl error report</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {(data.crawlErrors ?? []).map((error) => (
              <li key={`${error.url}-${error.issue}`} className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2">
                <p className="font-medium text-white">{error.url}</p>
                <p className={`text-xs ${statusClass(error.severity)}`}>{error.severity}</p>
                <p className="text-xs text-slate-400">{error.issue}</p>
              </li>
            ))}
          </ul>
        </article>
      </section>
    </SeoShell>
  );
}

