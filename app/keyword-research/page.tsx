"use client";

/**
 * Keyword Research page for MarketOS.
 *
 * Four tabs:
 *   - Discover         — AI-suggested keyword opportunities
 *   - Expand           — keyword cluster around a single seed
 *   - Competitor Gaps  — AI gap analysis vs competing firms
 *   - Tracked          — keywords the firm is monitoring with live Semrush data
 *
 * Ported from artifacts/dashboard/src/pages/keyword-research.tsx (Replit / Vite)
 * to Next.js App Router. Differences from the original:
 *   - "use client" directive at the top (Next.js Server Component default)
 *   - Removed the Layout/PageHeader wrappers — MarketOS has its own layout shell
 *   - API base is just "/api" since pages and routes live in the same Next.js app
 *   - Added a "Tracked" tab backed by /api/seo/keywords{,/refresh,/[id]}
 */

import { useEffect, useState } from "react";
import {
  Search,
  Loader2,
  Sparkles,
  TrendingUp,
  Target,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  Zap,
  ArrowRight,
  Plus,
  Copy,
  Check,
  BarChart3,
  Globe,
  FileText,
  Trash2,
  RefreshCw,
  ListChecks,
  ArrowUp,
  ArrowDown,
  Minus,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Tab = "discover" | "expand" | "gaps" | "tracked";

const PRACTICE_AREAS = [
  "All",
  "Employment Discrimination",
  "FMLA",
  "Wage & Hour Claims",
  "Wrongful Termination",
  "Sexual Harassment at Work",
  "Severance Negotiations",
  "Commercial Collections",
  "Judgment Enforcement",
];

const INTENTS = [
  { id: "all", label: "All Intents" },
  { id: "informational", label: "Informational" },
  { id: "commercial", label: "Commercial" },
  { id: "transactional", label: "Transactional" },
];

// ---------- shared visual primitives ---------------------------------------

function DifficultyBadge({ d }: { d: number | null | undefined }) {
  if (d === null || d === undefined) {
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
        —
      </span>
    );
  }
  const color =
    d >= 70
      ? "bg-red-500/10 text-red-400"
      : d >= 40
      ? "bg-amber-500/10 text-amber-400"
      : "bg-emerald-500/10 text-emerald-400";
  const label = d >= 70 ? "Hard" : d >= 40 ? "Medium" : "Easy";
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {d} ({label})
    </span>
  );
}

