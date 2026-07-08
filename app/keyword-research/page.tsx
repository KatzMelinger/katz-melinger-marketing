"use client";

/**
 * Keyword Research page for Huraqan.
 *
 * Four tabs: Discover / Expand / Competitor Gaps / Tracked.
 *
 * Uses plain Tailwind utility classes only — no shadcn UI primitives, no
 * lucide icons. Matches the project's existing aesthetic (the marketing nav
 * uses Unicode glyphs the same way).
 */

import { useEffect, useRef, useState } from "react";

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
  title,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "outline";
  className?: string;
  title?: string;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const variants: Record<string, string> = {
    primary: "bg-foreground text-background hover:opacity-90",
    ghost: "hover:bg-black/5 dark:hover:bg-white/10",
    outline: "border border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

function DifficultyBadge({ d }: { d: number | null | undefined }) {
  if (d === null || d === undefined) {
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-black/5 dark:bg-white/10 opacity-70">
        —
      </span>
    );
  }
  const color =
    d >= 70
      ? "bg-red-500/15 text-red-700 dark:text-red-400"
      : d >= 40
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
      : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  const label = d >= 70 ? "Hard" : d >= 40 ? "Medium" : "Easy";
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {d} ({label})
    </span>
  );
}

function IntentBadge({ intent }: { intent: string }) {
  const colors: Record<string, string> = {
    informational: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    commercial: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
    transactional: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    navigational: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
        colors[intent] || "bg-black/5 dark:bg-white/10"
      }`}
    >
      {intent}
    </span>
  );
}
function HistoryDropdown({
  jobType,
  onSelect,
  describeJob,
}: {
  jobType: "discover" | "expand" | "competitor-gaps";
  onSelect: (result: any) => void;
  describeJob: (params: any) => string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Lazy-load history the first time the dropdown opens, and refresh on each
  // open after that. Keeps the data fresh when the user opens it after a new
  // run has finished.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/keyword-research/history?type=${encodeURIComponent(jobType)}&limit=10`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        setJobs(data.jobs || []);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, jobType]);

  // Close on outside click
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const formatTime = (iso: string | null) => {
    if (!iso) return "—";
    const date = new Date(iso);
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div ref={ref} className="relative">
      <Button
        variant="outline"
        onClick={() => setOpen((p) => !p)}
        className="text-xs"
      >
        <span aria-hidden>🕒</span>
        Recent
        <span aria-hidden className="opacity-60">{open ? "▴" : "▾"}</span>
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 max-h-96 overflow-y-auto bg-background border border-black/15 dark:border-white/15 rounded-md shadow-lg z-10">
          {loading && (
            <div className="p-3 text-xs opacity-70 flex items-center gap-2">
              <Spinner /> Loading history…
            </div>
          )}
          {error && (
            <div className="p-3 text-xs text-red-700 dark:text-red-400">{error}</div>
          )}
          {!loading && !error && jobs && jobs.length === 0 && (
            <div className="p-3 text-xs opacity-70 italic">
              No past runs yet. Run one to see it here.
            </div>
          )}
          {!loading && !error && jobs && jobs.length > 0 && (
            <ul className="py-1">
              {jobs.map((job) => (
                <li key={job.id}>
                  <button
                    className="w-full text-left px-3 py-2 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                    onClick={() => {
                      onSelect(job.result);
                      setOpen(false);
                    }}
                  >
                    <div className="text-sm font-medium truncate">
                      {describeJob(job.request_params)}
                    </div>
                    <div className="text-xs opacity-60 mt-0.5">
                      {formatTime(job.completed_at)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-xs opacity-50 hover:opacity-100 transition-opacity"
      title="Copy"
    >
      {copied ? "✓" : "⎘"}
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

// ---------- top-level page -------------------------------------------------

export default function KeywordResearchPage() {
  const [activeTab, setActiveTab] = useState<Tab>("discover");
  // Deep-link support: /keyword-research?seed=<keyword> lands on Discover with
  // the seed prefilled (e.g. from a Competitor Gaps row). Read from the URL on
  // mount — no useSearchParams, so no Suspense boundary needed on this page.
  const [initialSeed, setInitialSeed] = useState("");
  useEffect(() => {
    const seed = new URLSearchParams(window.location.search).get("seed");
    if (seed) {
      setInitialSeed(seed);
      setActiveTab("discover");
    }
  }, []);

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "discover", label: "Discover", icon: "⌕" },
    { id: "expand", label: "Expand", icon: "✦" },
    { id: "gaps", label: "Competitor Gaps", icon: "◎" },
    { id: "tracked", label: "Tracked", icon: "☑" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Keyword Research</h1>
        <p className="text-sm opacity-70 mt-1">
          AI-powered keyword discovery, cluster expansion, competitive gap analysis,
          and live rank tracking via DataForSEO.
        </p>
      </div>

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

      {activeTab === "discover" && <DiscoverTab initialSeed={initialSeed} />}
      {activeTab === "expand" && <ExpandTab />}
      {activeTab === "gaps" && <GapsTab />}
      {activeTab === "tracked" && <TrackedTab />}
    </div>
  );
}

// ---------- Discover tab ---------------------------------------------------

function DiscoverTab({ initialSeed = "" }: { initialSeed?: string }) {
  const [seedKeyword, setSeedKeyword] = useState(initialSeed);
  // The parent resolves the ?seed= param in a mount effect, after this tab has
  // already mounted with "", so adopt the seed when it arrives. Deliberately
  // does NOT auto-run discovery — the user clicks Discover when ready, so a
  // click-through from another page never kicks off a surprise AI job.
  useEffect(() => {
    if (initialSeed) setSeedKeyword(initialSeed);
  }, [initialSeed]);
  const [practiceArea, setPracticeArea] = useState("All");
  const [intent, setIntent] = useState("all");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ elapsed: number; status: string }>({
    elapsed: 0,
    status: "",
  });
  const [sortBy, setSortBy] = useState<"volume" | "difficulty" | "relevance">("relevance");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleDiscover = async () => {
    setLoading(true);
    setError(null);
    setResults(null);
    setProgress({ elapsed: 0, status: "starting" });

    try {
      // Step 1: kick off the job. Returns immediately with a jobId.
      const startRes = await fetch("/api/keyword-research/discover/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seedKeyword: seedKeyword || undefined,
          practiceArea,
          intent,
          count: 20,
        }),
      });

      if (!startRes.ok) {
        const data = await startRes.json().catch(() => ({}));
        throw new Error(data.error || `Failed to start: ${startRes.status}`);
      }

      const { jobId } = await startRes.json();
      if (!jobId) throw new Error("No job ID returned");

      // Step 2: poll the status endpoint every 3 seconds. Cap at 5 minutes total.
      const startTime = Date.now();
      const maxWaitMs = 5 * 60 * 1000; // 5 minutes
      const pollIntervalMs = 3000;

      while (Date.now() - startTime < maxWaitMs) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));

        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setProgress({ elapsed, status: "generating" });

        const statusRes = await fetch(
          `/api/keyword-research/discover/status?id=${encodeURIComponent(jobId)}`,
        );

        if (!statusRes.ok) {
          // Don't fail the whole thing on one bad poll — try again
          continue;
        }

        const statusData = await statusRes.json();

        if (statusData.status === "done") {
          setResults(statusData.result);
          setProgress({ elapsed, status: "done" });
          return;
        }

        if (statusData.status === "failed") {
          throw new Error(statusData.error || "Generation failed");
        }

        // status is "pending" or "running" — keep polling
      }

      throw new Error("Timed out waiting for AI response (5 minutes). Try again or simplify your query.");
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
            <label className="text-xs font-medium opacity-70">Seed Keyword (optional)</label>
            <input
              className="w-full bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              placeholder="e.g., employment lawyer NYC"
              value={seedKeyword}
              onChange={(e) => setSeedKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleDiscover()}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium opacity-70">Practice Area</label>
            <select
              className="w-full bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              value={practiceArea}
              onChange={(e) => setPracticeArea(e.target.value)}
            >
              {PRACTICE_AREAS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium opacity-70">Search Intent</label>
            <select
              className="w-full bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
            >
              {INTENTS.map((i) => (
                <option key={i.id} value={i.id}>{i.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={handleDiscover} disabled={loading} className="flex-1">
              {loading ? <Spinner /> : <span aria-hidden>⌕</span>}
              Discover Keywords
            </Button>
            <HistoryDropdown
              jobType="discover"
              onSelect={(result) => { setResults(result); setError(null); }}
              describeJob={(p) => {
                const parts: string[] = [];
                if (p?.seedKeyword) parts.push(`"${p.seedKeyword}"`);
                if (p?.practiceArea && p.practiceArea !== "All") parts.push(p.practiceArea);
                if (p?.intent && p.intent !== "all") parts.push(p.intent);
                return parts.length > 0 ? parts.join(" · ") : "All practice areas";
              }}
            />
          </div>
        </div>
      </Card>

      {error && (
        <div className="text-red-700 dark:text-red-400 text-sm bg-red-500/10 p-3 rounded-md">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Spinner className="text-2xl" />
          <p className="text-sm opacity-70">
            Analyzing keyword opportunities…{" "}
            {progress.elapsed > 0 && (
              <span className="opacity-60">({progress.elapsed}s)</span>
            )}
          </p>
          <p className="text-xs opacity-50">
            AI generation typically takes 60-120 seconds.
          </p>
        </div>
      )}

      {results && !loading && (
        <div className="space-y-6">
          {results.summary && (
            <Card className="p-4 bg-blue-500/5 border-blue-500/30">
              <div className="flex items-start gap-3">
                <span className="text-lg" aria-hidden>💡</span>
                <p className="text-sm">{results.summary}</p>
              </div>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {results.quickWins?.length > 0 && (
              <Card className="p-4">
                <h3 className="font-medium flex items-center gap-2 mb-3">
                  <span aria-hidden>⚡</span> Quick Wins
                </h3>
                <div className="space-y-2">
                  {results.quickWins.map((qw: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-sm bg-black/5 dark:bg-white/5 rounded-md p-2.5">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{qw.keyword}</span>
                          <CopyButton text={qw.keyword} />
                        </div>
                        <p className="text-xs opacity-70 mt-0.5">{qw.reason}</p>
                      </div>
                      <div className="flex items-center gap-3 text-xs opacity-70 shrink-0 ml-3">
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
                  <span aria-hidden>📈</span> High-Value Targets
                </h3>
                <div className="space-y-2">
                  {results.highValueTargets.map((hv: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-sm bg-black/5 dark:bg-white/5 rounded-md p-2.5">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{hv.keyword}</span>
                          <CopyButton text={hv.keyword} />
                        </div>
                        <p className="text-xs opacity-70 mt-0.5">{hv.strategy}</p>
                      </div>
                      <div className="flex items-center gap-3 text-xs opacity-70 shrink-0 ml-3">
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
              <div className="p-4 border-b border-black/10 dark:border-white/10">
                <h3 className="font-medium">All Keywords ({sortedKeywords.length})</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase bg-black/5 dark:bg-white/5 opacity-70">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Keyword</th>
                      <th className="px-4 py-3 text-left font-medium cursor-pointer" onClick={() => toggleSort("volume")}>
                        Volume {sortBy === "volume" && (sortDir === "desc" ? "↓" : "↑")}
                      </th>
                      <th className="px-4 py-3 text-left font-medium cursor-pointer" onClick={() => toggleSort("difficulty")}>
                        Difficulty {sortBy === "difficulty" && (sortDir === "desc" ? "↓" : "↑")}
                      </th>
                      <th className="px-4 py-3 text-left font-medium">Intent</th>
                      <th className="px-4 py-3 text-left font-medium cursor-pointer" onClick={() => toggleSort("relevance")}>
                        Relevance {sortBy === "relevance" && (sortDir === "desc" ? "↓" : "↑")}
                      </th>
                      <th className="px-4 py-3 text-left font-medium">Practice Area</th>
                      <th className="px-4 py-3 text-left font-medium">Content Suggestion</th>
                      <th className="px-4 py-3 text-left font-medium">Track</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedKeywords.map((kw: any, i: number) => (
                      <tr key={i} className="border-t border-black/5 dark:border-white/5 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{kw.keyword}</span>
                            <CopyButton text={kw.keyword} />
                          </div>
                        </td>
                        <td className="px-4 py-3 opacity-70">{kw.volume?.toLocaleString() || "—"}</td>
                        <td className="px-4 py-3"><DifficultyBadge d={kw.difficulty || 0} /></td>
                        <td className="px-4 py-3"><IntentBadge intent={kw.intent || "informational"} /></td>
                        <td className="px-4 py-3">
                          <div className="w-16 bg-black/10 dark:bg-white/10 rounded-full h-2">
                            <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${kw.relevance || 0}%` }} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs opacity-70">{kw.practiceArea || "—"}</td>
                        <td className="px-4 py-3 text-xs opacity-70 max-w-[200px] truncate">{kw.contentSuggestion || "—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <TrackButton keyword={kw.keyword} practiceArea={kw.practiceArea} compact />
                            <SendToOpportunitiesButton keyword={kw.keyword} searchVolume={kw.volume} compact />
                          </div>
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
                <span aria-hidden>📄</span> Content Gaps
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {results.contentGaps.map((gap: any, i: number) => (
                  <div key={i} className="bg-black/5 dark:bg-white/5 rounded-md p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">{gap.topic}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full border border-black/15 dark:border-white/15 capitalize">
                        {gap.priority}
                      </span>
                    </div>
                    <p className="text-xs opacity-70 mb-2">Format: {gap.contentFormat}</p>
                    <div className="flex flex-wrap gap-1">
                      {gap.suggestedKeywords?.map((kw: string, j: number) => (
                        <span key={j} className="text-xs bg-blue-500/10 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full">{kw}</span>
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
  const [progress, setProgress] = useState<{ elapsed: number }>({ elapsed: 0 });
  const [open, setOpen] = useState<Record<string, boolean>>({
    longTail: true, questions: true, local: true, semantic: false, competitor: false,
  });

  const handleExpand = async () => {
    if (!keyword.trim()) return;
    setLoading(true);
    setError(null);
    setResults(null);
    setProgress({ elapsed: 0 });

    try {
      const startRes = await fetch("/api/keyword-research/expand/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword }),
      });

      if (!startRes.ok) {
        const data = await startRes.json().catch(() => ({}));
        throw new Error(data.error || `Failed to start: ${startRes.status}`);
      }

      const { jobId } = await startRes.json();
      if (!jobId) throw new Error("No job ID returned");

      const startTime = Date.now();
      const maxWaitMs = 5 * 60 * 1000;
      const pollIntervalMs = 3000;

      while (Date.now() - startTime < maxWaitMs) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setProgress({ elapsed });

        const statusRes = await fetch(
          `/api/keyword-research/expand/status?id=${encodeURIComponent(jobId)}`,
        );
        if (!statusRes.ok) continue;

        const statusData = await statusRes.json();
        if (statusData.status === "done") {
          setResults(statusData.result);
          return;
        }
        if (statusData.status === "failed") {
          throw new Error(statusData.error || "Generation failed");
        }
      }

      throw new Error("Timed out waiting for AI response (5 minutes).");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const sections = [
    { key: "longTail", label: "Long-Tail Variations", icon: "→" },
    { key: "questions", label: "Question Keywords", icon: "?" },
    { key: "local", label: "Local Variations (NYC/NJ)", icon: "⌖" },
    { key: "semantic", label: "Semantic / Related", icon: "✦" },
    { key: "competitor", label: "Competitor Keywords", icon: "◎" },
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      <Card className="p-5">
        <div className="flex gap-4">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium opacity-70">Keyword to Expand</label>
            <input
              className="w-full bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              placeholder="e.g., wrongful termination"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleExpand()}
            />
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={handleExpand} disabled={loading || !keyword.trim()}>
              {loading ? <Spinner /> : <span aria-hidden>✦</span>}
              Expand
            </Button>
            <HistoryDropdown
              jobType="expand"
              onSelect={(result) => { setResults(result); setError(null); }}
              describeJob={(p) => p?.keyword ? `"${p.keyword}"` : "Untitled"}
            />
          </div>
        </div>
      </Card>

      {error && <div className="text-red-700 dark:text-red-400 text-sm bg-red-500/10 p-3 rounded-md">{error}</div>}

      {loading && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Spinner className="text-2xl" />
          <p className="text-sm opacity-70">
            Building keyword cluster for &quot;{keyword}&quot;…{" "}
            {progress.elapsed > 0 && (
              <span className="opacity-60">({progress.elapsed}s)</span>
            )}
          </p>
          <p className="text-xs opacity-50">AI generation typically takes 60-120 seconds.</p>
        </div>
      )}

      {results && !loading && (
        <div className="space-y-4">
          {sections.map(({ key, label, icon }) => {
            const items = results[key] || [];
            if (items.length === 0) return null;
            const isOpen = open[key];
            return (
              <Card key={key} className="overflow-hidden">
                <button
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors"
                  onClick={() => setOpen((p) => ({ ...p, [key]: !p[key] }))}
                >
                  <div className="flex items-center gap-2">
                    <span aria-hidden>{icon}</span>
                    <span className="font-medium text-sm">{label}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full border border-black/15 dark:border-white/15">
                      {items.length}
                    </span>
                  </div>
                  <span aria-hidden>{isOpen ? "▴" : "▾"}</span>
                </button>
                {isOpen && (
                  <div className="border-t border-black/10 dark:border-white/10">
                    {items.map((item: any, i: number) => (
                      <div key={i} className="px-4 py-2.5 flex items-center justify-between border-t border-black/5 dark:border-white/5 first:border-t-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{item.keyword}</span>
                          <CopyButton text={item.keyword} />
                          <TrackButton keyword={item.keyword} compact />
                          <SendToOpportunitiesButton keyword={item.keyword} searchVolume={item.volume} compact />
                        </div>
                        <div className="flex items-center gap-4 text-xs opacity-70">
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
                <span aria-hidden>📊</span> Content Strategy
              </h3>
              <div className="space-y-3 text-sm">
                {results.contentStrategy.pillarPage && (
                  <div>
                    <span className="opacity-70">Pillar Page:</span>{" "}
                    <span className="font-medium">{results.contentStrategy.pillarPage}</span>
                  </div>
                )}
                {results.contentStrategy.supportingArticles?.length > 0 && (
                  <div>
                    <span className="opacity-70 block mb-1">Supporting Articles:</span>
                    <ul className="space-y-1 ml-4 list-disc">
                      {results.contentStrategy.supportingArticles.map((a: string, i: number) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {results.contentStrategy.internalLinkingPlan && (
                  <div>
                    <span className="opacity-70">Linking Plan:</span>{" "}
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
  const [progress, setProgress] = useState<{ elapsed: number }>({ elapsed: 0 });

  const handleAnalyze = async () => {
    setLoading(true);
    setError(null);
    setResults(null);
    setProgress({ elapsed: 0 });

    try {
      const competitorList = competitors.split(",").map((c) => c.trim()).filter(Boolean);

      const startRes = await fetch("/api/keyword-research/competitor-gaps/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ competitors: competitorList }),
      });

      if (!startRes.ok) {
        const data = await startRes.json().catch(() => ({}));
        throw new Error(data.error || `Failed to start: ${startRes.status}`);
      }

      const { jobId } = await startRes.json();
      if (!jobId) throw new Error("No job ID returned");

      const startTime = Date.now();
      const maxWaitMs = 5 * 60 * 1000;
      const pollIntervalMs = 3000;

      while (Date.now() - startTime < maxWaitMs) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setProgress({ elapsed });

        const statusRes = await fetch(
          `/api/keyword-research/competitor-gaps/status?id=${encodeURIComponent(jobId)}`,
        );
        if (!statusRes.ok) continue;

        const statusData = await statusRes.json();
        if (statusData.status === "done") {
          setResults(statusData.result);
          return;
        }
        if (statusData.status === "failed") {
          throw new Error(statusData.error || "Generation failed");
        }
      }

      throw new Error("Timed out waiting for AI response (5 minutes).");
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
            <label className="text-xs font-medium opacity-70">
              Competitor Domains (optional, comma-separated)
            </label>
            <input
              className="w-full bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              placeholder="e.g., phillipsandassociates.com, nycemploymentlawyer.com"
              value={competitors}
              onChange={(e) => setCompetitors(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
            />
            <p className="text-xs opacity-60">
              Leave empty to analyze against typical NYC/NJ employment law competitors
            </p>
          </div>
         <div className="flex items-end gap-2">
            <Button onClick={handleAnalyze} disabled={loading}>
              {loading ? <Spinner /> : <span aria-hidden>◎</span>}
              Analyze Gaps
            </Button>
            <HistoryDropdown
              jobType="competitor-gaps"
              onSelect={(result) => { setResults(result); setError(null); }}
              describeJob={(p) => {
                const list = Array.isArray(p?.competitors) ? p.competitors : [];
                if (list.length === 0) return "Default competitors";
                if (list.length === 1) return list[0];
                return `${list[0]} +${list.length - 1} more`;
              }}
            />
          </div>
        </div>
      </Card>

      {error && <div className="text-red-700 dark:text-red-400 text-sm bg-red-500/10 p-3 rounded-md">{error}</div>}

      {loading && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Spinner className="text-2xl" />
          <p className="text-sm opacity-70">
            Analyzing competitive keyword gaps…{" "}
            {progress.elapsed > 0 && (
              <span className="opacity-60">({progress.elapsed}s)</span>
            )}
          </p>
          <p className="text-xs opacity-50">AI generation typically takes 60-120 seconds.</p>
        </div>
      )}

      {results && !loading && (
        <div className="space-y-6">
          {results.actionPlan && (
            <Card className="p-4 bg-blue-500/5 border-blue-500/30">
              <div className="flex items-start gap-3">
                <span className="text-lg" aria-hidden>💡</span>
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
                <span aria-hidden>◎</span> Competitor Keywords to Target
              </h3>
              <div className="space-y-2">
                {results.competitorKeywords.map((ck: any, i: number) => (
                  <div key={i} className="bg-black/5 dark:bg-white/5 rounded-md p-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{ck.keyword}</span>
                        <CopyButton text={ck.keyword} />
                        <TrackButton keyword={ck.keyword} compact />
                        <SendToOpportunitiesButton keyword={ck.keyword} searchVolume={ck.volume} competitor={ck.competitor ?? ck.domain} compact />
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="opacity-70">{ck.volume?.toLocaleString()} /mo</span>
                        <DifficultyBadge d={ck.difficulty || 0} />
                      </div>
                    </div>
                    <p className="text-xs opacity-70">{ck.ourOpportunity}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {results.emergingTrends?.length > 0 && (
            <Card className="p-4">
              <h3 className="font-medium flex items-center gap-2 mb-3">
                <span aria-hidden>📈</span> Emerging Trends
              </h3>
              <div className="space-y-2">
                {results.emergingTrends.map((t: any, i: number) => (
                  <div key={i} className="bg-black/5 dark:bg-white/5 rounded-md p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">{t.trend}</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${
                          t.timing === "act now"
                            ? "border-red-500/50 text-red-700 dark:text-red-400"
                            : t.timing === "next quarter"
                            ? "border-amber-500/50 text-amber-700 dark:text-amber-400"
                            : "border-black/20 dark:border-white/20"
                        }`}>{t.timing}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${
                          t.growthPotential === "high"
                            ? "border-emerald-500/50 text-emerald-700 dark:text-emerald-400"
                            : "border-black/20 dark:border-white/20"
                        }`}>{t.growthPotential} growth</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {t.relatedKeywords?.map((kw: string, j: number) => (
                        <span key={j} className="text-xs bg-blue-500/10 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full">{kw}</span>
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
                  <span aria-hidden>💡</span> Underserved Topics
                </h3>
                <div className="space-y-2">
                  {results.underservedTopics.map((t: any, i: number) => (
                    <div key={i} className="bg-black/5 dark:bg-white/5 rounded-md p-3 text-sm">
                      <div className="font-medium mb-1">{t.topic}</div>
                      <p className="text-xs opacity-70 mb-1">{t.contentApproach}</p>
                      <p className="text-xs opacity-70">Est. volume: {t.estimatedTotalVolume?.toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {results.localOpportunities?.length > 0 && (
              <Card className="p-4">
                <h3 className="font-medium flex items-center gap-2 mb-3">
                  <span aria-hidden>⌖</span> Local Opportunities
                </h3>
                <div className="space-y-2">
                  {results.localOpportunities.map((l: any, i: number) => (
                    <div key={i} className="bg-black/5 dark:bg-white/5 rounded-md p-3 text-sm">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{l.keyword}</span>
                          <CopyButton text={l.keyword} />
                          <TrackButton keyword={l.keyword} compact />
                          <SendToOpportunitiesButton keyword={l.keyword} searchVolume={l.volume} compact />
                        </div>
                        <DifficultyBadge d={l.difficulty || 0} />
                      </div>
                      <p className="text-xs opacity-70">{l.tactic}</p>
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
      const res = await fetch("/api/seo/tracked-keywords");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setItems(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!newKeyword.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/seo/tracked-keywords", {
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
      const res = await fetch("/api/seo/tracked-keywords/refresh", { method: "POST" });
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
      const res = await fetch(`/api/seo/tracked-keywords/${id}`, { method: "DELETE" });
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
            <label className="text-xs font-medium opacity-70">Add a keyword to track</label>
            <input
              className="w-full bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              placeholder="e.g., unpaid overtime lawyer nyc"
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
          </div>
          <div className="space-y-1 md:w-64">
            <label className="text-xs font-medium opacity-70">Practice Area</label>
            <select
              className="w-full bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              value={newPracticeArea}
              onChange={(e) => setNewPracticeArea(e.target.value)}
            >
              {PRACTICE_AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={handleAdd} disabled={adding || !newKeyword.trim()}>
              {adding ? <Spinner /> : <span aria-hidden>+</span>}
              Add
            </Button>
            <Button onClick={handleRefresh} disabled={refreshing || items.length === 0} variant="outline">
              {refreshing ? <Spinner /> : <span aria-hidden>↻</span>}
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      {error && <div className="text-red-700 dark:text-red-400 text-sm bg-red-500/10 p-3 rounded-md">{error}</div>}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Spinner className="text-2xl" />
          <p className="text-sm opacity-70">Loading tracked keywords…</p>
        </div>
      ) : items.length === 0 ? (
        <Card className="p-8 text-center text-sm opacity-70">
          No tracked keywords yet. Add one above, or click the &quot;+&quot; button next to
          any keyword in Discover, Expand, or Competitor Gaps.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase bg-black/5 dark:bg-white/5 opacity-70">
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
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-black/5 dark:border-white/5 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{item.keyword}</span>
                        <CopyButton text={item.keyword} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs opacity-70">{item.practice_area || "—"}</td>
                    <td className="px-4 py-3">
                      {item.current_rank !== null ? (
                        <span className="font-medium">#{item.current_rank}</span>
                      ) : (
                        <span className="opacity-60">Not ranked</span>
                      )}
                    </td>
                    <td className="px-4 py-3"><RankMovement previous={item.previous_rank} current={item.current_rank} /></td>
                    <td className="px-4 py-3 opacity-70">{item.search_volume?.toLocaleString() || "—"}</td>
                    <td className="px-4 py-3"><DifficultyBadge d={item.difficulty} /></td>
                    <td className="px-4 py-3 text-xs opacity-70 max-w-[200px] truncate">
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {item.url.replace(/^https?:\/\//, "")}
                        </a>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs opacity-70">
                      {item.last_checked_at ? new Date(item.last_checked_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        className="opacity-50 hover:opacity-100 hover:text-red-600 transition-colors text-base"
                        onClick={() => handleDelete(item.id)}
                        title="Delete"
                      >
                        ×
                      </button>
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

function RankMovement({ previous, current }: { previous: number | null; current: number | null }) {
  if (previous === null || current === null) {
    return <span className="opacity-60 text-xs">—</span>;
  }
  const delta = previous - current;
  if (delta === 0) {
    return <span className="text-xs opacity-70">— 0</span>;
  }
  if (delta > 0) {
    return <span className="text-xs text-emerald-700 dark:text-emerald-400">↑ {delta}</span>;
  }
  return <span className="text-xs text-red-700 dark:text-red-400">↓ {Math.abs(delta)}</span>;
}

// ---------- Track button ---------------------------------------------------

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
      const res = await fetch("/api/seo/tracked-keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword,
          practiceArea: practiceArea && practiceArea !== "All" ? practiceArea : null,
        }),
      });
      if (!res.ok && res.status !== 409) throw new Error("Failed");
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2000);
    }
  };

  if (compact) {
    return (
      <button
        className="text-xs opacity-50 hover:opacity-100 transition-opacity"
        title="Track this keyword"
        onClick={handleClick}
      >
        {state === "saving" ? <Spinner /> : state === "saved" ? "✓" : "+"}
      </button>
    );
  }

  return (
    <Button onClick={handleClick} disabled={state === "saving"} variant="outline" className="text-xs px-2 py-1">
      {state === "saving" ? <Spinner /> : state === "saved" ? <>✓ Tracked</> : <>+ Track</>}
    </Button>
  );
}

/**
 * Promotes a researched keyword into the SEO Opportunity Radar (source "manual")
 * so it can follow the Create Brief → Production Board flow. Closes the dead-end
 * where keywords found in research had nowhere to go but the tracked list.
 */
function SendToOpportunitiesButton({
  keyword,
  searchVolume,
  competitor,
  compact,
}: {
  keyword: string;
  searchVolume?: number | null;
  competitor?: string | null;
  compact?: boolean;
}) {
  const [state, setState] = useState<"idle" | "saving" | "sent" | "exists" | "error">("idle");

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setState("saving");
    try {
      const res = await fetch("/api/seo/opportunities/from-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword,
          searchVolume: typeof searchVolume === "number" ? searchVolume : undefined,
          competitor: competitor ?? undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      const json = await res.json();
      setState(json.alreadyExists ? "exists" : "sent");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2000);
    }
  };

  const label =
    state === "saving" ? (
      <Spinner />
    ) : state === "sent" ? (
      "✓ In Opportunities"
    ) : state === "exists" ? (
      "Already there"
    ) : state === "error" ? (
      "Failed"
    ) : compact ? (
      "→ Opportunities"
    ) : (
      "→ Send to Opportunities"
    );

  return (
    <button
      className="text-xs text-blue-600 hover:text-blue-800 hover:underline disabled:opacity-50 transition-colors whitespace-nowrap"
      title="Add to the SEO Opportunity Radar so you can create a brief and draft from it"
      onClick={handleClick}
      disabled={state === "saving"}
    >
      {label}
    </button>
  );
}