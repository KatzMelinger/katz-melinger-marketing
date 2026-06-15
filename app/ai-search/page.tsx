"use client";

/**
 * AI Search Optimization page.
 *
 * Crawls a target site and asks Claude how well it's set up to be discovered
 * and cited by AI search engines (ChatGPT, Claude, Gemini, Copilot, Perplexity).
 *
 * Plain Tailwind utility classes only — matches the project aesthetic. URL is
 * editable so this works for our own site and for competitor analysis.
 */

import { useEffect, useRef, useState } from "react";
import {
  ContentActionsRow,
  useContentActions,
  type ContentActions,
} from "@/components/content-actions";
import { MarketingNav } from "@/components/marketing-nav";
import { useTenantSiteUrl } from "@/components/tenant-provider";

type Tab = "overview" | "bots" | "pages" | "recommendations";

type RecentScan = {
  id: string;
  domain: string;
  base_url: string;
  overall_score: number | null;
  created_at: string;
};

const AI_PLATFORMS: { key: string; label: string }[] = [
  { key: "chatgpt", label: "ChatGPT" },
  { key: "claude", label: "Claude" },
  { key: "gemini", label: "Gemini" },
  { key: "copilot", label: "Copilot" },
  { key: "perplexity", label: "Perplexity" },
];

// ---------- visual primitives ----------------------------------------------

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`border border-black/10 dark:border-white/10 rounded-lg ${className}`}>
      {children}
    </div>
  );
}

function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  className = "",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "outline";
  className?: string;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const variants: Record<string, string> = {
    primary: "bg-foreground text-background hover:opacity-90",
    ghost: "hover:bg-black/5 dark:hover:bg-white/10",
    outline:
      "border border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin ${className}`}
      style={{ width: "1em", height: "1em" }}
      aria-hidden
    >
      ◐
    </span>
  );
}

function ScoreText({ score }: { score: number }) {
  const color =
    score >= 70
      ? "text-emerald-600 dark:text-emerald-400"
      : score >= 40
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400";
  return <span className={`font-bold ${color}`}>{score}</span>;
}

function ScoreBar({ score }: { score: number }) {
  const bg =
    score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="w-full bg-black/5 dark:bg-white/10 rounded-full h-2">
      <div
        className={`h-full rounded-full ${bg}`}
        style={{ width: `${Math.max(0, Math.min(100, score))}%`, transition: "width 1s ease" }}
      />
    </div>
  );
}

function StatusGlyph({ status }: { status: string }) {
  if (status === "good") return <span className="text-emerald-600 dark:text-emerald-400">✓</span>;
  if (status === "fair") return <span className="text-amber-600 dark:text-amber-400">!</span>;
  return <span className="text-red-600 dark:text-red-400">✕</span>;
}

function BotAccessBadge({ allowed }: { allowed: boolean }) {
  if (allowed) {
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
        ✓ Allowed
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-700 dark:text-red-400">
      ✕ Blocked
    </span>
  );
}

