"use client";

/**
 * Community Engagement.
 *
 * Five tabs:
 *   Reddit       — auto-scan, scoring, Claude-drafted replies, status persistence
 *   Hacker News  — auto-scan via Algolia, same response flow
 *   News         — Google News headlines for reactive content (no replies)
 *   Quora        — bot-protected: launcher links + paste-question pattern
 *   Avvo         — same paste-question pattern
 *
 * Posts you mark Responded / Skipped persist via community_post_status and
 * are filtered out of future scans (toggle "Show all" to see them).
 */

import { useEffect, useMemo, useState } from "react";

import {
  ComplianceNotice,
  type ComplianceNoticeData,
} from "@/components/compliance-notice";
import {
  DashCard,
  DashButton,
  DashSpinner,
  DashPill,
} from "@/components/dashboard-ui";

type Tab = "reddit" | "hackernews" | "news" | "youtube" | "tiktok" | "quora" | "avvo";
type PostStatus = "new" | "responded" | "skipped" | "starred";

type YouTubePost = {
  id: string;
  title: string;
  snippet: string;
  url: string;
  videoId: string;
  videoTitle: string;
  channelTitle: string;
  author: string;
  videoViews: number;
  likes: number;
  created: number;
  relevanceScore: number;
  matchedKeywords: string[];
};

type RedditPost = {
  id: string;
  title: string;
  snippet: string;
  url: string;
  subreddit: string;
  author: string;
  created: number;
  relevanceScore: number;
  matchedKeywords: string[];
};

type HNPost = {
  id: string;
  title: string;
  snippet: string;
  url: string;
  externalUrl: string | null;
  author: string;
  points: number;
  numComments: number;
  created: number;
  relevanceScore: number;
  matchedKeywords: string[];
};

type NewsItem = {
  id: string;
  title: string;
  snippet: string;
  url: string;
  publisher: string;
  created: number;
  matchedKeywords: string[];
  relevanceScore: number;
};

type StatusMap = Record<string, { status: PostStatus; notes: string | null; marked_at: string }>;

