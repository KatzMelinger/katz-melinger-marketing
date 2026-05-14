/**
 * AI Ops Hub — visibility in AI answer engines.
 *
 * Aggregates AEO (Answer Engine Optimization), AI search rankings,
 * the /llms.txt protocol, prompt management, and AI-attributed traffic
 * into a single landing page. Sub-area cards link out to the existing
 * detail pages — this is a router, not a dashboard.
 */

import type { Metadata } from "next";

import { HubShell, type HubCard, type HubKpi } from "@/components/hub-shell";
import { getRequestOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AI Ops Hub | Katz Melinger PLLC",
  description:
    "Answer Engine Optimization, AI search visibility, llms.txt, and prompt operations.",
};

async function fetchJsonSafe<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type AeoDashboardPayload = {
  score?: number;
  averageScore?: number;
  totalRuns?: number;
  citationRate?: number;
  presenceRate?: number;
};

type PromptsPayload = {
  prompts?: unknown[];
  items?: unknown[];
};

type LlmsTxtVersions = {
  versions?: Array<{ id?: string; created_at?: string }>;
  latest?: { id?: string; created_at?: string };
};

export default async function AiHubPage() {
  const base = await getRequestOrigin();

  const [aeo, prompts, llms] = await Promise.all([
    fetchJsonSafe<AeoDashboardPayload>(`${base}/api/aeo/dashboard`),
    fetchJsonSafe<PromptsPayload>(`${base}/api/prompts`),
    fetchJsonSafe<LlmsTxtVersions>(`${base}/api/llms-txt/versions`),
  ]);

  const aeoScore = aeo?.score ?? aeo?.averageScore ?? null;
  const citationRate = aeo?.citationRate ?? null;
  const promptList = Array.isArray(prompts?.prompts)
    ? prompts.prompts
    : Array.isArray(prompts?.items)
      ? prompts.items
      : [];
  const promptCount = promptList.length;
  const llmsLatest = llms?.latest?.created_at ?? llms?.versions?.[0]?.created_at ?? null;
  const llmsAgeDays = llmsLatest
    ? Math.max(0, Math.floor((Date.now() - new Date(llmsLatest).getTime()) / 86400000))
    : null;

  const kpis: HubKpi[] = [
    {
      label: "AEO score",
      value: aeoScore != null ? Math.round(aeoScore).toString() : "—",
      hint: "Avg across tracked prompts",
      tone: aeoScore != null && aeoScore >= 70 ? "emerald" : "violet",
    },
    {
      label: "Citation rate",
      value: citationRate != null ? `${Math.round(citationRate)}%` : "—",
      hint: "AI engines citing the firm",
      tone: "neutral",
    },
    {
      label: "Tracked prompts",
      value: promptCount.toString(),
      hint: "Active prompt projects",
      tone: "neutral",
    },
    {
      label: "llms.txt",
      value: llmsAgeDays != null ? `${llmsAgeDays}d ago` : "Not published",
      hint: "Latest version served",
      tone: llmsAgeDays != null && llmsAgeDays <= 30 ? "emerald" : "amber",
    },
  ];

  const cards: HubCard[] = [
    {
      href: "/aeo",
      label: "Answer Engine Optimization",
      description:
        "Track how often the firm shows up in ChatGPT, Perplexity, Claude, and Gemini answers.",
      metric: aeoScore != null ? `${Math.round(aeoScore)} score` : undefined,
    },
    {
      href: "/ai-search",
      label: "AI search visibility",
      description:
        "Run prompts against major AI engines and see the firm's ranking across them.",
    },
    {
      href: "/llms-txt",
      label: "llms.txt",
      description:
        "Manage the /llms.txt manifest that tells AI crawlers what content to read.",
      metric: llmsAgeDays != null ? `${llmsAgeDays}d` : "draft",
    },
    {
      href: "/prompts",
      label: "Prompt operations",
      description:
        "Author and version prompts used by the content, AEO, and recommendation pipelines.",
      metric: promptCount > 0 ? `${promptCount} active` : undefined,
    },
    {
      href: "/ai/referrals",
      label: "AI engine referrals",
      description:
        "GA4-sourced view of sessions where users arrived from ChatGPT, Claude, Perplexity, Gemini, or Copilot — last 30 days.",
    },
    {
      href: "/ai/bot-traffic",
      label: "AI bot crawls",
      description:
        "GPTBot / ClaudeBot / PerplexityBot / Google-Extended hits to katzmelinger.com. Requires external ingest setup.",
    },
    {
      href: "/clarity",
      label: "Clarity behavior",
      description:
        "Microsoft Clarity heatmaps and session replays — what visitors actually do on the site.",
    },
    {
      href: "/correlation",
      label: "AI traffic correlation",
      description:
        "Cross-channel correlation including AI-referred sessions and lead quality.",
    },
  ];

  return (
    <HubShell
      eyebrow="AI Ops Hub"
      title="AI visibility & answer engines"
      subtitle="Track how the firm shows up across ChatGPT, Perplexity, Claude, and Gemini — and the AI infrastructure (prompts, llms.txt, behavior) that powers it."
      kpis={kpis}
      cards={cards}
      actions={[
        { href: "/aeo", label: "Open AEO dashboard", variant: "outline" },
        { href: "/prompts", label: "New prompt", variant: "primary" },
      ]}
    />
  );
}
