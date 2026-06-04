"use client";

/**
 * Claude-powered marketing recommendations.
 *
 * Tab-based: Active | Done | Hold | Disregard | History.
 *
 *   - Generate creates new active items and skips anything already marked
 *     done or disregarded (so Claude doesn't keep re-proposing rejected work).
 *   - Each card has buttons to park the recommendation in Done / Hold /
 *     Disregard, or push it back to Active.
 *   - History keeps the legacy per-batch view so the user can still see what
 *     a previous run produced.
 *
 * State lives in Supabase (`recommendation_items`); the UI just renders.
 */

import { useCallback, useEffect, useState } from "react";

import { MarketingNav } from "@/components/marketing-nav";

type StatusTab = "active" | "done" | "hold" | "disregard";

type RecCategory = "seo" | "aeo" | "content" | "technical" | "local" | "social";
type RecEffort = "low" | "medium" | "high";
type RecImpact = "low" | "medium" | "high";

type Item = {
  id: string;
  title: string;
  rationale: string;
  category: RecCategory;
  effort: RecEffort;
  impact: RecImpact;
  evidence: string;
  status: StatusTab;
  sourceGenerationId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type HistoryItem = {
  id: string;
  rec_count: number;
  evidence: { aeoRows?: number; keywords?: number; cannibalization?: number };
  created_at: string;
};

type GenerateResult = {
  recommendations: unknown[];
  evidence: { aeoRows: number; keywords: number; cannibalization: number };
  itemsInserted: number;
  itemsSkipped: number;
  suppressedCount: number;
  generatedAt: string;
};

function Pill({
  tone,
  children,
}: {
  tone: "emerald" | "red" | "amber" | "blue" | "violet" | "neutral";
  children: React.ReactNode;
}) {
  const colors: Record<string, string> = {
    emerald: "bg-emerald-500/15 text-emerald-700",
    red: "bg-red-500/15 text-red-700",
    amber: "bg-amber-500/15 text-amber-700",
    blue: "bg-blue-500/15 text-blue-700",
    violet: "bg-violet-500/15 text-violet-700",
    neutral: "bg-slate-100 text-slate-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${colors[tone]}`}>
      {children}
    </span>
  );
}

function impactTone(s: string): "emerald" | "amber" | "neutral" {
  if (s === "high") return "emerald";
  if (s === "medium") return "amber";
  return "neutral";
}
function effortTone(s: string): "blue" | "amber" | "red" {
  if (s === "low") return "blue";
  if (s === "medium") return "amber";
  return "red";
}
function categoryTone(c: string): "violet" | "blue" | "amber" | "emerald" | "neutral" {
  if (c === "aeo") return "violet";
  if (c === "seo") return "blue";
  if (c === "content") return "emerald";
  if (c === "technical") return "amber";
  return "neutral";
}

const TABS: { id: StatusTab; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "done", label: "Done" },
  { id: "hold", label: "Hold" },
  { id: "disregard", label: "Disregard" },
];

type CategoryFilter = RecCategory | "all";

const CATEGORIES: { id: CategoryFilter; label: string }[] = [
  { id: "all", label: "All sources" },
  { id: "seo", label: "SEO" },
  { id: "aeo", label: "AEO" },
  { id: "content", label: "Content" },
  { id: "technical", label: "Technical" },
  { id: "local", label: "Local" },
  { id: "social", label: "Social" },
];

const VALID_CATEGORIES: RecCategory[] = ["seo", "aeo", "content", "technical", "local", "social"];