function IntentBadge({ intent }: { intent: string }) {
  const colors: Record<string, string> = {
    informational: "bg-blue-500/10 text-blue-400",
    commercial: "bg-violet-500/10 text-violet-400",
    transactional: "bg-emerald-500/10 text-emerald-400",
    navigational: "bg-orange-500/10 text-orange-400",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
        colors[intent] || "bg-muted text-muted-foreground"
      }`}
    >
      {intent}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 w-6 p-0"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? (
        <Check className="w-3 h-3 text-emerald-400" />
      ) : (
        <Copy className="w-3 h-3 text-muted-foreground" />
      )}
    </Button>
  );
}

// ---------- top-level page -------------------------------------------------

export default function KeywordResearchPage() {
  const [activeTab, setActiveTab] = useState<Tab>("discover");

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Keyword Research</h1>
        <p className="text-sm text-muted-foreground mt-1">
          AI-powered keyword discovery, cluster expansion, competitive gap analysis,
          and live rank tracking via Semrush.
        </p>
      </div>

      <div className="flex gap-2 border-b border-border pb-4 overflow-x-auto">
        <Button
          variant={activeTab === "discover" ? "default" : "ghost"}
          onClick={() => setActiveTab("discover")}
          className="gap-2 shrink-0"
        >
          <Search className="w-4 h-4" /> Discover
        </Button>
        <Button
          variant={activeTab === "expand" ? "default" : "ghost"}
          onClick={() => setActiveTab("expand")}
          className="gap-2 shrink-0"
        >
          <Sparkles className="w-4 h-4" /> Expand
        </Button>
        <Button
          variant={activeTab === "gaps" ? "default" : "ghost"}
          onClick={() => setActiveTab("gaps")}
          className="gap-2 shrink-0"
        >
          <Target className="w-4 h-4" /> Competitor Gaps
        </Button>
        <Button
          variant={activeTab === "tracked" ? "default" : "ghost"}
          onClick={() => setActiveTab("tracked")}
          className="gap-2 shrink-0"
        >
          <ListChecks className="w-4 h-4" /> Tracked
        </Button>
      </div>

      {activeTab === "discover" && <DiscoverTab />}
      {activeTab === "expand" && <ExpandTab />}
      {activeTab === "gaps" && <GapsTab />}
      {activeTab === "tracked" && <TrackedTab />}
    </div>
  );
}

// ---------- Discover tab ---------------------------------------------------

function DiscoverTab() {
  const [seedKeyword, setSeedKeyword] = useState("");
  const [practiceArea, setPracticeArea] = useState("All");
  const [intent, setIntent] = useState("all");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"volume" | "difficulty" | "relevance">("relevance");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleDiscover = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/keyword-research/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seedKeyword: seedKeyword || undefined,
          practiceArea,
          intent,
          count: 20,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate keywords");
      setResults(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const sortedKeywords = results?.keywords
    ? [...results.keywords].sort((a: any, b: any) => {
        const av = a[sortBy] || 0;
        const bv = b[sortBy] || 0;
        return sortDir === "desc" ? bv - av : av - bv;
      })
    : [];

  const toggleSort = (col: "volume" | "difficulty" | "relevance") => {
    if (sortBy === col) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Seed Keyword (optional)
            </label>
            <input
              className="w-full bg-background border border-border rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="e.g., employment lawyer NYC"
              value={seedKeyword}
              onChange={(e) => setSeedKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleDiscover()}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Practice Area</label>
            <select
              className="w-full bg-background border border-border rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              value={practiceArea}
              onChange={(e) => setPracticeArea(e.target.value)}
            >
              {PRACTICE_AREAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Search Intent</label>
            <select
              className="w-full bg-background border border-border rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
            >
              {INTENTS.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button onClick={handleDiscover} disabled={loading} className="w-full gap-2">
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              Discover Keywords
            </Button>
          </div>
        </div>
      </Card>

      {error && (
        <div className="text-destructive text-sm bg-destructive/10 p-3 rounded-lg">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Analyzing keyword opportunities…</p>
        </div>
      )}

      {results && !loading && (
        <div className="space-y-6">
          {results.summary && (
            <Card className="p-4 border-primary/20 bg-primary/5">
              <div className="flex items-start gap-3">
                <Lightbulb className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <p className="text-sm">{results.summary}</p>
              </div>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {results.quickWins?.length > 0 && (
              <Card className="p-4">
                <h3 className="font-medium flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-emerald-400" /> Quick Wins
                </h3>
                <div className="space-y-2">
                  {results.quickWins.map((qw: any, i: number) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-sm bg-muted/30 rounded-lg p-2.5"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{qw.keyword}</span>
                          <CopyButton text={qw.keyword} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{qw.reason}</p>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0 ml-3">
                        <span>{qw.volume?.toLocaleString()} /mo</span>
                        <DifficultyBadge d={qw.difficulty} />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {results.highValueTargets?.length > 0 && (
              <Card className="p-4">
                <h3 className="font-medium flex items-center gap-2 mb-3">
                  <TrendingUp className="w-4 h-4 text-amber-400" /> High-Value Targets
                </h3>
                <div className="space-y-2">
                  {results.highValueTargets.map((hv: any, i: number) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-sm bg-muted/30 rounded-lg p-2.5"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{hv.keyword}</span>
                          <CopyButton text={hv.keyword} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{hv.strategy}</p>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0 ml-3">
                        <span>{hv.volume?.toLocaleString()} /mo</span>
                        <DifficultyBadge d={hv.difficulty} />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>

          {sortedKeywords.length > 0 && (
            <Card className="overflow-hidden">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <h3 className="font-medium">All Keywords ({sortedKeywords.length})</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase bg-muted/50 text-muted-foreground border-b border-border">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Keyword</th>
                      <th
                        className="px-4 py-3 text-left font-medium cursor-pointer hover:text-foreground"
                        onClick={() => toggleSort("volume")}
                      >
                        Volume {sortBy === "volume" && (sortDir === "desc" ? "↓" : "↑")}
                      </th>
                      <th
                        className="px-4 py-3 text-left font-medium cursor-pointer hover:text-foreground"
                        onClick={() => toggleSort("difficulty")}
                      >
                        Difficulty {sortBy === "difficulty" && (sortDir === "desc" ? "↓" : "↑")}
                      </th>
                      <th className="px-4 py-3 text-left font-medium">Intent</th>
                      <th
                        className="px-4 py-3 text-left font-medium cursor-pointer hover:text-foreground"
                        onClick={() => toggleSort("relevance")}
                      >
                        Relevance {sortBy === "relevance" && (sortDir === "desc" ? "↓" : "↑")}
                      </th>
                      <th className="px-4 py-3 text-left font-medium">Practice Area</th>
                      <th className="px-4 py-3 text-left font-medium">Content Suggestion</th>
                      <th className="px-4 py-3 text-left font-medium">Track</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {sortedKeywords.map((kw: any, i: number) => (
                      <tr key={i} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{kw.keyword}</span>
                            <CopyButton text={kw.keyword} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {kw.volume?.toLocaleString() || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <DifficultyBadge d={kw.difficulty || 0} />
                        </td>
                        <td className="px-4 py-3">
                          <IntentBadge intent={kw.intent || "informational"} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="w-16 bg-muted rounded-full h-2">
                            <div
                              className="bg-primary h-2 rounded-full"
                              style={{ width: `${kw.relevance || 0}%` }}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {kw.practiceArea || "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate">
                          {kw.contentSuggestion || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <TrackButton
                            keyword={kw.keyword}
                            practiceArea={kw.practiceArea}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {results.contentGaps?.length > 0 && (
            <Card className="p-4">
              <h3 className="font-medium flex items-center gap-2 mb-3">
                <FileText className="w-4 h-4 text-blue-400" /> Content Gaps
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {results.contentGaps.map((gap: any, i: number) => (
                  <div key={i} className="bg-muted/30 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">{gap.topic}</span>
                      <Badge variant="outline" className="text-xs capitalize">
                        {gap.priority}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      Format: {gap.contentFormat}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {gap.suggestedKeywords?.map((kw: string, j: number) => (
                        <span
                          key={j}
                          className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Expand tab -----------------------------------------------------

function ExpandTab() {
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    longTail: true,
    questions: true,
    local: true,
    semantic: false,
    competitor: false,
  });

  const handleExpand = async () => {
    if (!keyword.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/keyword-research/expand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to expand keyword");
      setResults(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const sections = [
    { key: "longTail", label: "Long-Tail Variations", icon: ArrowRight, color: "text-blue-400" },
    { key: "questions", label: "Question Keywords", icon: Search, color: "text-violet-400" },
    { key: "local", label: "Local Variations (NYC/NJ)", icon: Globe, color: "text-emerald-400" },
    { key: "semantic", label: "Semantic / Related", icon: Sparkles, color: "text-amber-400" },
    { key: "competitor", label: "Competitor Keywords", icon: Target, color: "text-red-400" },
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      <Card className="p-5">
        <div className="flex gap-4">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Keyword to Expand
            </label>
            <input
              className="w-full bg-background border border-border rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="e.g., wrongful termination"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleExpand()}
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={handleExpand}
              disabled={loading || !keyword.trim()}
              className="gap-2"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Expand
            </Button>
          </div>
        </div>
      </Card>

      {error && (
        <div className="text-destructive text-sm bg-destructive/10 p-3 rounded-lg">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">
            Building keyword cluster for &quot;{keyword}&quot;…
          </p>
        </div>
      )}

      {results && !loading && (
        <div className="space-y-4">
          {sections.map(({ key, label, icon: Icon, color }) => {
            const items = results[key] || [];
            if (items.length === 0) return null;
            const isOpen = expandedSections[key];
            return (
              <Card key={key} className="overflow-hidden">
                <button
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/20 transition-colors"
                  onClick={() => toggleSection(key)}
                >
                  <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${color}`} />
                    <span className="font-medium text-sm">{label}</span>
                    <Badge variant="outline" className="text-xs">
                      {items.length}
                    </Badge>
                  </div>
                  {isOpen ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
                {isOpen && (
                  <div className="border-t border-border divide-y divide-border/50">
                    {items.map((item: any, i: number) => (
                      <div
                        key={i}
                        className="px-4 py-2.5 flex items-center justify-between hover:bg-muted/10"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{item.keyword}</span>
                          <CopyButton text={item.keyword} />
                          <TrackButton keyword={item.keyword} compact />
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{item.volume?.toLocaleString() || "—"} /mo</span>
                          <DifficultyBadge d={item.difficulty || 0} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}

          {results.contentStrategy && (
            <Card className="p-4">
              <h3 className="font-medium flex items-center gap-2 mb-3">
                <BarChart3 className="w-4 h-4 text-primary" /> Content Strategy
              </h3>
              <div className="space-y-3 text-sm">
                {results.contentStrategy.pillarPage && (
                  <div>
                    <span className="text-muted-foreground">Pillar Page:</span>{" "}
                    <span className="font-medium">{results.contentStrategy.pillarPage}</span>
                  </div>
                )}
                {results.contentStrategy.supportingArticles?.length > 0 && (
                  <div>
                    <span className="text-muted-foreground block mb-1">Supporting Articles:</span>
                    <ul className="space-y-1 ml-4">
                      {results.contentStrategy.supportingArticles.map((a: string, i: number) => (
                        <li key={i} className="text-sm list-disc">
                          {a}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {results.contentStrategy.internalLinkingPlan && (
                  <div>
                    <span className="text-muted-foreground">Linking Plan:</span>{" "}
                    {results.contentStrategy.internalLinkingPlan}
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Competitor Gaps tab --------------------------------------------

function GapsTab() {
  const [competitors, setCompetitors] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    setLoading(true);
    setError(null);
    try {
      const competitorList = competitors
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      const res = await fetch("/api/keyword-research/competitor-gaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ competitors: competitorList }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to analyze gaps");
      setResults(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex gap-4">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Competitor Domains (optional, comma-separated)
            </label>
            <input
              className="w-full bg-background border border-border rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="e.g., phillipsandassociates.com, nycemploymentlawyer.com"
              value={competitors}
              onChange={(e) => setCompetitors(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to analyze against typical NYC/NJ employment law competitors
            </p>
          </div>
          <div className="flex items-end">
            <Button onClick={handleAnalyze} disabled={loading} className="gap-2">
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Target className="w-4 h-4" />
              )}
              Analyze Gaps
            </Button>
          </div>
        </div>
      </Card>

      {error && (
        <div className="text-destructive text-sm bg-destructive/10 p-3 rounded-lg">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Analyzing competitive keyword gaps…</p>
        </div>
      )}

      {results && !loading && (
        <div className="space-y-6">
          {results.actionPlan && (
            <Card className="p-4 border-primary/20 bg-primary/5">
              <div className="flex items-start gap-3">
                <Lightbulb className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <h3 className="font-medium text-sm mb-1">30-Day Action Plan</h3>
                  <p className="text-sm">{results.actionPlan}</p>
                </div>
              </div>
            </Card>
          )}

          {results.competitorKeywords?.length > 0 && (
            <Card className="p-4">
              <h3 className="font-medium flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-red-400" /> Competitor Keywords to Target
              </h3>
              <div className="space-y-2">
                {results.competitorKeywords.map((ck: any, i: number) => (
                  <div key={i} className="bg-muted/30 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{ck.keyword}</span>
                        <CopyButton text={ck.keyword} />
                        <TrackButton keyword={ck.keyword} compact />
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-muted-foreground">
                          {ck.volume?.toLocaleString()} /mo
                        </span>
                        <DifficultyBadge d={ck.difficulty || 0} />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{ck.ourOpportunity}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {results.emergingTrends?.length > 0 && (
            <Card className="p-4">
              <h3 className="font-medium flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-emerald-400" /> Emerging Trends
              </h3>
              <div className="space-y-2">
                {results.emergingTrends.map((t: any, i: number) => (
                  <div key={i} className="bg-muted/30 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">{t.trend}</span>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            t.timing === "act now"
                              ? "border-red-400 text-red-400"
                              : t.timing === "next quarter"
                              ? "border-amber-400 text-amber-400"
                              : "border-muted-foreground"
                          }`}
                        >
                          {t.timing}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            t.growthPotential === "high"
                              ? "border-emerald-400 text-emerald-400"
                              : ""
                          }`}
                        >
                          {t.growthPotential} growth
                        </Badge>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {t.relatedKeywords?.map((kw: string, j: number) => (
                        <span
                          key={j}
                          className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {results.underservedTopics?.length > 0 && (
              <Card className="p-4">
                <h3 className="font-medium flex items-center gap-2 mb-3">
                  <Lightbulb className="w-4 h-4 text-amber-400" /> Underserved Topics
                </h3>
                <div className="space-y-2">
                  {results.underservedTopics.map((t: any, i: number) => (
                    <div key={i} className="bg-muted/30 rounded-lg p-3 text-sm">
                      <div className="font-medium mb-1">{t.topic}</div>
                      <p className="text-xs text-muted-foreground mb-1">{t.contentApproach}</p>
                      <p className="text-xs text-muted-foreground">
                        Est. volume: {t.estimatedTotalVolume?.toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {results.localOpportunities?.length > 0 && (
              <Card className="p-4">
                <h3 className="font-medium flex items-center gap-2 mb-3">
                  <Globe className="w-4 h-4 text-blue-400" /> Local Opportunities
                </h3>
                <div className="space-y-2">
                  {results.localOpportunities.map((l: any, i: number) => (
                    <div key={i} className="bg-muted/30 rounded-lg p-3 text-sm">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{l.keyword}</span>
                          <CopyButton text={l.keyword} />
                          <TrackButton keyword={l.keyword} compact />
                        </div>
                        <DifficultyBadge d={l.difficulty || 0} />
                      </div>
                      <p className="text-xs text-muted-foreground">{l.tactic}</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Tracked tab ----------------------------------------------------

type TrackedKeyword = {
  id: string;
  keyword: string;
  practice_area: string | null;
  notes: string | null;
  current_rank: number | null;
  previous_rank: number | null;
  search_volume: number | null;
  difficulty: number | null;
  url: string | null;
  last_checked_at: string | null;
  created_at: string;
};

function TrackedTab() {
  const [items, setItems] = useState<TrackedKeyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newKeyword, setNewKeyword] = useState("");
  const [newPracticeArea, setNewPracticeArea] = useState("All");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/seo/keywords");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setItems(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async () => {
    if (!newKeyword.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/seo/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: newKeyword.trim(),
          practiceArea: newPracticeArea === "All" ? null : newPracticeArea,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add");
      setItems((prev) => [...prev, data]);
      setNewKeyword("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/seo/keywords/refresh", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to refresh");
      setItems(data.keywords);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/seo/keywords/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete");
      }
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Add a keyword to track
            </label>
            <input
              className="w-full bg-background border border-border rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="e.g., unpaid overtime lawyer nyc"
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
          </div>
          <div className="space-y-1 md:w-64">
            <label className="text-xs font-medium text-muted-foreground">Practice Area</label>
            <select
              className="w-full bg-background border border-border rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              value={newPracticeArea}
              onChange={(e) => setNewPracticeArea(e.target.value)}
            >
              {PRACTICE_AREAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <Button
              onClick={handleAdd}
              disabled={adding || !newKeyword.trim()}
              className="gap-2"
            >
              {adding ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Add
            </Button>
            <Button
              onClick={handleRefresh}
              disabled={refreshing || items.length === 0}
              variant="outline"
              className="gap-2"
            >
              {refreshing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      {error && (
        <div className="text-destructive text-sm bg-destructive/10 p-3 rounded-lg">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading tracked keywords…</p>
        </div>
      ) : items.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No tracked keywords yet. Add one above, or click the &quot;Track&quot; icon next to
          any keyword in Discover, Expand, or Competitor Gaps.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase bg-muted/50 text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Keyword</th>
                  <th className="px-4 py-3 text-left font-medium">Practice Area</th>
                  <th className="px-4 py-3 text-left font-medium">Rank</th>
                  <th className="px-4 py-3 text-left font-medium">Movement</th>
                  <th className="px-4 py-3 text-left font-medium">Volume</th>
                  <th className="px-4 py-3 text-left font-medium">Difficulty</th>
                  <th className="px-4 py-3 text-left font-medium">URL</th>
                  <th className="px-4 py-3 text-left font-medium">Last checked</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{item.keyword}</span>
                        <CopyButton text={item.keyword} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {item.practice_area || "—"}
                    </td>
                    <td className="px-4 py-3">
                      {item.current_rank !== null ? (
                        <span className="font-medium">#{item.current_rank}</span>
                      ) : (
                        <span className="text-muted-foreground">Not ranked</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <RankMovement
                        previous={item.previous_rank}
                        current={item.current_rank}
                      />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {item.search_volume?.toLocaleString() || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <DifficultyBadge d={item.difficulty} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate">
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-foreground underline-offset-2 hover:underline"
                        >
                          {item.url.replace(/^https?:\/\//, "")}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {item.last_checked_at
                        ? new Date(item.last_checked_at).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => handleDelete(item.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function RankMovement({
  previous,
  current,
}: {
  previous: number | null;
  current: number | null;
}) {
  if (previous === null || current === null) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  // In SEO, lower rank number is better. Going from #10 to #4 is +6 positions.
  const delta = previous - current;
  if (delta === 0) {
    return (
      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
        <Minus className="w-3 h-3" /> 0
      </span>
    );
  }
  if (delta > 0) {
    return (
      <span className="text-xs text-emerald-400 inline-flex items-center gap-1">
        <ArrowUp className="w-3 h-3" /> {delta}
      </span>
    );
  }
  return (
    <span className="text-xs text-red-400 inline-flex items-center gap-1">
      <ArrowDown className="w-3 h-3" /> {Math.abs(delta)}
    </span>
  );
}

// ---------- Track button (used across multiple tabs) -----------------------

function TrackButton({
  keyword,
  practiceArea,
  compact,
}: {
  keyword: string;
  practiceArea?: string | null;
  compact?: boolean;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setState("saving");
    try {
      const res = await fetch("/api/seo/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword,
          practiceArea: practiceArea && practiceArea !== "All" ? practiceArea : null,
        }),
      });
      // 409 (already tracked) is treated as success — the user's intent was to
      // make sure the keyword is in the tracked list, and it is.
      if (!res.ok && res.status !== 409) {
        throw new Error("Failed");
      }
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2000);
    }
  };

  if (compact) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0"
        title="Track this keyword"
        onClick={handleClick}
      >
        {state === "saving" ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : state === "saved" ? (
          <Check className="w-3 h-3 text-emerald-400" />
        ) : (
          <Plus className="w-3 h-3 text-muted-foreground" />
        )}
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 text-xs gap-1"
      onClick={handleClick}
      disabled={state === "saving"}
    >
      {state === "saving" ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : state === "saved" ? (
        <>
          <Check className="w-3 h-3" /> Tracked
        </>
      ) : (
        <>
          <Plus className="w-3 h-3" /> Track
        </>
      )}
    </Button>
  );
}