function ImpactBadge({ impact }: { impact: string }) {
  const color =
    impact === "high"
      ? "bg-red-500/15 text-red-700 dark:text-red-400"
      : impact === "medium"
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
      : "bg-blue-500/15 text-blue-700 dark:text-blue-400";
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${color}`}>
      {impact}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  return <ImpactBadge impact={priority} />;
}

// ---------- types -----------------------------------------------------------

type CrawlResult = {
  domain: string;
  baseUrl: string;
  crawledAt: string;
  robotsTxt: {
    exists: boolean;
    botAccess: { bot: string; company: string; allowed: boolean; rules: string[] }[];
    hasSitemap: boolean;
    sitemapUrls: string[];
  };
  pages: Array<{
    url: string;
    title: string;
    metaDescription: string;
    wordCount: number;
    h2Tags: string[];
    listCount: number;
    schemaMarkup: { type: string; properties: string[] }[];
    hasOpenGraph: boolean;
    hasTwitterCard: boolean;
    hasCanonical: boolean;
    hasAuthorInfo: boolean;
    hasFAQSchema: boolean;
    hasLegalServiceSchema: boolean;
    hasOrganizationSchema: boolean;
    citationSignals: {
      hasStatistics: boolean;
      hasQuotes: boolean;
      hasSourceLinks: boolean;
      hasDefinitions: boolean;
    };
  }>;
  siteWideSummary: {
    totalPages: number;
    avgWordCount: number;
    totalSchemaTypes: string[];
    pagesWithFAQ: number;
    pagesWithAuthor: number;
    pagesWithSchema: number;
    pagesWithOG: number;
  };
};

type AnalysisResult = {
  overallScore: number;
  aiPlatformScores: Record<
    string,
    { score: number; status: string; notes: string }
  >;
  categories: Record<
    string,
    { score: number; findings: string[]; fixes: string[] }
  >;
  criticalIssues: { issue: string; impact: string; fix: string; affectedPages?: string[] }[];
  quickWins: string[];
  contentRecommendations: {
    type: string;
    page?: string;
    description: string;
    aiImpact: string;
    priority: string;
  }[];
  schemaRecommendations: {
    schemaType: string;
    where: string;
    example?: string;
    reason: string;
  }[];
  competitiveInsight?: string;
};

// ---------- top-level page --------------------------------------------------

export default function AISearchPage() {
  const tenantSite = useTenantSiteUrl();
  const sitePrefilled = useRef(false);
  const [url, setUrl] = useState("");
  // Prefill the firm's own site once it's known (was hardcoded to KM).
  useEffect(() => {
    if (!sitePrefilled.current && tenantSite) {
      setUrl(tenantSite);
      sitePrefilled.current = true;
    }
  }, [tenantSite]);
  const [crawling, setCrawling] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [crawlData, setCrawlData] = useState<CrawlResult | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);
  // Shared Ideas + Create flow for the per-recommendation buttons.
  const ca = useContentActions();

  const refreshHistory = async () => {
    try {
      const res = await fetch("/api/ai-search/scans");
      const data = await res.json();
      setRecentScans(data.scans ?? []);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    refreshHistory();
  }, []);

  const loadScan = async (id: string) => {
    try {
      const res = await fetch(`/api/ai-search/scans?id=${id}`);
      const data = await res.json();
      if (!res.ok) return;
      setCrawlData(data.crawl);
      setAnalysis(data.analysis);
      setUrl(data.base_url);
      setActiveTab("overview");
    } catch {
      /* ignore */
    }
  };

  const runCrawl = async () => {
    setCrawling(true);
    setCrawlData(null);
    setAnalysis(null);
    setError(null);
    try {
      const res = await fetch("/api/ai-search/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Crawl failed");
      setCrawlData(data);
      setActiveTab("overview");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Crawl failed");
    }
    setCrawling(false);
  };

  const runAnalysis = async () => {
    if (!crawlData) return;
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-search/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(crawlData),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Analysis failed");
      setAnalysis(data.analysis);
      setActiveTab("overview");
      refreshHistory();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    }
    setAnalyzing(false);
  };

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "overview", label: "Overview", icon: "▣" },
    { id: "bots", label: "AI Bot Access", icon: "🤖" },
    { id: "pages", label: "Page Analysis", icon: "▤" },
    { id: "recommendations", label: "Recommendations", icon: "✦" },
  ];

  return (
    <>
      <MarketingNav />
      <div className="p-6 space-y-6 mx-auto max-w-7xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Search Optimization</h1>
        <p className="text-sm opacity-70 mt-1">
          Score how well a site is set up to be discovered and cited by ChatGPT,
          Claude, Gemini, Copilot &amp; Perplexity. Use it on our site or any
          competitor.
        </p>
      </div>

      <Card className="p-4">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <label className="text-sm opacity-70 shrink-0">Target URL</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="flex-1 min-w-0 px-3 py-2 rounded-md border border-black/15 dark:border-white/15 bg-transparent text-sm outline-none focus:ring-1 focus:ring-foreground/30"
          />
          <div className="flex gap-2">
            <Button onClick={runCrawl} disabled={crawling || analyzing} variant="outline">
              {crawling ? <Spinner /> : <span aria-hidden>⌕</span>}
              {crawling ? "Crawling…" : "Crawl Site"}
            </Button>
            <Button onClick={runAnalysis} disabled={!crawlData || crawling || analyzing}>
              {analyzing ? <Spinner /> : <span aria-hidden>✦</span>}
              {analyzing ? "Analyzing…" : "AI Analysis"}
            </Button>
          </div>
        </div>
        {error && (
          <p className="mt-3 text-sm text-red-700 dark:text-red-400">{error}</p>
        )}
      </Card>

      {recentScans.length > 0 && (
        <Card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wider opacity-60 mb-2">
            Recent scans
          </div>
          <div className="flex flex-wrap gap-2">
            {recentScans.map((s) => (
              <button
                key={s.id}
                onClick={() => loadScan(s.id)}
                className="text-xs px-2 py-1 rounded border border-slate-200 hover:border-brand hover:text-brand transition-colors"
                title={`${s.domain} — ${new Date(s.created_at).toLocaleString()}`}
              >
                <span className="font-medium">{s.domain}</span>
                {typeof s.overall_score === "number" && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700">
                    {s.overall_score}
                  </span>
                )}
                <span className="ml-2 opacity-60">
                  {new Date(s.created_at).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {!crawlData && !crawling && (
        <Card className="p-10 text-center">
          <div className="text-3xl mb-2" aria-hidden>🤖</div>
          <h3 className="text-lg font-semibold">AI Search Readiness Scanner</h3>
          <p className="text-sm opacity-70 max-w-lg mx-auto mt-2">
            Scans the target site for robots.txt rules, schema markup, content
            structure, E-E-A-T signals, and citation-worthiness — then asks
            Claude to score and recommend fixes across the major AI platforms.
          </p>
        </Card>
      )}

      {crawling && (
        <Card className="p-10 text-center">
          <Spinner className="text-2xl" />
          <p className="mt-3 font-medium">Crawling {url}…</p>
          <p className="text-sm opacity-70 mt-1">
            Checking robots.txt, schema markup, content structure, and AI
            readiness signals
          </p>
        </Card>
      )}

      {analyzing && !crawling && (
        <Card className="p-10 text-center">
          <Spinner className="text-2xl" />
          <p className="mt-3 font-medium">Running AI analysis…</p>
          <p className="text-sm opacity-70 mt-1">
            Evaluating across ChatGPT, Claude, Gemini, Copilot, and Perplexity
          </p>
        </Card>
      )}

      {crawlData && !crawling && (
        <>
          <div className="flex gap-2 border-b border-black/10 dark:border-white/10 pb-3 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors shrink-0 ${
                  activeTab === t.id
                    ? "bg-foreground text-background"
                    : "hover:bg-black/5 dark:hover:bg-white/10"
                }`}
              >
                <span aria-hidden>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === "overview" && (
            <OverviewTab crawlData={crawlData} analysis={analysis} />
          )}
          {activeTab === "bots" && <BotsTab crawlData={crawlData} analysis={analysis} />}
          {activeTab === "pages" && <PagesTab crawlData={crawlData} />}
          {activeTab === "recommendations" && (
            <RecommendationsTab analysis={analysis} hasCrawl={!!crawlData} actions={ca} />
          )}
        </>
      )}
      </div>
      {ca.modal}
    </>
  );
}

