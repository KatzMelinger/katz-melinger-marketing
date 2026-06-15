"use client";

/**
 * Content Production — the unified board (one page, 3 tabs, configurable kanban).
 *
 * Reads /api/content-production, which assembles the view from the team's
 * existing tables (seo_opportunities + content_pipeline) — no spine (Option C;
 * see docs/content-production-board-decisions.md). The New-content kanban columns
 * come from the tenant's workflow_stages, so a second firm can rename/reorder
 * with no code change.
 *
 * Stage 3: card actions REUSE the existing components — opportunity cards open
 * the KmBriefWizard ("Create brief"); pipeline cards open the DraftDrawer
 * ("Review draft" / approve / publish). No workflow logic is rebuilt here.
 * Optimize/Repurpose remain read-only placeholders until the Stage-6 wiring.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { DraftDrawer } from "@/components/draft-drawer";
import { KmBriefWizard, type WizardOpportunity } from "@/components/km-brief-wizard";

type Stage = { kind: string; label: string; order: number };
type Pillar = { id: string; label: string };
type Item = {
  id: string;
  title: string;
  stageKind: string;
  tab: "new" | "existing";
  source: "opportunity" | "pipeline" | "page";
  pillarId: string | null;
  practiceArea: string | null;
  assetType: string | null;
  bucket: string | null;
  url: string | null;
  draftId: string | null;
  needsReview: boolean;
  intent: string | null;
  competitor: string | null;
  searchVolume: number | null;
  pipelineId: number | null;
  rawStatus: string | null;
  keywords: string | null;
  rankDrop?: number;
  currentRank?: number | null;
  previousRank?: number | null;
};
type Payload = {
  stages: Stage[];
  buckets: { id: string; label: string }[];
  pillars: Pillar[];
  items: Item[];
  counts: { new: number; existing: number; needsReview: number };
  error?: string;
};

const TABS = [
  { id: "new", label: "New content" },
  { id: "optimize", label: "Optimize" },
  { id: "repurpose", label: "Repurpose" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const ASSET_LABEL: Record<string, string> = {
  practice_page: "Practice Page",
  blog_post: "Blog",
  case_result: "Case Result",
};

// Build the inputs the existing components expect.
function toWizardOpportunity(i: Item): WizardOpportunity {
  return {
    id: i.id,
    keyword: i.title,
    practiceArea: i.practiceArea,
    recommendedContentType: i.assetType,
    intent: i.intent,
    pillarId: i.pillarId,
    competitor: i.competitor,
    searchVolume: i.searchVolume,
  };
}
type DrawerItem = {
  id: number;
  draft_id: string | null;
  status: "idea" | "brief" | "draft" | "review" | "published";
  title: string;
  bucket?: string | null;
  keywords?: string | null;
};
function toDrawerItem(i: Item): DrawerItem {
  return {
    id: i.pipelineId ?? 0,
    draft_id: i.draftId,
    status: (i.rawStatus ?? "idea") as DrawerItem["status"],
    title: i.title,
    bucket: i.bucket,
    keywords: i.keywords,
  };
}

export default function ContentProductionPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("new");
  const [wizardOpp, setWizardOpp] = useState<WizardOpportunity | null>(null);
  const [reviewItem, setReviewItem] = useState<DrawerItem | null>(null);
  const [posting, setPosting] = useState<string | null>(null);
  const [postMsg, setPostMsg] = useState<{ id: string; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/content-production", { cache: "no-store" });
      const json = (await res.json()) as Payload;
      if (!res.ok) throw new Error(json?.error || "Failed to load");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pillarLabel = useMemo(() => {
    const m = new Map((data?.pillars ?? []).map((p) => [p.id, p.label]));
    return (id: string | null) => (id ? m.get(id) ?? id : null);
  }, [data?.pillars]);

  const stages = data?.stages ?? [];
  const newItems = (data?.items ?? []).filter((i) => i.tab === "new");
  const existingItems = (data?.items ?? []).filter((i) => i.tab === "existing");

  const onCreateBrief = (i: Item) => setWizardOpp(toWizardOpportunity(i));
  const onReview = (i: Item) => setReviewItem(toDrawerItem(i));
  const onGeneratePosts = async (i: Item) => {
    setPosting(i.id);
    setPostMsg(null);
    try {
      const res = await fetch("/api/content-production/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: i.title, practiceArea: i.practiceArea }),
      });
      const json = await res.json();
      setPostMsg({ id: i.id, text: json.message || (res.ok ? "Done" : json.error || "Failed") });
    } catch {
      setPostMsg({ id: i.id, text: "Failed to generate posts" });
    } finally {
      setPosting(null);
    }
  };

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900">Content Production</h1>
        <p className="text-sm text-slate-500">
          One board — create, review, approve, and publish content.
        </p>
      </header>

      <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Counter label="New-content items" value={data?.counts.new ?? 0} />
        <Counter label="Published / existing" value={data?.counts.existing ?? 0} />
        <Counter label="Needs review (no pillar)" value={data?.counts.needsReview ?? 0} tone="amber" />
        <Counter label="Total tracked" value={(data?.items ?? []).length} />
      </section>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.id
                ? "border-brand text-brand"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {loading && <p className="text-sm text-slate-500">Loading…</p>}

      {!loading && tab === "new" && (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${stages.length || 5}, minmax(220px, 1fr))` }}
        >
          {stages.map((stage) => {
            const colItems = newItems.filter((i) => i.stageKind === stage.kind);
            return (
              <div key={stage.kind} className="rounded-lg bg-slate-50 p-2">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-sm font-semibold text-slate-700">{stage.label}</span>
                  <span className="rounded-full bg-slate-200 px-2 text-xs text-slate-600">{colItems.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {colItems.map((i) => (
                    <Card
                      key={`${i.source}-${i.id}`}
                      item={i}
                      pillarLabel={pillarLabel}
                      onCreateBrief={onCreateBrief}
                      onReview={onReview}
                    />
                  ))}
                  {colItems.length === 0 && <p className="px-1 py-2 text-xs text-slate-400">—</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && (tab === "optimize" || tab === "repurpose") && (
        <div>
          <p className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {tab === "optimize"
              ? "Optimize — published pages that dropped in ranking (current vs previous tracked rank)."
              : "Repurpose — published pages to update, translate, or turn into social posts (Mon/Wed/Fri scheduler)."}{" "}
            Showing {existingItems.length} existing page(s) currently tracked.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(tab === "optimize"
              ? [...existingItems].sort((a, b) => (b.rankDrop ?? 0) - (a.rankDrop ?? 0))
              : existingItems
            ).map((i) => (
              <Card
                key={`${i.source}-${i.id}`}
                item={i}
                pillarLabel={pillarLabel}
                showUrl
                onGeneratePosts={tab === "repurpose" ? onGeneratePosts : undefined}
                posting={posting === i.id}
                postMsg={postMsg?.id === i.id ? postMsg.text : null}
              />
            ))}
            {existingItems.length === 0 && (
              <p className="text-xs text-slate-400">No existing pages tracked yet.</p>
            )}
          </div>
        </div>
      )}

      {wizardOpp && (
        <KmBriefWizard
          opportunity={wizardOpp}
          onClose={() => setWizardOpp(null)}
          onGenerated={() => {
            setWizardOpp(null);
            load();
          }}
        />
      )}

      {reviewItem && (
        <DraftDrawer
          item={reviewItem}
          onClose={() => setReviewItem(null)}
          onChanged={load}
        />
      )}
    </main>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone?: "amber" }) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        tone === "amber" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"
      }`}
    >
      <div className="text-xl font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function Card({
  item,
  pillarLabel,
  showUrl,
  onCreateBrief,
  onReview,
  onGeneratePosts,
  posting,
  postMsg,
}: {
  item: Item;
  pillarLabel: (id: string | null) => string | null;
  showUrl?: boolean;
  onCreateBrief?: (item: Item) => void;
  onReview?: (item: Item) => void;
  onGeneratePosts?: (item: Item) => void;
  posting?: boolean;
  postMsg?: string | null;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-2 text-sm shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-slate-800">{item.title}</span>
        {item.source === "pipeline" && (
          <span className="rounded bg-slate-100 px-1 text-[10px] uppercase text-slate-500">board</span>
        )}
      </div>
      {showUrl && item.url && <div className="mt-0.5 truncate text-xs text-slate-400">{item.url}</div>}
      <div className="mt-1.5 flex flex-wrap gap-1">
        {item.assetType && (
          <span className="rounded bg-blue-50 px-1.5 text-[11px] text-blue-700">
            {ASSET_LABEL[item.assetType] ?? item.assetType}
          </span>
        )}
        {item.needsReview ? (
          <span className="rounded bg-amber-100 px-1.5 text-[11px] text-amber-700">Needs review</span>
        ) : (
          item.pillarId && (
            <span className="rounded bg-emerald-50 px-1.5 text-[11px] text-emerald-700">
              {pillarLabel(item.pillarId)}
            </span>
          )
        )}
        {item.bucket && <span className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-600">{item.bucket}</span>}
        {item.rankDrop != null && (
          <span className="rounded bg-red-50 px-1.5 text-[11px] text-red-700">
            ▼ {item.rankDrop} pos{item.currentRank != null ? ` (now #${item.currentRank})` : ""}
          </span>
        )}
      </div>
      {(onCreateBrief && item.source === "opportunity") || (onReview && item.source === "pipeline") ? (
        <div className="mt-2">
          {item.source === "opportunity" && onCreateBrief && (
            <button
              onClick={() => onCreateBrief(item)}
              className="w-full rounded border border-brand px-2 py-1 text-[12px] font-medium text-brand hover:bg-brand/5"
            >
              Create brief →
            </button>
          )}
          {item.source === "pipeline" && onReview && (
            <button
              onClick={() => onReview(item)}
              className="w-full rounded border border-brand px-2 py-1 text-[12px] font-medium text-brand hover:bg-brand/5"
            >
              {item.stageKind === "approve" ? "Review → Publish →" : "Review draft →"}
            </button>
          )}
        </div>
      ) : null}
      {onGeneratePosts && (
        <div className="mt-2">
          <button
            onClick={() => onGeneratePosts(item)}
            disabled={posting}
            className="w-full rounded border border-brand px-2 py-1 text-[12px] font-medium text-brand hover:bg-brand/5 disabled:opacity-50"
          >
            {posting ? "Generating…" : "Generate 3 posts → Scheduler"}
          </button>
          {postMsg && <p className="mt-1 text-[11px] text-slate-500">{postMsg}</p>}
        </div>
      )}
    </div>
  );
}
