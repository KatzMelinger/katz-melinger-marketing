"use client";

/**
 * Content Intelligence — three AI tools for the planning stage of content:
 *
 *   Topics    — Generate article-level headline + angle ideas by practice area
 *   Trending  — Surface current NY/NJ employment-law news with urgency
 *   Metadata  — Generate full SEO metadata for a planned piece
 *
 * Posts (LinkedIn/X/Reddit/FB) and Site Audit live on other tabs already
 * (Multi-format Batch + AI Search), so they're not duplicated here.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ContentNav } from "@/components/content-nav";
import {
  DashCard,
  DashButton,
  DashInput,
  DashSelect,
  DashSpinner,
  DashPill,
} from "@/components/dashboard-ui";
import {
  clearTrendRuns,
  deleteTrendRun,
  listTrendRuns,
  saveTrendRun,
  TREND_RUNS_CHANGE_EVENT,
  type TrendRun,
} from "@/lib/recent-trends";
import {
  latestPlaybookRun,
  savePlaybookRun,
} from "@/lib/recent-playbooks";
import {
  latestMetadataRun,
  latestTopicsRun,
  saveMetadataRun,
  saveTopicsRun,
} from "@/lib/recent-intelligence";

type Tab = "topics" | "trends" | "metadata" | "social";

type SocialPlatform = "tiktok" | "instagram" | "linkedin" | "twitter" | "facebook" | "youtube_shorts";

type SocialPlaybook = {
  hashtags?: { broad?: string[]; niche?: string[] };
  hooks?: string[];
  captions?: string[];
  best_times?: string;
  visual_ideas?: string[];
  platform_tips?: string[];
};

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

type TopicRow = {
  headline: string;
  summary: string;
  practiceArea: string;
  contentType: string;
  relevance: string;
};

type TrendRow = {
  topic: string;
  whyTrending: string;
  suggestedAngle: string;
  urgency: "hot" | "warm" | "evergreen";
  platforms: string[];
  sourceDate?: string | null;
};

const MONTHS_BACK_OPTIONS = [
  { value: 3, label: "Last 3 months" },
  { value: 6, label: "Last 6 months" },
  { value: 12, label: "Last 12 months" },
];

/**
 * Build the URL into /content/batch with as much trend context as we have.
 * Keeps it consistent with how tracked-keyword flows pass context into the
 * generator — every relevant field becomes a query param so the batch page
 * can pre-fill its form.
 */
function trendDraftHref(t: TrendRow): string {
  const params = new URLSearchParams();
  params.set("topic", t.suggestedAngle || t.topic);
  if (t.suggestedAngle && t.suggestedAngle !== t.topic) {
    params.set("angle", t.suggestedAngle);
  }
  if (t.whyTrending) params.set("context", t.whyTrending);
  if (t.platforms && t.platforms.length > 0) {
    params.set("formats", t.platforms.join(","));
  }
  if (t.sourceDate) params.set("sourceDate", t.sourceDate);
  return `/content/batch?${params.toString()}`;
}

type Metadata = {
  metaTitle?: string;
  metaDescription?: string;
  urlSlug?: string;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  ogTitle?: string;
  ogDescription?: string;
  schemaType?: string;
  internalLinkSuggestions?: string[];
  headerOutline?: string[];
  targetWordCount?: number;
  seoTips?: string[];
};

function urgencyTone(u: string): "red" | "amber" | "emerald" {
  if (u === "hot") return "red";
  if (u === "warm") return "amber";
  return "emerald";
}