// ---------- Overview tab ----------------------------------------------------

function OverviewTab({
  crawlData,
  analysis,
}: {
  crawlData: CrawlResult;
  analysis: AnalysisResult | null;
}) {
  if (!analysis) {
    const stats = [
      { label: "Pages Crawled", value: crawlData.siteWideSummary.totalPages },
      { label: "Schema Types", value: crawlData.siteWideSummary.totalSchemaTypes.length },
      { label: "Avg Words/Page", value: crawlData.siteWideSummary.avgWordCount },
      { label: "Pages w/ Open Graph", value: crawlData.siteWideSummary.pagesWithOG },
    ];
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.map((s) => (
            <Card key={s.label} className="p-4">
              <div className="text-2xl font-bold">{s.value.toLocaleString()}</div>
              <div className="text-xs opacity-70 mt-1">{s.label}</div>
            </Card>
          ))}
        </div>
        <Card className="p-5 text-center">
          <div className="text-2xl mb-1" aria-hidden>✦</div>
          <p className="font-medium">Crawl complete.</p>
          <p className="text-sm opacity-70 mt-1">
            Click <span className="font-semibold">AI Analysis</span> for scored
            recommendations across all major AI platforms.
          </p>
        </Card>
      </div>
    );
  }

  const categories: { key: string; label: string }[] = [
    { key: "crawlerAccess", label: "AI Crawler Access" },
    { key: "structuredData", label: "Structured Data / Schema" },
    { key: "contentStructure", label: "Content Structure" },
    { key: "eeat", label: "E-E-A-T Signals" },
    { key: "citationWorthiness", label: "Citation Worthiness" },
    { key: "entityClarity", label: "Entity Clarity" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="lg:col-span-1 p-5 flex flex-col items-center justify-center">
          <span className="text-xs opacity-70 uppercase tracking-wider">
            Overall AI Readiness
          </span>
          <div className="text-5xl font-bold mt-2">
            <ScoreText score={analysis.overallScore} />
          </div>
          <span className="text-xs opacity-70 mt-1">/ 100</span>
        </Card>

        <Card className="lg:col-span-2 p-5">
          <div className="text-xs opacity-70 uppercase tracking-wider mb-3">
            Platform Scores
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {AI_PLATFORMS.map(({ key, label }) => {
              const v = analysis.aiPlatformScores?.[key];
              if (!v) return null;
              return (
                <div
                  key={key}
                  className="flex flex-col items-center p-3 rounded-md bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10"
                >
                  <span className="text-xs opacity-70">{label}</span>
                  <span className="text-lg font-bold mt-1">
                    <ScoreText score={v.score} />
                  </span>
                  <StatusGlyph status={v.status} />
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="text-xs opacity-70 uppercase tracking-wider mb-3">
          Category Scores
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {categories.map((cat) => {
            const data = analysis.categories?.[cat.key];
            if (!data) return null;
            return <CategoryScoreCard key={cat.key} name={cat.label} data={data} />;
          })}
        </div>
      </Card>

      {analysis.competitiveInsight && (
        <Card className="p-5">
          <div className="text-xs opacity-70 uppercase tracking-wider mb-2">
            Competitive Insight
          </div>
          <p className="text-sm leading-relaxed">{analysis.competitiveInsight}</p>
        </Card>
      )}
    </div>
  );
}

function CategoryScoreCard({
  name,
  data,
}: {
  name: string;
  data: { score: number; findings: string[]; fixes: string[] };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-black/10 dark:border-white/10 rounded-md p-3">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between"
      >
        <span className="text-sm font-medium">{name}</span>
        <span className="flex items-center gap-2 text-sm">
          <ScoreText score={data.score} />
          <span className="opacity-50" aria-hidden>
            {open ? "▴" : "▾"}
          </span>
        </span>
      </button>
      <div className="mt-2">
        <ScoreBar score={data.score} />
      </div>
      {open && (
        <div className="mt-3 space-y-3">
          {data.findings?.length > 0 && (
            <div>
              <div className="text-xs uppercase opacity-70 mb-1">Findings</div>
              <ul className="space-y-1">
                {data.findings.map((f, i) => (
                  <li key={i} className="text-xs flex gap-2">
                    <span className="text-amber-600 dark:text-amber-400">−</span>
                    <span className="opacity-80">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.fixes?.length > 0 && (
            <div>
              <div className="text-xs uppercase opacity-70 mb-1">Fixes</div>
              <ul className="space-y-1">
                {data.fixes.map((f, i) => (
                  <li key={i} className="text-xs flex gap-2">
                    <span className="text-emerald-600 dark:text-emerald-400">+</span>
                    <span className="opacity-80">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Bots tab --------------------------------------------------------

function BotsTab({
  crawlData,
  analysis,
}: {
  crawlData: CrawlResult;
  analysis: AnalysisResult | null;
}) {
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="p-4 border-b border-black/10 dark:border-white/10 flex items-center gap-2">
          <span aria-hidden>🛡</span>
          <span className="font-semibold text-sm">robots.txt AI Bot Access</span>
          <span
            className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
              crawlData.robotsTxt.exists
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                : "bg-red-500/15 text-red-700 dark:text-red-400"
            }`}
          >
            {crawlData.robotsTxt.exists ? "Found" : "Missing"}
          </span>
        </div>
        <div className="divide-y divide-black/5 dark:divide-white/5">
          {crawlData.robotsTxt.botAccess.map((bot) => (
            <div
              key={bot.bot}
              className="px-4 py-3 flex items-center justify-between hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span aria-hidden>🤖</span>
                  <span className="text-sm font-medium truncate">{bot.bot}</span>
                  <span className="text-xs opacity-60 truncate">({bot.company})</span>
                </div>
                {bot.rules.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1 ml-6">
                    {bot.rules.map((r, i) => (
                      <span
                        key={i}
                        className="text-[10px] px-1.5 py-0.5 bg-black/5 dark:bg-white/10 rounded font-mono opacity-80"
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <BotAccessBadge allowed={bot.allowed} />
            </div>
          ))}
        </div>
      </Card>

      {crawlData.robotsTxt.hasSitemap && (
        <Card className="p-4">
          <div className="text-sm font-medium mb-2 flex items-center gap-2">
            <span aria-hidden>🗺</span> Sitemaps Referenced
          </div>
          <div className="space-y-1">
            {crawlData.robotsTxt.sitemapUrls.map((u) => (
              <a
                key={u}
                href={u}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs underline opacity-80 hover:opacity-100 break-all"
              >
                {u}
              </a>
            ))}
          </div>
        </Card>
      )}

      {analysis?.aiPlatformScores && (
        <Card className="p-4">
          <div className="text-sm font-medium mb-3">Platform-Specific Notes</div>
          <div className="space-y-2">
            {AI_PLATFORMS.map(({ key, label }) => {
              const v = analysis.aiPlatformScores[key];
              if (!v) return null;
              return (
                <div
                  key={key}
                  className="p-3 rounded bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{label}</span>
                    <StatusGlyph status={v.status} />
                    <span className="text-xs opacity-70">
                      <ScoreText score={v.score} />/100
                    </span>
                  </div>
                  <p className="text-xs opacity-80 mt-1">{v.notes}</p>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------- Pages tab -------------------------------------------------------

function PagesTab({ crawlData }: { crawlData: CrawlResult }) {
  return (
    <div className="space-y-3">
      {crawlData.pages.map((page) => {
        const path = (() => {
          try {
            const u = new URL(page.url);
            return u.pathname || "/";
          } catch {
            return page.url;
          }
        })();
        return (
          <Card key={page.url} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <a
                  href={page.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium underline opacity-90 hover:opacity-100 truncate block"
                >
                  {path}
                </a>
                <p className="text-xs opacity-70 mt-0.5 truncate">{page.title}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
              <Stat label="Words" value={page.wordCount.toLocaleString()} />
              <Stat label="Schema Types" value={page.schemaMarkup.length} />
              <Stat label="H2 Headings" value={page.h2Tags.length} />
              <Stat label="Lists" value={page.listCount} />
            </div>

            <div className="flex flex-wrap gap-1.5 mt-3">
              {page.hasOpenGraph && <Tag tone="emerald">OpenGraph</Tag>}
              {page.hasTwitterCard && <Tag tone="blue">Twitter Card</Tag>}
              {page.hasCanonical && <Tag tone="violet">Canonical</Tag>}
              {page.hasAuthorInfo && <Tag tone="amber">Author</Tag>}
              {page.hasFAQSchema && <Tag tone="violet">FAQ Schema</Tag>}
              {page.hasLegalServiceSchema && <Tag tone="violet">LegalService</Tag>}
              {page.hasOrganizationSchema && <Tag tone="violet">Organization</Tag>}
              {page.schemaMarkup.map((s, i) => (
                <Tag key={`${page.url}-schema-${i}`} tone="neutral">
                  {s.type}
                </Tag>
              ))}
              {page.citationSignals.hasStatistics && <Tag tone="cyan">Statistics</Tag>}
              {page.citationSignals.hasDefinitions && <Tag tone="cyan">Definitions</Tag>}
              {page.citationSignals.hasQuotes && <Tag tone="cyan">Quotes</Tag>}
              {page.citationSignals.hasSourceLinks && <Tag tone="cyan">Source links</Tag>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-2 rounded bg-black/5 dark:bg-white/5 text-center">
      <div className="text-sm font-bold">{value}</div>
      <div className="text-[10px] opacity-70">{label}</div>
    </div>
  );
}

function Tag({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "emerald" | "blue" | "violet" | "amber" | "cyan" | "neutral";
}) {
  const colors: Record<string, string> = {
    emerald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    blue: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    violet: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    cyan: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
    neutral: "bg-black/5 dark:bg-white/10 opacity-80",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${colors[tone]}`}>
      {children}
    </span>
  );
}

// ---------- Recommendations tab --------------------------------------------

function RecommendationsTab({
  analysis,
  hasCrawl,
  actions,
}: {
  analysis: AnalysisResult | null;
  hasCrawl: boolean;
  actions: ContentActions;
}) {
  if (!analysis) {
    return (
      <Card className="p-10 text-center">
        <div className="text-2xl mb-2" aria-hidden>✦</div>
        <h3 className="text-lg font-semibold">AI Recommendations</h3>
        <p className="text-sm opacity-70 max-w-md mx-auto mt-2">
          {hasCrawl
            ? "Click AI Analysis to get personalized recommendations."
            : "Run the crawl first, then get AI recommendations."}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {analysis.criticalIssues?.length > 0 && (
        <Card className="p-4">
          <div className="text-sm font-semibold flex items-center gap-2 mb-3">
            <span aria-hidden>⚠</span>
            Critical Issues
            <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-red-500/15 text-red-700 dark:text-red-400">
              {analysis.criticalIssues.length}
            </span>
          </div>
          <div className="space-y-2">
            {analysis.criticalIssues.map((issue, i) => (
              <div
                key={i}
                className="rounded-md border border-black/10 dark:border-white/10 p-3"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{issue.issue}</span>
                  <ImpactBadge impact={issue.impact} />
                </div>
                <p className="text-xs mt-1 text-emerald-700 dark:text-emerald-400 flex gap-1">
                  <span aria-hidden>→</span>
                  <span>{issue.fix}</span>
                </p>
                {issue.affectedPages && issue.affectedPages.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {issue.affectedPages.map((p, j) => (
                      <span
                        key={j}
                        className="text-[10px] px-1.5 py-0.5 bg-black/5 dark:bg-white/10 rounded font-mono opacity-80"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {analysis.quickWins?.length > 0 && (
        <Card className="p-4">
          <div className="text-sm font-semibold flex items-center gap-2 mb-3">
            <span aria-hidden>⚡</span> Quick Wins
          </div>
          <ul className="space-y-2">
            {analysis.quickWins.map((qw, i) => (
              <li key={i} className="text-sm flex gap-2">
                <span className="opacity-60">{i + 1}.</span>
                <span className="opacity-90">{qw}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {analysis.contentRecommendations?.length > 0 && (
        <Card className="p-4">
          <div className="text-sm font-semibold flex items-center gap-2 mb-3">
            <span aria-hidden>✎</span> Content Recommendations
            <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-black/5 dark:bg-white/10">
              {analysis.contentRecommendations.length}
            </span>
          </div>
          <div className="space-y-2">
            {analysis.contentRecommendations.map((rec, i) => (
              <div
                key={i}
                className="rounded-md border border-black/10 dark:border-white/10 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/5 dark:bg-white/10 capitalize">
                        {rec.type?.replace(/_/g, " ")}
                      </span>
                      <PriorityBadge priority={rec.priority} />
                      {rec.page && (
                        <span className="text-[10px] font-mono opacity-70">{rec.page}</span>
                      )}
                    </div>
                    <p className="text-sm mt-2">{rec.description}</p>
                    <p className="text-xs opacity-70 italic mt-1">{rec.aiImpact}</p>
                  </div>
                  <div className="shrink-0">
                    <ContentActionsRow keyword={rec.description} actions={actions} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {analysis.schemaRecommendations?.length > 0 && (
        <Card className="p-4">
          <div className="text-sm font-semibold flex items-center gap-2 mb-3">
            <span aria-hidden>{`{}`}</span> Schema Markup Recommendations
          </div>
          <div className="space-y-2">
            {analysis.schemaRecommendations.map((rec, i) => (
              <div
                key={i}
                className="rounded-md border border-black/10 dark:border-white/10 p-3"
              >
                <div className="text-sm font-medium">{rec.schemaType}</div>
                <p className="text-xs opacity-80 mt-1">
                  <span className="font-semibold">Where:</span> {rec.where}
                </p>
                <p className="text-xs opacity-80 mt-1">
                  <span className="font-semibold">Why:</span> {rec.reason}
                </p>
                {rec.example && (
                  <pre className="mt-2 p-2 bg-black/5 dark:bg-white/5 rounded text-[10px] overflow-x-auto font-mono">
                    {rec.example}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
