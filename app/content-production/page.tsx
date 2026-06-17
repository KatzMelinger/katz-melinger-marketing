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
import Link from "next/link";

import { DraftDrawer } from "@/components/draft-drawer";
import { KmBriefWizard, type WizardOpportunity } from "@/components/km-brief-wizard";

// The rest of the production line lives one click away from this page, so the
// sidebar carries a single "Content Production" tab instead of five.
const LINE_LINKS: { href: string; label: string; icon: string }[] = [
  { href: "/content/decisions", label: "Content Decisions", icon: "✓" },
  { href: "/content/briefs", label: "Briefs", icon: "📋" },
  { href: "/content/pipeline", label: "Content Studio", icon: "▥" },
  { href: "/content/publishing-qa", label: "Publishing QA", icon: "🔍" },
  { href: "/content/refresh", label: "Refresh Queue", icon: "♻" },
];

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
  suggestionId: string | null;
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
  suggestion_id: string | null;
  status: "idea" | "brief" | "draft" | "review" | "needs_legal" | "approved" | "published";
  title: string;
  bucket?: string | null;
  keywords?: string | null;
};
function toDrawerItem(i: Item): DrawerItem {
  return {
    id: i.pipelineId ?? 0,
    draft_id: i.draftId,
    suggestion_id: i.suggestionId,
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
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

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

  // Fire the autonomous content agent on demand (the same pipeline the Monday
  // cron runs, scoped to this tenant). It drafts → gates → queues for approval;
  // it never publishes. Claude-heavy, so it can take a minute or two.
  const runAgent = useCallback(async () => {
    setRunning(true);
    setRunMsg(null);
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Agent run failed");
      setRunMsg({ tone: "ok", text: j?.summary || "Agent run complete." });
      await load();
    } catch (e) {
      setRunMsg({ tone: "warn", text: e instanceof Error ? e.message : "Agent run failed" });
    } finally {
      setRunning(false);
    }
  }, [load]);

  const pillarLabel = useMemo(() => {
    const m = new Map((data?.pillars ?? []).map((p) => [p.id, p.label]));
    return (id: string | null) => (id ? m.get(id) ?? id : null);
  }, [data?.pillars]);

  const stages = data?.stages ?? [];
  const newItems = (data?.items ?? []).filter((i) => i.tab === "new");
  const existingItems = (data?.items ?? []).filter((i) => i.tab === "existing");

  // The owner's inbox: drafts that cleared the compliance gate and are waiting
  // for a human approve/publish. (needs_legal items are held, not "awaiting".)
  const awaitingApproval = newItems.filter((i) => i.rawStatus === "review").length;
  const heldForLegal = newItems.filter((i) => i.rawStatus === "needs_legal").length;

  const onCreateBrief = (i: Item) => setWizardOpp(toWizardOpportunity(i));
  const onReview = (i: Item) => setReviewItem(toDrawerItem(i));

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Production Board</h1>
          <p className="text-sm text-slate-500">
            One board — create, review, approve, and publish content.
          </p>
        </div>
        <button
          onClick={runAgent}
          disabled={running}
          title="Run the content agent now: it drafts new content, runs the compliance gate, and queues it here for approval. It never publishes."
          className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {running ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Running… (a minute or two)
            </>
          ) : (
            <>✨ Run agent now</>
          )}
        </button>
      </header>

      {runMsg && (
        <div
          className={`mb-4 rounded-md border px-3 py-2 text-sm ${
            runMsg.tone === "warn"
              ? "border-red-300 bg-red-50 text-red-700"
              : "border-emerald-300 bg-emerald-50 text-emerald-800"
          }`}
        >
          {runMsg.text}
        </div>
      )}

      <nav className="mb-5 flex flex-wrap gap-2">
        {LINE_LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-brand hover:text-brand"
          >
            <span aria-hidden>{l.icon}</span>
            {l.label}
          </Link>
        ))}
      </nav>

      <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Counter label="Awaiting your approval" value={awaitingApproval} tone="brand" />
        <Counter label="Held for legal" value={heldForLegal} tone="amber" />
        <Counter label="New-content items" value={data?.counts.new ?? 0} />
        <Counter label="Published / existing" value={data?.counts.existing ?? 0} />
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

      {!loading && tab === "optimize" && (
        <div>
          <p className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Optimize — published pages that dropped in ranking (current vs previous tracked rank).{" "}
            Showing {existingItems.length} existing page(s) currently tracked.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[...existingItems]
              .sort((a, b) => (b.rankDrop ?? 0) - (a.rankDrop ?? 0))
              .map((i) => (
                <Card key={`${i.source}-${i.id}`} item={i} pillarLabel={pillarLabel} showUrl />
              ))}
            {existingItems.length === 0 && (
              <p className="text-xs text-slate-400">No existing pages tracked yet.</p>
            )}
          </div>
        </div>
      )}

      {!loading && tab === "repurpose" && (
        <RepurposePanel onReview={setReviewItem} />
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

type OptMatch = {
  id: string;
  keyword: string;
  intent: string | null;
  searchVolume: number | null;
  recommendedContentType: string | null;
};
type OptPage = {
  url: string;
  title: string | null;
  pageType: string;
  pillarId: string | null;
  pillarLabel: string | null;
  practiceArea: string | null;
  cluster: string;
  clusterKey: string;
  intent: "commercial" | "informational";
  matches: OptMatch[];
  matchedVolume: number;
  inPipeline: boolean;
};
type OptPayload = { pages: OptPage[]; counts: { total: number; withOpportunities: number } };

/**
 * Repurpose tab — published pages we can update day by day. Each page is
 * classified (cluster + commercial/content intent) and matched to the
 * missing-keyword opportunities it could pick up. "Generate update draft"
 * fetches the live page and drafts an updated version (brand voice + matched
 * keywords + internal links), then opens it in the review drawer.
 */
function RepurposePanel({ onReview }: { onReview: (i: DrawerItem) => void }) {
  const [data, setData] = useState<OptPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyUrl, setBusyUrl] = useState<string | null>(null);
  const [socialBusy, setSocialBusy] = useState<string | null>(null);
  const [emailBusy, setEmailBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ url: string; tone: "ok" | "warn"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/content-production/optimize", { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (cancelled) return;
        if (!ok) setErr(j?.error || "Failed to load");
        else setData(j as OptPayload);
      })
      .catch(() => {
        if (!cancelled) setErr("Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const generate = async (p: OptPage) => {
    setBusyUrl(p.url);
    setMsg(null);
    try {
      const res = await fetch("/api/content-production/update-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: p.url,
          title: p.title,
          pillarId: p.pillarId,
          practiceArea: p.practiceArea,
          intent: p.intent,
          keywords: p.matches.map((m) => m.keyword),
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setMsg({ url: p.url, tone: "warn", text: j?.error || "Generation failed." });
        return;
      }
      onReview({
        id: j.pipeline_id ?? 0,
        draft_id: j.draft_id,
        suggestion_id: null,
        status: "draft",
        title: j.title ?? p.title ?? p.url,
        keywords: p.matches.map((m) => m.keyword).join(", "),
      });
    } catch {
      setMsg({ url: p.url, tone: "warn", text: "Generation failed." });
    } finally {
      setBusyUrl(null);
    }
  };

  // Repurpose the page into 3 brand-voice social posts on the Mon/Wed/Fri
  // scheduler (the action that used to live on the old Repurpose tab).
  const generateSocial = async (p: OptPage) => {
    setSocialBusy(p.url);
    setMsg(null);
    try {
      const res = await fetch("/api/content-production/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: p.title || p.url, practiceArea: p.practiceArea }),
      });
      const j = await res.json();
      setMsg({
        url: p.url,
        tone: res.ok ? "ok" : "warn",
        text: j?.message || j?.error || (res.ok ? "Posts generated." : "Failed to generate posts."),
      });
    } catch {
      setMsg({ url: p.url, tone: "warn", text: "Failed to generate posts." });
    } finally {
      setSocialBusy(null);
    }
  };

  // Repurpose the page into a brand-voice email newsletter (saved to Drafts /
  // the Email dashboard; send via Constant Contact).
  const generateEmail = async (p: OptPage) => {
    setEmailBusy(p.url);
    setMsg(null);
    try {
      const res = await fetch("/api/content-production/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: p.title || p.url, practiceArea: p.practiceArea }),
      });
      const j = await res.json();
      setMsg({
        url: p.url,
        tone: res.ok ? "ok" : "warn",
        text: j?.message || j?.error || (res.ok ? "Email draft generated." : "Failed to generate email."),
      });
    } catch {
      setMsg({ url: p.url, tone: "warn", text: "Failed to generate email." });
    } finally {
      setEmailBusy(null);
    }
  };

  if (loading) return <p className="text-sm text-slate-500">Loading published pages…</p>;
  if (err)
    return (
      <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
        {err}
      </div>
    );

  const pages = data?.pages ?? [];
  return (
    <div>
      <p className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
        Repurpose — update an already-published page to the firm&apos;s guidelines. Each page is
        matched to the missing-keyword opportunities it could pick up; “Generate update draft”
        fetches the live page and drafts the update (added keywords + internal links) for review.{" "}
        {data?.counts.withOpportunities ?? 0} of {data?.counts.total ?? 0} page(s) have keyword
        matches.
      </p>
      {pages.length === 0 ? (
        <p className="text-xs text-slate-400">
          No published pages yet — crawl your sitemap on the{" "}
          <Link href="/content/site-map" className="text-brand hover:underline">
            Cluster Map
          </Link>
          .
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {pages.map((p) => (
            <div key={p.url} className="rounded-md border border-slate-200 bg-white p-3 text-sm shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-slate-800">{p.title || p.url}</span>
                <span
                  className={`shrink-0 rounded px-1.5 text-[10px] uppercase ${
                    p.intent === "commercial"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-blue-50 text-blue-700"
                  }`}
                >
                  {p.intent}
                </span>
              </div>
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 block truncate text-xs text-slate-400 hover:text-brand hover:underline"
              >
                {p.url}
              </a>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {p.pillarLabel && (
                  <span className="rounded bg-violet-50 px-1.5 text-[11px] text-violet-700">
                    {p.pillarLabel}
                  </span>
                )}
                <span className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-600">{p.cluster}</span>
                {p.inPipeline && (
                  <span className="rounded bg-amber-50 px-1.5 text-[11px] text-amber-700">on board</span>
                )}
              </div>
              {p.matches.length > 0 ? (
                <div className="mt-2">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                    Add these keywords ({p.matches.length})
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.matches.slice(0, 6).map((m) => (
                      <span
                        key={m.id}
                        title={m.searchVolume ? `${m.searchVolume.toLocaleString()}/mo search volume` : undefined}
                        className="rounded bg-brand/10 px-1.5 py-0.5 text-[11px] text-brand"
                      >
                        {m.keyword}
                      </span>
                    ))}
                    {p.matches.length > 6 && (
                      <span className="text-[11px] text-slate-400">+{p.matches.length - 6} more</span>
                    )}
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-400">
                  No missing-keyword match — update brings it to guidelines only.
                </p>
              )}
              <button
                onClick={() => generate(p)}
                disabled={busyUrl === p.url}
                className="mt-2 w-full rounded border border-brand px-2 py-1 text-[12px] font-medium text-brand hover:bg-brand/5 disabled:opacity-50"
              >
                {busyUrl === p.url ? "Generating…" : "Generate update draft →"}
              </button>
              <button
                onClick={() => generateSocial(p)}
                disabled={socialBusy === p.url}
                className="mt-1.5 w-full rounded border border-slate-300 px-2 py-1 text-[12px] font-medium text-slate-700 hover:border-brand hover:text-brand disabled:opacity-50"
                title="Generate 3 brand-voice social posts and queue them on the Mon/Wed/Fri scheduler"
              >
                {socialBusy === p.url ? "Generating posts…" : "Generate 3 social posts →"}
              </button>
              <button
                onClick={() => generateEmail(p)}
                disabled={emailBusy === p.url}
                className="mt-1.5 w-full rounded border border-slate-300 px-2 py-1 text-[12px] font-medium text-slate-700 hover:border-brand hover:text-brand disabled:opacity-50"
                title="Repurpose this page into a brand-voice email newsletter and create it as a Constant Contact draft campaign"
              >
                {emailBusy === p.url ? "Generating email…" : "Email → Constant Contact draft →"}
              </button>
              {msg?.url === p.url && (
                <p
                  className={`mt-1 text-[11px] ${
                    msg.tone === "warn" ? "text-red-600" : "text-slate-500"
                  }`}
                >
                  {msg.text}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "amber" | "brand";
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-200 bg-amber-50"
      : tone === "brand" && value > 0
        ? "border-brand bg-brand/5"
        : "border-slate-200 bg-white";
  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClass}`}>
      <div
        className={`text-xl font-bold ${
          tone === "brand" && value > 0 ? "text-brand" : "text-slate-900"
        }`}
      >
        {value}
      </div>
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