export default function IntelligencePage() {
  const [tab, setTab] = useState<Tab>("topics");
  const [practiceArea, setPracticeArea] = useState("All");
  const [monthsBack, setMonthsBack] = useState<number>(6);
  const [trendMeta, setTrendMeta] = useState<{
    today?: string;
    cutoff?: string;
    monthsBack?: number;
    droppedStale?: number;
    droppedMissingDate?: number;
  } | null>(null);
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [trends, setTrends] = useState<TrendRow[]>([]);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [metaTopic, setMetaTopic] = useState("");
  const [metaPageType, setMetaPageType] = useState("blog_post");
  const [socialTopic, setSocialTopic] = useState("");
  const [socialPlatform, setSocialPlatform] = useState<SocialPlatform>("tiktok");
  const [playbook, setPlaybook] = useState<SocialPlaybook | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Recent trend runs (Trending tab) — persisted in localStorage so revisiting
  // the page doesn't lose history and we don't have to re-spend Claude calls.
  const [recentRuns, setRecentRuns] = useState<TrendRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setRecentRuns(listTrendRuns());
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(TREND_RUNS_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(TREND_RUNS_CHANGE_EVENT, sync);
    };
  }, []);

  // Restore the most recent social playbook on mount so leaving and coming
  // back to the page doesn't wipe the last generation.
  useEffect(() => {
    const last = latestPlaybookRun();
    if (!last) return;
    setPlaybook(last.playbook);
    if (!socialTopic) setSocialTopic(last.topic);
    setSocialPlatform(last.platform as SocialPlatform);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore the most recent Topics and Metadata runs on mount so their
  // results stay on screen until the user re-runs the generator — matching
  // the Trending and Social tabs.
  useEffect(() => {
    const lastTopics = latestTopicsRun();
    if (lastTopics) {
      setTopics(lastTopics.topics);
      setPracticeArea(lastTopics.practiceArea);
    }
    const lastMeta = latestMetadataRun();
    if (lastMeta) {
      setMetadata(lastMeta.metadata);
      if (!metaTopic) setMetaTopic(lastMeta.topic);
      setMetaPageType(lastMeta.pageType);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async (value: string, key: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const fetchTopics = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/content/intelligence/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ practiceArea, count: 6 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");
      const fresh = (data.topics ?? []) as TopicRow[];
      setTopics(fresh);
      saveTopicsRun({ practiceArea, topics: fresh });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const fetchTrends = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/content/intelligence/trends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ practiceArea, monthsBack }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");
      const fresh = (data.trends ?? []) as TrendRow[];
      setTrends(fresh);
      setTrendMeta(data.meta ?? null);
      const saved = saveTrendRun({ practiceArea, monthsBack, trends: fresh });
      setActiveRunId(saved?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const loadRun = (run: TrendRun) => {
    setPracticeArea(run.practiceArea);
    if (typeof run.monthsBack === "number") setMonthsBack(run.monthsBack);
    setTrends(run.trends as TrendRow[]);
    setActiveRunId(run.id);
    setTrendMeta(null);
    setError(null);
  };

  const removeRun = (id: string) => {
    deleteTrendRun(id);
    if (activeRunId === id) {
      setActiveRunId(null);
      setTrends([]);
    }
  };

  const clearAllRuns = () => {
    clearTrendRuns();
    setActiveRunId(null);
    setTrends([]);
  };

  const fetchSocial = async () => {
    if (!socialTopic.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/content/intelligence/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: socialTopic.trim(), platform: socialPlatform }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");
      const next = data.playbook ?? null;
      setPlaybook(next);
      if (next) {
        savePlaybookRun({
          topic: socialTopic.trim(),
          platform: socialPlatform,
          playbook: next,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const fetchMetadata = async () => {
    if (!metaTopic.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/content/intelligence/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: metaTopic.trim(), pageType: metaPageType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");
      const fresh = (data.metadata ?? null) as Metadata | null;
      setMetadata(fresh);
      if (fresh) {
        saveMetadataRun({ topic: metaTopic.trim(), pageType: metaPageType, metadata: fresh });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Content studio</h1>
        <p className="text-sm text-slate-600 mt-1">
          AI-powered topic ideas, trend tracking, and SEO metadata for new content.
        </p>
      </div>
      <ContentNav />

      <div className="flex gap-1 border-b border-slate-200 mb-4 overflow-x-auto">
        {[
          { id: "topics", label: "Topic ideas" },
          { id: "trends", label: "Trending" },
          { id: "metadata", label: "SEO metadata" },
          { id: "social", label: "Social media IQ" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as Tab)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-[1px] ${
              tab === t.id
                ? "border-[#185FA5] text-[#185FA5]"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 border border-red-200 bg-red-50 text-red-800 rounded-md px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {tab === "topics" && (
        <div className="space-y-4">
          <DashCard>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-48">
                <label className="text-xs font-medium text-slate-700">Practice area</label>
                <DashSelect
                  value={practiceArea}
                  onChange={(e) => setPracticeArea(e.target.value)}
                  className="w-full mt-1"
                >
                  {PRACTICE_AREAS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </DashSelect>
              </div>
              <DashButton onClick={fetchTopics} disabled={loading}>
                {loading ? <DashSpinner /> : "Suggest topics"}
              </DashButton>
            </div>
          </DashCard>

          {topics.length > 0 && (
            <div className="grid md:grid-cols-2 gap-3">
              {topics.map((t, i) => (
                <DashCard key={i}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="text-sm font-semibold text-slate-900">{t.headline}</h3>
                    <DashPill tone="neutral">{t.contentType?.replace(/_/g, " ")}</DashPill>
                  </div>
                  <p className="text-xs text-slate-600 mb-2">{t.summary}</p>
                  <div className="text-xs text-slate-500 italic border-l-2 border-slate-200 pl-2 mb-3">
                    {t.relevance}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#185FA5]">{t.practiceArea}</span>
                    <div className="flex gap-1">
                      <Link
                        href={`/content/batch?topic=${encodeURIComponent(t.headline)}`}
                        className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-[#185FA5] hover:text-[#185FA5]"
                      >
                        → Generate
                      </Link>
                      <button
                        onClick={() => {
                          setMetaTopic(t.headline);
                          setTab("metadata");
                        }}
                        className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-[#185FA5] hover:text-[#185FA5]"
                      >
                        SEO
                      </button>
                      <button
                        onClick={() => copy(t.headline, `topic-${i}`)}
                        className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-slate-400"
                      >
                        {copied === `topic-${i}` ? "✓" : "Copy"}
                      </button>
                    </div>
                  </div>
                </DashCard>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "trends" && (
        <div className="space-y-4">
          <DashCard>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-48">
                <label className="text-xs font-medium text-slate-700">Practice area</label>
                <DashSelect
                  value={practiceArea}
                  onChange={(e) => setPracticeArea(e.target.value)}
                  className="w-full mt-1"
                >
                  {PRACTICE_AREAS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </DashSelect>
              </div>
              <div className="min-w-48">
                <label className="text-xs font-medium text-slate-700">Recency</label>
                <DashSelect
                  value={String(monthsBack)}
                  onChange={(e) => setMonthsBack(Number(e.target.value))}
                  className="w-full mt-1"
                >
                  {MONTHS_BACK_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </DashSelect>
              </div>
              <DashButton onClick={fetchTrends} disabled={loading}>
                {loading ? <DashSpinner /> : "Find trending topics"}
              </DashButton>
            </div>
            {trendMeta?.cutoff ? (
              <p className="mt-3 text-xs text-slate-500">
                Showing events on or after{" "}
                <span className="font-medium text-slate-700">
                  {new Date(trendMeta.cutoff + "T00:00:00Z").toLocaleDateString(
                    undefined,
                    { year: "numeric", month: "short", day: "numeric" },
                  )}
                </span>
                {(trendMeta.droppedStale ?? 0) +
                  (trendMeta.droppedMissingDate ?? 0) >
                0 ? (
                  <>
                    {" "}
                    · filtered out{" "}
                    {(trendMeta.droppedStale ?? 0) +
                      (trendMeta.droppedMissingDate ?? 0)}{" "}
                    stale / undated item(s)
                  </>
                ) : null}
              </p>
            ) : null}
          </DashCard>

          {recentRuns.length > 0 && (
            <DashCard>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  Recent runs
                </h3>
                <button
                  type="button"
                  onClick={clearAllRuns}
                  className="text-xs text-slate-500 hover:text-red-700"
                >
                  Clear all
                </button>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                Saved locally in your browser. Click a run to reopen its results
                without re-running the AI.
              </p>
              <ul className="divide-y divide-slate-100">
                {recentRuns.map((run) => {
                  const isActive = run.id === activeRunId;
                  const when = new Date(run.createdAt);
                  return (
                    <li
                      key={run.id}
                      className={`flex items-center justify-between gap-3 py-2 text-sm ${
                        isActive ? "bg-[#185FA5]/5 -mx-2 px-2 rounded" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => loadRun(run)}
                        className="flex-1 text-left flex items-center gap-2 min-w-0"
                      >
                        <DashPill tone={isActive ? "blue" : "neutral"}>
                          {run.practiceArea}
                        </DashPill>
                        <span className="text-xs text-slate-500 shrink-0">
                          {when.toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className="text-xs text-slate-600 truncate">
                          {run.trends.length} topic
                          {run.trends.length === 1 ? "" : "s"}
                          {run.trends[0]
                            ? ` · "${run.trends[0].topic}"`
                            : ""}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeRun(run.id)}
                        className="shrink-0 text-xs text-slate-400 hover:text-red-700 px-1"
                        aria-label="Delete this run"
                        title="Delete this run"
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            </DashCard>
          )}

          {trends.length > 0 && (
            <div className="space-y-3">
              {trends.map((t, i) => (
                <DashCard key={i}>
                  <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-slate-900">{t.topic}</h3>
                    <div className="flex items-center gap-1.5">
                      {t.sourceDate ? (
                        <span className="text-[11px] text-slate-500">
                          {new Date(t.sourceDate + "T00:00:00Z").toLocaleDateString(
                            undefined,
                            { year: "numeric", month: "short", day: "numeric" },
                          )}
                        </span>
                      ) : null}
                      <DashPill tone={urgencyTone(t.urgency)}>{t.urgency}</DashPill>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600 mb-2">{t.whyTrending}</p>
                  <div className="bg-[#185FA5]/5 border border-[#185FA5]/20 rounded-md p-2 mb-2">
                    <span className="text-xs font-medium text-[#185FA5]">Suggested angle:</span>
                    <p className="text-xs text-slate-700 mt-0.5">{t.suggestedAngle}</p>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex gap-1 flex-wrap">
                      {(t.platforms ?? []).map((p, j) => (
                        <DashPill key={j} tone="neutral">
                          {p}
                        </DashPill>
                      ))}
                    </div>
                    <Link
                      href={trendDraftHref(t)}
                      className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-[#185FA5] hover:text-[#185FA5]"
                    >
                      → Generate posts
                    </Link>
                  </div>
                </DashCard>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "metadata" && (
        <div className="space-y-4">
          <DashCard>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700">Topic / headline</label>
                <DashInput
                  value={metaTopic}
                  onChange={(e) => setMetaTopic(e.target.value)}
                  placeholder="e.g. Statute of limitations on NY wage theft claims"
                  className="w-full mt-1"
                />
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-48">
                  <label className="text-xs font-medium text-slate-700">Page type</label>
                  <DashSelect
                    value={metaPageType}
                    onChange={(e) => setMetaPageType(e.target.value)}
                    className="w-full mt-1"
                  >
                    <option value="blog_post">Blog post</option>
                    <option value="landing_page">Landing page</option>
                    <option value="service_page">Service page</option>
                    <option value="guide">Guide</option>
                  </DashSelect>
                </div>
                <DashButton onClick={fetchMetadata} disabled={loading || !metaTopic.trim()}>
                  {loading ? <DashSpinner /> : "Generate SEO metadata"}
                </DashButton>
              </div>
            </div>
          </DashCard>

          {metadata && (
            <div className="space-y-3">
              <DashCard>
                <h3 className="text-sm font-semibold mb-3">Optimized metadata</h3>
                <div className="space-y-2">
                  <Field label="Meta title" value={metadata.metaTitle} id="meta-title" copied={copied} onCopy={copy} />
                  <Field label="Meta description" value={metadata.metaDescription} id="meta-desc" copied={copied} onCopy={copy} />
                  <Field label="URL slug" value={metadata.urlSlug} id="meta-slug" copied={copied} onCopy={copy} />
                  <Field label="OG title" value={metadata.ogTitle} id="og-title" copied={copied} onCopy={copy} />
                  <Field label="OG description" value={metadata.ogDescription} id="og-desc" copied={copied} onCopy={copy} />
                  <Field label="Schema type" value={metadata.schemaType} id="schema" copied={copied} onCopy={copy} />
                </div>
                <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
                  {metadata.primaryKeyword && (
                    <div className="text-xs">
                      <span className="font-medium text-slate-700">Primary keyword: </span>
                      <DashPill tone="violet">{metadata.primaryKeyword}</DashPill>
                    </div>
                  )}
                  {metadata.secondaryKeywords && metadata.secondaryKeywords.length > 0 && (
                    <div className="text-xs">
                      <span className="font-medium text-slate-700">Secondary keywords: </span>
                      <span className="inline-flex flex-wrap gap-1 align-middle">
                        {metadata.secondaryKeywords.map((k, i) => (
                          <DashPill key={i} tone="neutral">
                            {k}
                          </DashPill>
                        ))}
                      </span>
                    </div>
                  )}
                </div>
              </DashCard>

              {metadata.headerOutline && metadata.headerOutline.length > 0 && (
                <DashCard>
                  <h3 className="text-sm font-semibold mb-2">Recommended structure</h3>
                  <div className="space-y-1">
                    {metadata.headerOutline.map((h, i) => {
                      const isH1 = h.toLowerCase().startsWith("h1");
                      const isH2 = h.toLowerCase().startsWith("h2");
                      return (
                        <p
                          key={i}
                          className={`text-xs ${
                            isH1 ? "font-bold" : isH2 ? "font-medium ml-3" : "ml-6 text-slate-600"
                          }`}
                        >
                          {h}
                        </p>
                      );
                    })}
                  </div>
                  {metadata.targetWordCount && (
                    <p className="text-xs text-slate-500 mt-3 pt-3 border-t border-slate-200">
                      Target word count:{" "}
                      <span className="font-medium text-slate-900">
                        {metadata.targetWordCount.toLocaleString()}
                      </span>
                    </p>
                  )}
                </DashCard>
              )}

              {metadata.seoTips && metadata.seoTips.length > 0 && (
                <DashCard>
                  <h3 className="text-sm font-semibold mb-2 text-emerald-700">SEO tips</h3>
                  <ul className="space-y-1 text-xs text-slate-700 list-disc pl-5">
                    {metadata.seoTips.map((tip, i) => (
                      <li key={i}>{tip}</li>
                    ))}
                  </ul>
                </DashCard>
              )}

              {metadata.internalLinkSuggestions &&
                metadata.internalLinkSuggestions.length > 0 && (
                  <DashCard>
                    <h3 className="text-sm font-semibold mb-2">Internal linking strategy</h3>
                    <ul className="space-y-1 text-xs text-slate-700">
                      {metadata.internalLinkSuggestions.map((link, i) => (
                        <li key={i}>→ {link}</li>
                      ))}
                    </ul>
                  </DashCard>
                )}
            </div>
          )}
        </div>
      )}

      {tab === "social" && (
        <div className="space-y-4">
          <DashCard>
            <p className="text-xs text-slate-500 mb-3">
              Hashtag packs, video hooks, captions, posting times, and visual
              ideas for any platform — generated against your firm voice.{" "}
              <span className="italic">
                Heads up: this uses Claude&apos;s general platform knowledge, not
                live trending data. For &ldquo;what sound is hot today&rdquo; use the
                TikTok / Discover launcher on /community.
              </span>
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700">Topic / story angle</label>
                <DashInput
                  value={socialTopic}
                  onChange={(e) => setSocialTopic(e.target.value)}
                  placeholder="e.g. Why severance offers usually leave money on the table"
                  className="w-full mt-1"
                />
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-48">
                  <label className="text-xs font-medium text-slate-700">Platform</label>
                  <DashSelect
                    value={socialPlatform}
                    onChange={(e) => setSocialPlatform(e.target.value as SocialPlatform)}
                    className="w-full mt-1"
                  >
                    <option value="tiktok">TikTok</option>
                    <option value="instagram">Instagram (Reels + Feed)</option>
                    <option value="youtube_shorts">YouTube Shorts</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="twitter">X / Twitter</option>
                    <option value="facebook">Facebook</option>
                  </DashSelect>
                </div>
                <DashButton onClick={fetchSocial} disabled={loading || !socialTopic.trim()}>
                  {loading ? <DashSpinner /> : "Generate playbook"}
                </DashButton>
              </div>
            </div>
          </DashCard>

          {playbook && (
            <div className="space-y-3">
              {playbook.hashtags && (
                <DashCard>
                  <h3 className="text-sm font-semibold mb-3">Hashtag pack</h3>
                  {playbook.hashtags.broad && playbook.hashtags.broad.length > 0 && (
                    <div className="mb-3">
                      <div className="text-xs font-medium text-slate-700 mb-1">Broad</div>
                      <div className="flex flex-wrap gap-1">
                        {playbook.hashtags.broad.map((h, i) => (
                          <DashPill key={i} tone="blue">
                            {h.startsWith("#") ? h : `#${h}`}
                          </DashPill>
                        ))}
                      </div>
                    </div>
                  )}
                  {playbook.hashtags.niche && playbook.hashtags.niche.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-slate-700 mb-1">Niche / geo</div>
                      <div className="flex flex-wrap gap-1">
                        {playbook.hashtags.niche.map((h, i) => (
                          <DashPill key={i} tone="violet">
                            {h.startsWith("#") ? h : `#${h}`}
                          </DashPill>
                        ))}
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() =>
                      copy(
                        [
                          ...(playbook.hashtags?.broad ?? []),
                          ...(playbook.hashtags?.niche ?? []),
                        ]
                          .map((h) => (h.startsWith("#") ? h : `#${h}`))
                          .join(" "),
                        "hashtags",
                      )
                    }
                    className="mt-3 text-xs px-2 py-1 rounded border border-slate-300 hover:border-slate-400"
                  >
                    {copied === "hashtags" ? "✓ Copied all" : "Copy all hashtags"}
                  </button>
                </DashCard>
              )}

              {playbook.hooks && playbook.hooks.length > 0 && (
                <DashCard>
                  <h3 className="text-sm font-semibold mb-2">Video hooks</h3>
                  <div className="space-y-2">
                    {playbook.hooks.map((h, i) => (
                      <div
                        key={i}
                        className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-md p-3 flex items-start justify-between gap-2"
                      >
                        <span className="whitespace-pre-wrap">{h}</span>
                        <button
                          onClick={() => copy(h, `hook-${i}`)}
                          className="shrink-0 text-xs px-2 py-1 rounded border border-slate-300 hover:border-slate-400"
                        >
                          {copied === `hook-${i}` ? "✓" : "Copy"}
                        </button>
                      </div>
                    ))}
                  </div>
                </DashCard>
              )}

              {playbook.captions && playbook.captions.length > 0 && (
                <DashCard>
                  <h3 className="text-sm font-semibold mb-2">Caption variants</h3>
                  <div className="space-y-2">
                    {playbook.captions.map((c, i) => (
                      <div
                        key={i}
                        className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-md p-3 flex items-start justify-between gap-2"
                      >
                        <span className="whitespace-pre-wrap">{c}</span>
                        <button
                          onClick={() => copy(c, `cap-${i}`)}
                          className="shrink-0 text-xs px-2 py-1 rounded border border-slate-300 hover:border-slate-400"
                        >
                          {copied === `cap-${i}` ? "✓" : "Copy"}
                        </button>
                      </div>
                    ))}
                  </div>
                </DashCard>
              )}

              {playbook.visual_ideas && playbook.visual_ideas.length > 0 && (
                <DashCard>
                  <h3 className="text-sm font-semibold mb-2">Visual treatment ideas</h3>
                  <ul className="space-y-2 text-sm text-slate-700">
                    {playbook.visual_ideas.map((v, i) => (
                      <li
                        key={i}
                        className="flex items-start justify-between gap-2 bg-slate-50 border border-slate-200 rounded-md p-3"
                      >
                        <span className="whitespace-pre-wrap">{v}</span>
                        <a
                          href={`/content/images?prompt=${encodeURIComponent(v)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 text-xs px-2 py-1 rounded border border-slate-300 hover:border-slate-400 hover:bg-white"
                        >
                          Create image
                        </a>
                      </li>
                    ))}
                  </ul>
                </DashCard>
              )}

              {playbook.platform_tips && playbook.platform_tips.length > 0 && (
                <DashCard>
                  <h3 className="text-sm font-semibold mb-2 text-emerald-700">Platform tips</h3>
                  <ul className="space-y-1 text-sm text-slate-700 list-disc pl-5">
                    {playbook.platform_tips.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </DashCard>
              )}

              {playbook.best_times && (
                <DashCard>
                  <h3 className="text-sm font-semibold mb-2">Best times to post</h3>
                  <p className="text-sm text-slate-700">{playbook.best_times}</p>
                </DashCard>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  id,
  copied,
  onCopy,
}: {
  label: string;
  value: string | undefined;
  id: string;
  copied: string | null;
  onCopy: (v: string, k: string) => void;
}) {
  if (!value) return null;
  return (
    <div>
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <div className="mt-1 flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
        <p className="text-xs font-mono text-slate-900 truncate">{value}</p>
        <button
          onClick={() => onCopy(value, id)}
          className="shrink-0 text-xs px-2 py-1 rounded border border-slate-300 hover:border-slate-400"
        >
          {copied === id ? "✓" : "Copy"}
        </button>
      </div>
    </div>
  );
}