function timeAgo(ts: number): string {
  const seconds = Math.floor(Date.now() / 1000 - ts);
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function relevanceTone(s: number): "emerald" | "amber" | "blue" {
  if (s >= 60) return "emerald";
  if (s >= 30) return "amber";
  return "blue";
}

function relevanceLabel(s: number): string {
  if (s >= 60) return "High match";
  if (s >= 30) return "Medium match";
  return "Low match";
}

export default function CommunityPage() {
  const [tab, setTab] = useState<Tab>("reddit");

  return (
    <>
    <div className="px-4 py-8 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Community engagement</h1>
        <p className="text-sm text-slate-600 mt-1 max-w-2xl">
          Find employment-law discussions across Reddit, Hacker News, news
          sites, Quora, and Avvo. Draft Claude-powered replies in the firm's
          voice. Mark posts as responded/skipped so they don't clutter future scans.
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200 mb-6 overflow-x-auto">
        {[
          { id: "reddit", label: "Reddit" },
          { id: "hackernews", label: "Hacker News" },
          { id: "youtube", label: "YouTube" },
          { id: "news", label: "News (NY/NJ)" },
          { id: "tiktok", label: "TikTok" },
          { id: "quora", label: "Quora" },
          { id: "avvo", label: "Avvo" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as Tab)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-[1px] whitespace-nowrap ${
              tab === t.id
                ? "border-[#185FA5] text-[#185FA5]"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "reddit" && <RedditTab />}
      {tab === "hackernews" && <HackerNewsTab />}
      {tab === "youtube" && <YouTubeTab />}
      {tab === "news" && <NewsTab />}
      {tab === "tiktok" && <TikTokTab />}
      {(tab === "quora" || tab === "avvo") && <PasteTab platform={tab} />}
    </div>
    </>
  );
}

type ScanItem = (RedditPost | HNPost | YouTubePost) & { __platform: "reddit" | "hackernews" | "youtube" };

function ScannerTab({
  platform,
  scanUrl,
  emptyHint,
  parseResults,
  renderHeader,
}: {
  platform: "reddit" | "hackernews" | "youtube";
  scanUrl: string;
  emptyHint: string;
  parseResults: (data: unknown) => ScanItem[];
  renderHeader: (post: ScanItem) => React.ReactNode;
}) {
  const [items, setItems] = useState<ScanItem[]>([]);
  const [statuses, setStatuses] = useState<StatusMap>({});
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [filter, setFilter] = useState<"all" | "high" | "medium">("all");
  const [showHandled, setShowHandled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatuses = async () => {
    // Best-effort overlay: a failed/non-JSON response must not reject unhandled
    // (this runs from a mount effect) or crash the tab — just skip the update.
    try {
      const res = await fetch(`/api/community/statuses?platform=${platform}`);
      if (!res.ok) return;
      const data = await res.json();
      setStatuses(data.statuses ?? {});
    } catch (e) {
      console.warn("[community] status refresh failed:", e);
    }
  };

  useEffect(() => {
    refreshStatuses();
  }, [platform]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch(scanUrl);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Scan failed");
      setItems(parseResults(data));
      setScanned(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const setStatus = async (postId: string, status: PostStatus) => {
    setStatuses((prev) => ({
      ...prev,
      [postId]: { status, notes: null, marked_at: new Date().toISOString() },
    }));
    await fetch(`/api/community/posts/${encodeURIComponent(postId)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform, status }),
    });
  };

  const filtered = useMemo(() => {
    return items
      .filter((p) => {
        if (filter === "high") return p.relevanceScore >= 60;
        if (filter === "medium") return p.relevanceScore >= 30;
        return true;
      })
      .filter((p) => {
        if (showHandled) return true;
        const s = statuses[p.id]?.status;
        return s !== "responded" && s !== "skipped";
      })
      .sort((a, b) => {
        const aStarred = statuses[a.id]?.status === "starred" ? 1 : 0;
        const bStarred = statuses[b.id]?.status === "starred" ? 1 : 0;
        if (aStarred !== bStarred) return bStarred - aStarred;
        return b.relevanceScore - a.relevanceScore;
      });
  }, [items, filter, showHandled, statuses]);

  const high = items.filter((p) => p.relevanceScore >= 60).length;
  const med = items.filter((p) => p.relevanceScore >= 30 && p.relevanceScore < 60).length;
  const handled = items.filter((p) => {
    const s = statuses[p.id]?.status;
    return s === "responded" || s === "skipped";
  }).length;

  if (!scanned && !scanning) {
    return (
      <DashCard className="text-center py-10 space-y-3">
        <div className="text-3xl" aria-hidden>
          🔎
        </div>
        <h3 className="text-lg font-semibold">Start a scan</h3>
        <p className="text-sm text-slate-600 max-w-md mx-auto">{emptyHint}</p>
        <DashButton onClick={runScan}>Start scan</DashButton>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </DashCard>
    );
  }

  if (scanning && items.length === 0) {
    return (
      <DashCard className="text-center py-12">
        <DashSpinner /> Scanning…
      </DashCard>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Filter:</span>
          {(["all", "high", "medium"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-2 py-1 rounded-full border ${
                filter === f
                  ? "border-[#185FA5] text-[#185FA5] bg-[#185FA5]/5"
                  : "border-slate-200 text-slate-600 hover:border-slate-400"
              }`}
            >
              {f === "all" ? "All" : f === "high" ? "High match" : "Medium+"}
            </button>
          ))}
          <label className="text-xs text-slate-600 ml-2 inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={showHandled}
              onChange={(e) => setShowHandled(e.target.checked)}
            />
            Show responded/skipped
          </label>
          <span className="text-xs text-slate-500 ml-2">
            Showing {filtered.length} of {items.length} ({handled} handled)
          </span>
        </div>
        <button
          onClick={runScan}
          disabled={scanning}
          className="text-xs px-3 py-1.5 rounded-md border border-slate-300 hover:border-[#185FA5] hover:text-[#185FA5] disabled:opacity-50"
        >
          {scanning ? "Rescanning…" : "Rescan"}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total found" value={items.length} />
        <Stat label="High relevance" value={high} tone="emerald" />
        <Stat label="Medium relevance" value={med} tone="amber" />
        <Stat label="Handled" value={handled} />
      </div>

      <div className="space-y-3">
        {filtered.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            status={statuses[p.id]?.status ?? "new"}
            renderHeader={renderHeader}
            onStatusChange={(s) => setStatus(p.id, s)}
          />
        ))}
      </div>
    </div>
  );
}

function PostCard({
  post,
  status,
  renderHeader,
  onStatusChange,
}: {
  post: ScanItem;
  status: PostStatus;
  renderHeader: (post: ScanItem) => React.ReactNode;
  onStatusChange: (s: PostStatus) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<{
    text: string;
    warning: string;
    compliance?: ComplianceNoticeData | null;
  } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showDraft, setShowDraft] = useState(false);
  const [copied, setCopied] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const generate = async () => {
    setGenerating(true);
    setDraftError(null);
    try {
      const res = await fetch("/api/community/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: post.__platform === "hackernews" ? "reddit" : post.__platform,
          title: post.title,
          body: post.snippet,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setDraft({ text: data.text, warning: data.warning, compliance: data.compliance });
        setShowDraft(true);
      } else {
        setDraftError(data?.error || "Couldn't draft a response. Try again.");
      }
    } catch {
      setDraftError("Couldn't reach the drafting service. Try again.");
    } finally {
      setGenerating(false);
    }
  };

  const copy = async () => {
    if (!draft) return;
    await navigator.clipboard.writeText(draft.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <DashCard className={status === "starred" ? "border-amber-300" : ""}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            {renderHeader(post)}
            <DashPill tone={relevanceTone(post.relevanceScore)}>
              {relevanceLabel(post.relevanceScore)} · {post.relevanceScore}
            </DashPill>
            <span className="text-xs text-slate-500">{timeAgo(post.created)}</span>
            {status === "responded" && <DashPill tone="emerald">✓ responded</DashPill>}
            {status === "skipped" && <DashPill tone="neutral">skipped</DashPill>}
            {status === "starred" && <DashPill tone="amber">★ starred</DashPill>}
          </div>
          <a
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-slate-900 hover:text-[#185FA5] hover:underline"
          >
            {post.title}
          </a>
        </div>
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-[#185FA5] hover:text-[#185FA5] shrink-0"
        >
          ↗ Open
        </a>
      </div>

      {post.snippet && (
        <div className="mt-2">
          <p className={`text-xs text-slate-600 ${expanded ? "" : "line-clamp-2"}`}>
            {post.snippet}
          </p>
          {post.snippet.length > 150 && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="text-xs text-[#185FA5] hover:underline mt-1"
            >
              {expanded ? "Show less" : "Read more"}
            </button>
          )}
        </div>
      )}

      {post.matchedKeywords.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {post.matchedKeywords.map((k, i) => (
            <span
              key={i}
              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 text-slate-600 border border-slate-200"
            >
              {k}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {!draft ? (
          <DashButton variant="outline" onClick={generate} disabled={generating}>
            {generating ? <DashSpinner /> : "✦ Draft response"}
          </DashButton>
        ) : (
          <button
            onClick={() => setShowDraft((s) => !s)}
            className="text-xs px-3 py-1.5 rounded-md border border-[#185FA5] text-[#185FA5]"
          >
            {showDraft ? "Hide draft" : "Show draft"}
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => onStatusChange("starred")}
            className={`text-xs px-2 py-1 rounded border ${
              status === "starred"
                ? "border-amber-400 bg-amber-50 text-amber-700"
                : "border-slate-300 text-slate-600 hover:border-amber-400 hover:text-amber-700"
            }`}
          >
            ★ Star
          </button>
          <button
            onClick={() => onStatusChange("responded")}
            className={`text-xs px-2 py-1 rounded border ${
              status === "responded"
                ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                : "border-slate-300 text-slate-600 hover:border-emerald-400 hover:text-emerald-700"
            }`}
          >
            ✓ Responded
          </button>
          <button
            onClick={() => onStatusChange("skipped")}
            className={`text-xs px-2 py-1 rounded border ${
              status === "skipped"
                ? "border-slate-400 bg-slate-100 text-slate-700"
                : "border-slate-300 text-slate-600 hover:border-slate-400"
            }`}
          >
            Skip
          </button>
          {status !== "new" && (
            <button
              onClick={() => onStatusChange("new")}
              className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-500 hover:text-slate-700"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {draftError && (
        <div className="mt-2 text-[11px] text-rose-800 bg-rose-50 border border-rose-200 rounded-md px-2 py-1">
          ⚠ {draftError}
        </div>
      )}

      {showDraft && draft && (
        <div className="mt-3 border-t border-slate-200 pt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-[#185FA5]">✦ Suggested response</span>
            <button
              onClick={copy}
              className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-slate-400"
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
          </div>
          <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed bg-slate-50 rounded-md p-3">
            {draft.text}
          </div>
          <div className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
            ⚠ {draft.warning}
          </div>
          <ComplianceNotice compliance={draft.compliance} className="mt-2" />
        </div>
      )}
    </DashCard>
  );
}

function RedditTab() {
  return (
    <ScannerTab
      platform="reddit"
      scanUrl="/api/community/reddit/scan"
      emptyHint="Pulls recent posts from 11 employment-law-relevant subreddits and scores each for NY/NJ relevance."
      parseResults={(data) => {
        const d = data as { posts?: RedditPost[] };
        return (d.posts ?? []).map((p) => ({ ...p, __platform: "reddit" as const }));
      }}
      renderHeader={(p) => {
        const r = p as RedditPost & { __platform: "reddit" };
        return <DashPill tone="amber">r/{r.subreddit}</DashPill>;
      }}
    />
  );
}

function HackerNewsTab() {
  return (
    <ScannerTab
      platform="hackernews"
      scanUrl="/api/community/hackernews/scan"
      emptyHint="Searches HN (via Algolia, no API key needed) for severance, layoffs, RSU, non-compete, harassment, and other tech-worker employment topics."
      parseResults={(data) => {
        const d = data as { posts?: HNPost[] };
        return (d.posts ?? []).map((p) => ({ ...p, __platform: "hackernews" as const }));
      }}
      renderHeader={(p) => {
        const h = p as HNPost & { __platform: "hackernews" };
        return (
          <>
            <DashPill tone="violet">HN</DashPill>
            <span className="text-xs text-slate-500">▲ {h.points} · 💬 {h.numComments}</span>
          </>
        );
      }}
    />
  );
}

function YouTubeTab() {
  return (
    <ScannerTab
      platform="youtube"
      scanUrl="/api/community/youtube/scan"
      emptyHint="Searches YouTube for recent employment-law videos and surfaces the highest-engagement comments worth jumping into. Requires YOUTUBE_API_KEY (free Google API)."
      parseResults={(data) => {
        const d = data as { posts?: YouTubePost[] };
        return (d.posts ?? []).map((p) => ({ ...p, __platform: "youtube" as const }));
      }}
      renderHeader={(p) => {
        const y = p as YouTubePost & { __platform: "youtube" };
        return (
          <>
            <DashPill tone="red">YT</DashPill>
            <span className="text-xs text-slate-500 truncate max-w-[280px]">
              {y.channelTitle}
            </span>
            <span className="text-xs text-slate-500">▲ {y.likes}</span>
          </>
        );
      }}
    />
  );
}

function NewsTab() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/community/news/scan");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Scan failed");
      setItems(data.items ?? []);
      setScanned(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  if (!scanned && !scanning) {
    return (
      <DashCard className="text-center py-10 space-y-3">
        <div className="text-3xl" aria-hidden>
          📰
        </div>
        <h3 className="text-lg font-semibold">NY/NJ employment-law news</h3>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          Pulls Google News for recent NY/NJ employment-law headlines. Use
          these as news pegs for reactive content (blog posts, social posts).
          One-click "Use as topic" sends a story into the multi-format generator.
        </p>
        <DashButton onClick={runScan}>Pull headlines</DashButton>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </DashCard>
    );
  }

  if (scanning) {
    return (
      <DashCard className="text-center py-12">
        <DashSpinner /> Pulling headlines…
      </DashCard>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">{items.length} headlines</span>
        <button
          onClick={runScan}
          disabled={scanning}
          className="text-xs px-3 py-1.5 rounded-md border border-slate-300 hover:border-[#185FA5] hover:text-[#185FA5] disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
      {items.map((item) => (
        <DashCard key={item.id}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <DashPill tone="blue">{item.publisher || "Unknown"}</DashPill>
                <DashPill tone={relevanceTone(item.relevanceScore)}>{relevanceLabel(item.relevanceScore)}</DashPill>
                <span className="text-xs text-slate-500">{timeAgo(item.created)}</span>
              </div>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-slate-900 hover:text-[#185FA5] hover:underline"
              >
                {item.title}
              </a>
              {item.snippet && (
                <p className="text-xs text-slate-600 mt-1 line-clamp-3">{item.snippet}</p>
              )}
              {item.matchedKeywords.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {item.matchedKeywords.map((k, i) => (
                    <span
                      key={i}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 text-slate-600 border border-slate-200"
                    >
                      {k}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <a
                href={`/content/batch?topic=${encodeURIComponent(item.title)}`}
                className="text-xs px-2 py-1 rounded border border-[#185FA5] text-[#185FA5] hover:bg-[#185FA5]/5"
              >
                → Use as topic
              </a>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-slate-400 text-center"
              >
                ↗ Read
              </a>
            </div>
          </div>
        </DashCard>
      ))}
    </div>
  );
}

function TikTokTab() {
  const [links, setLinks] = useState<{ label: string; url: string }[]>([]);

  useEffect(() => {
    fetch("/api/community/links?platform=tiktok")
      .then((r) => r.json())
      .then((d) => setLinks(d.links ?? []))
      .catch(() => setLinks([]));
  }, []);

  const hashtags = links.filter((l) => l.label.startsWith("#"));
  const searches = links.filter((l) => l.label.startsWith("Search"));
  const discover = links.filter((l) => !l.label.startsWith("#") && !l.label.startsWith("Search"));

  return (
    <div className="space-y-4">
      <DashCard>
        <h3 className="text-sm font-semibold mb-2">Browse trending TikTok</h3>
        <p className="text-xs text-slate-600 mb-3">
          TikTok blocks automated scraping of comments and trending sounds, so
          this is a curated launcher: jump straight to the hashtag and search
          pages most relevant for the firm. For producing your own TikTok
          videos (hooks, hashtag packs, captions, visual ideas), use{" "}
          <a
            href="/content/intelligence?tab=social"
            className="text-[#185FA5] underline"
          >
            Content Studio → Intelligence → Social media IQ
          </a>
          .
        </p>

        {hashtags.length > 0 && (
          <div className="mb-4">
            <div className="text-xs font-medium text-slate-700 mb-2">Topic hashtags</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {hashtags.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs px-3 py-2 rounded-md border border-slate-300 hover:border-[#185FA5] hover:text-[#185FA5] flex items-center justify-between"
                >
                  <span className="truncate">{link.label}</span>
                  <span className="text-slate-400 text-xs">↗</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {searches.length > 0 && (
          <div className="mb-4">
            <div className="text-xs font-medium text-slate-700 mb-2">Search the firm's niche</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {searches.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs px-3 py-2 rounded-md border border-slate-300 hover:border-[#185FA5] hover:text-[#185FA5] flex items-center justify-between"
                >
                  <span className="truncate">{link.label}</span>
                  <span className="text-slate-400 text-xs">↗</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {discover.length > 0 && (
          <div>
            <div className="text-xs font-medium text-slate-700 mb-2">Discover what's hot</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {discover.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs px-3 py-2 rounded-md border border-slate-300 hover:border-[#185FA5] hover:text-[#185FA5] flex items-center justify-between"
                >
                  <span className="truncate">{link.label}</span>
                  <span className="text-slate-400 text-xs">↗</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </DashCard>

      <DashCard>
        <h3 className="text-sm font-semibold mb-2">How to use this</h3>
        <ol className="text-xs text-slate-700 list-decimal pl-5 space-y-1">
          <li>Click into a hashtag — see what's trending. Note the angles, hooks, and styles.</li>
          <li>Save anything that sparks an idea (TikTok's bookmark feature works well here).</li>
          <li>Open <a href="/content/intelligence?tab=social" className="text-[#185FA5] underline">Social media IQ</a>, paste the angle as a topic, pick TikTok, and Claude generates hashtag pack + 3 video hooks + 5 caption variants + visual treatment ideas.</li>
          <li>Shoot the video, post it, link to your firm bio.</li>
        </ol>
      </DashCard>
    </div>
  );
}

function PasteTab({ platform }: { platform: "quora" | "avvo" }) {
  const [links, setLinks] = useState<{ label: string; url: string }[]>([]);
  const [text, setText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [response, setResponse] = useState<{
    text: string;
    warning: string;
    compliance?: ComplianceNoticeData | null;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/community/links?platform=${platform}`)
      .then((r) => r.json())
      .then((d) => setLinks(d.links ?? []))
      .catch(() => setLinks([]));
  }, [platform]);

  const generate = async () => {
    if (!text.trim()) return;
    setGenerating(true);
    setError(null);
    setResponse(null);
    try {
      const res = await fetch("/api/community/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, title: text.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Generate failed");
      setResponse({ text: data.text, warning: data.warning, compliance: data.compliance });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generate failed");
    } finally {
      setGenerating(false);
    }
  };

  const copy = async () => {
    if (!response) return;
    await navigator.clipboard.writeText(response.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const platformName = platform === "quora" ? "Quora" : "Avvo";

  return (
    <div className="space-y-4">
      <DashCard>
        <h3 className="text-sm font-semibold mb-2">Browse {platformName} topics</h3>
        <p className="text-xs text-slate-600 mb-3">
          {platformName} blocks automated scanning, so we can't scan it for you.
          Browse the topic pages below, find a worth-answering question, then
          paste it into the panel below for an AI-suggested response.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {links.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-3 py-2 rounded-md border border-slate-300 hover:border-[#185FA5] hover:text-[#185FA5] flex items-center justify-between"
            >
              <span className="truncate">{link.label}</span>
              <span className="text-slate-400 text-xs">↗</span>
            </a>
          ))}
        </div>
      </DashCard>

      <DashCard>
        <h3 className="text-sm font-semibold mb-2">Draft a response</h3>
        <p className="text-xs text-slate-600 mb-3">
          Paste a {platformName} question and Claude will draft a reply in the
          firm's voice with proper {platformName} etiquette.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Paste a ${platformName} question here…`}
          rows={6}
          className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30 focus:border-[#185FA5]"
        />
        <div className="mt-3 flex items-center gap-2">
          <DashButton onClick={generate} disabled={generating || !text.trim()}>
            {generating ? <DashSpinner /> : "✦ Generate response"}
          </DashButton>
          {text && (
            <button
              onClick={() => {
                setText("");
                setResponse(null);
                setError(null);
              }}
              className="text-xs text-slate-500 hover:text-slate-900"
            >
              Clear
            </button>
          )}
        </div>
        {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
      </DashCard>

      {response && (
        <DashCard>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-[#185FA5]">
              ✦ Suggested response for {platformName}
            </span>
            <button
              onClick={copy}
              className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-slate-400"
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
          </div>
          <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed bg-slate-50 rounded-md p-4 border border-slate-200">
            {response.text}
          </div>
          <div className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            ⚠ {response.warning}
          </div>
          <ComplianceNotice compliance={response.compliance} className="mt-3" />
        </DashCard>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "amber";
}) {
  const color =
    tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-slate-900";
  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-white">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}