export default function RecommendationsPage() {
  const [tab, setTab] = useState<StatusTab | "history">("active");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  // Source filter. `/seo/suggestions` redirects here with `?category=seo`, which
  // is how the old standalone SEO Suggestions queue now lives inside this page.
  const [category, setCategory] = useState<CategoryFilter>("all");

  useEffect(() => {
    try {
      const c = new URLSearchParams(window.location.search).get("category");
      if (c && VALID_CATEGORIES.includes(c as RecCategory)) {
        setCategory(c as RecCategory);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const refreshItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/recommendations/items", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");
      setItems((data.items ?? []) as Item[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/recommendations/history");
      const data = await res.json();
      setHistory(data.history ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refreshItems();
    refreshHistory();
  }, [refreshItems, refreshHistory]);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    setGenStatus(null);
    try {
      const res = await fetch("/api/recommendations/generate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to generate");
      setGenStatus(data as GenerateResult);
      await Promise.all([refreshItems(), refreshHistory()]);
      setTab("active");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate");
    } finally {
      setGenerating(false);
    }
  };

  const setStatus = async (id: string, status: StatusTab) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
    try {
      await fetch(`/api/recommendations/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } catch {
      refreshItems();
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Permanently delete this recommendation?")) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      await fetch(`/api/recommendations/items/${id}`, { method: "DELETE" });
    } catch {
      refreshItems();
    }
  };

  // Apply the source filter before counting/listing so the tab badges reflect
  // the active category.
  const inCategory = category === "all" ? items : items.filter((i) => i.category === category);

  const counts = {
    active: inCategory.filter((i) => i.status === "active").length,
    done: inCategory.filter((i) => i.status === "done").length,
    hold: inCategory.filter((i) => i.status === "hold").length,
    disregard: inCategory.filter((i) => i.status === "disregard").length,
  };

  // Active tab: sort high-impact / low-effort first. Other tabs: most recent first.
  const visible = (
    tab === "history"
      ? []
      : inCategory.filter((i) => i.status === tab).slice()
  ).sort((a, b) => {
    if (tab === "active") {
      const score = (r: Item) =>
        ({ high: 3, medium: 2, low: 1 }[r.impact] ?? 0) -
        ({ high: 2, medium: 1, low: 0 }[r.effort] ?? 0);
      return score(b) - score(a);
    }
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return (
    <>
      <MarketingNav />
      <div className="p-6 space-y-6 mx-auto max-w-7xl">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">AI recommendations</h1>
            <p className="text-sm text-slate-600 mt-1 max-w-2xl">
              Claude reads the firm's latest AEO sweep, tracked SEO keywords, and
              cannibalization snapshot, then suggests prioritized actions.
              Mark items Done, Hold, or Disregard to keep the active list tight —
              Done + Disregard items are skipped on the next Generate.
            </p>
          </div>
          <button
            onClick={generate}
            disabled={generating}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-[#185FA5] text-white hover:bg-[#1f6fb8] disabled:opacity-50"
          >
            {generating ? "Thinking…" : "Generate"}
          </button>
        </div>

        {genStatus && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Added {genStatus.itemsInserted} new active{" "}
            {genStatus.itemsInserted === 1 ? "item" : "items"}
            {genStatus.itemsSkipped > 0
              ? `, skipped ${genStatus.itemsSkipped} duplicate${genStatus.itemsSkipped === 1 ? "" : "s"}`
              : ""}
            {genStatus.suppressedCount > 0
              ? `. Told Claude to avoid ${genStatus.suppressedCount} previously-resolved title${genStatus.suppressedCount === 1 ? "" : "s"}.`
              : "."}
          </div>
        )}

        {error && (
          <div className="border border-red-300 bg-red-50 rounded-md p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-1 border-b border-slate-200">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-[1px] transition-colors ${
                  active
                    ? "border-[#185FA5] text-[#185FA5]"
                    : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
                }`}
              >
                {t.label}{" "}
                <span
                  className={`ml-1 px-1.5 py-0.5 rounded-full text-[11px] ${
                    active ? "bg-[#185FA5]/15 text-[#185FA5]" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {counts[t.id]}
                </span>
              </button>
            );
          })}
          <button
            onClick={() => setTab("history")}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-[1px] transition-colors ${
              tab === "history"
                ? "border-[#185FA5] text-[#185FA5]"
                : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
            }`}
          >
            History
          </button>
        </div>

        {tab !== "history" && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-slate-500 mr-1">Source:</span>
            {CATEGORIES.map((c) => {
              const active = category === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    active
                      ? "border-[#185FA5] bg-[#185FA5]/10 text-[#185FA5]"
                      : "border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900"
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        )}

        {tab === "history" ? (
          history.length === 0 ? (
            <div className="border border-slate-200 rounded-lg p-10 text-center text-sm text-slate-500">
              No past generations yet.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg p-4">
              <div className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-3">
                Past generation batches
              </div>
              <ul className="space-y-1.5">
                {history.map((h) => (
                  <li key={h.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">
                      {new Date(h.created_at).toLocaleString()}
                    </span>
                    <span className="text-xs text-slate-500">
                      {h.rec_count} recommendation{h.rec_count === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )
        ) : loading && items.length === 0 ? (
          <div className="border border-slate-200 rounded-lg p-10 text-center text-sm text-slate-500">
            Loading…
          </div>
        ) : visible.length === 0 ? (
          <div className="border border-slate-200 rounded-lg p-10 text-center space-y-2">
            <div className="text-3xl" aria-hidden>
              ✦
            </div>
            <h3 className="text-lg font-semibold">
              {tab === "active"
                ? "No active recommendations"
                : tab === "done"
                  ? "Nothing marked done yet"
                  : tab === "hold"
                    ? "Nothing on hold"
                    : "Nothing disregarded"}
            </h3>
            <p className="text-sm text-slate-600 max-w-md mx-auto">
              {tab === "active"
                ? "Click Generate to ask Claude for prioritized actions based on your current AEO + SEO data."
                : "Mark items in the Active tab to fill this bucket."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map((r) => (
              <RecCard
                key={r.id}
                item={r}
                onStatus={(s) => setStatus(r.id, s)}
                onDelete={() => remove(r.id)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function RecCard({
  item,
  onStatus,
  onDelete,
}: {
  item: Item;
  onStatus: (s: StatusTab) => void;
  onDelete: () => void;
}) {
  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="text-sm font-medium text-slate-900 min-w-0 flex-1">
          {item.title}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Pill tone={categoryTone(item.category)}>{item.category}</Pill>
          <Pill tone={impactTone(item.impact)}>impact: {item.impact}</Pill>
          <Pill tone={effortTone(item.effort)}>effort: {item.effort}</Pill>
        </div>
      </div>
      <p className="text-xs text-slate-700 mt-2">{item.rationale}</p>
      <p className="text-[11px] text-slate-500 italic mt-2 border-l-2 border-slate-200 pl-2">
        Evidence: {item.evidence}
      </p>

      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2 flex-wrap">
        {item.status !== "active" && (
          <button
            onClick={() => onStatus("active")}
            className="text-xs px-2.5 py-1 rounded border border-slate-300 text-slate-700 hover:border-[#185FA5] hover:text-[#185FA5]"
          >
            ↺ Move back to Active
          </button>
        )}
        {item.status !== "done" && (
          <button
            onClick={() => onStatus("done")}
            className="text-xs px-2.5 py-1 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
          >
            ✓ Done
          </button>
        )}
        {item.status !== "hold" && (
          <button
            onClick={() => onStatus("hold")}
            className="text-xs px-2.5 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-50"
          >
            ⏸ Hold
          </button>
        )}
        {item.status !== "disregard" && (
          <button
            onClick={() => onStatus("disregard")}
            className="text-xs px-2.5 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
          >
            ✕ Disregard
          </button>
        )}
        <button
          onClick={onDelete}
          className="ml-auto text-[11px] text-slate-400 hover:text-red-600"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
