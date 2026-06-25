"use client";

/**
 * DraftReview — the full draft review experience, opened INLINE on the
 * Production Board (no navigation). This is Diana's reviewer layout:
 *
 *   stage bar (Opportunity → Brief → Draft → Approve → Publish)
 *   title + tags + verify chips
 *   SEO metadata bar (full width, on top)
 *   ┌───────────────────────────┬──────────────────────┐
 *   │ Draft content (read/edit) │ Approve → Publish     │
 *   │ Internal links panel      │ QA checklist          │
 *   │                           │ Content info card     │
 *   └───────────────────────────┴──────────────────────┘
 *
 * Everything reads from the one linked record (the spine): the draft body and
 * brief come from content_drafts, the scores from content_analyses. No new
 * data model — this is the spine's reviewer view.
 *
 * The editorial machine is review → approved → published. Approve re-runs the
 * compliance HARD gate server-side (/api/agent/approve) and fails closed to
 * needs_legal; Publish (/api/content/drafts/[id]/publish) re-gates and posts
 * social drafts live via Ayrshare. WordPress long-form publishing lands next.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";

import { DashSpinner, DashPill } from "@/components/dashboard-ui";
import MarkdownEditor, { type MarkdownEditorHandle } from "@/components/markdown-editor";
import { useReadabilityRanges } from "@/lib/readability/use-readability";
import {
  AnalysisCard,
  ApplySuggestionModal,
  type Analysis,
} from "@/components/analysis-card";
import { ALL_KM_PILLARS } from "@/lib/km-content-system";

const PROSE_CLASS =
  "[&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-2 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_strong]:font-semibold [&_em]:italic [&_a]:text-[#185FA5] [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:my-2";

const PILLAR_LABEL: Record<string, string> = Object.fromEntries(
  ALL_KM_PILLARS.map((p) => [p.id, p.label]),
);
const PILLAR_URL: Record<string, string> = Object.fromEntries(
  ALL_KM_PILLARS.map((p) => [p.id, p.url]),
);

type PipelineStatus =
  | "idea"
  | "brief"
  | "draft"
  | "review"
  | "needs_legal"
  | "approved"
  | "published";

const STAGES: { key: PipelineStatus; label: string }[] = [
  { key: "idea", label: "Opportunity" },
  { key: "brief", label: "Brief" },
  { key: "draft", label: "Draft review" },
  { key: "review", label: "Approve" },
  { key: "approved", label: "Approved" },
  { key: "published", label: "Published" },
];

// Soft quality floor: drafts scoring below these on the latest analysis trigger
// an advisory warning at approval (the owner can still approve). Unlike the
// compliance gate, this never blocks — it's a quality nudge, not a hard stop.
const QUALITY_MIN = { seo: 75, aeo: 75, cash: 75 };

/** Which of SEO/AEO/CASH on this analysis fall below the soft target. */
function qualityShortfall(a: Analysis | null): { label: string; score: number }[] {
  if (!a) return [];
  const out: { label: string; score: number }[] = [];
  if (typeof a.seo_score === "number" && a.seo_score < QUALITY_MIN.seo)
    out.push({ label: "SEO", score: a.seo_score });
  if (typeof a.aeo_score === "number" && a.aeo_score < QUALITY_MIN.aeo)
    out.push({ label: "AEO", score: a.aeo_score });
  if (typeof a.cash_score === "number" && a.cash_score < QUALITY_MIN.cash)
    out.push({ label: "CASH", score: a.cash_score });
  return out;
}

const SOURCE_LABEL: Record<string, string> = {
  opportunity_quickwin: "SEMrush",
  opportunity_missing: "SEMrush",
  opportunity_longtail: "SEMrush",
  semrush: "SEMrush",
  competitor_gap: "Competitor gap",
  keyword_tracker: "Keyword tracker",
  imported: "Imported",
  manual: "Manual",
};

type ReviewItem = {
  id: number;
  draft_id: string | null;
  /** brief_suggestions.id — present on rows created from a brief. Lets the
   *  drawer show the brief even before a draft has been generated. */
  suggestion_id?: string | null;
  status: PipelineStatus;
  title: string;
  bucket?: string | null;
  keywords?: string | null;
};

type Brief = {
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  metaTitle?: string;
  metaDescription?: string;
  urlSlug?: string;
  pillarId?: string;
  searchIntent?: string;
  internalPillarLink?: string;
  internalLinks?: { url: string; anchor: string; section: string }[];
  cannibalizationConfirmed?: boolean;
  contentType?: string;
};

type DraftRow = {
  id: string;
  title: string | null;
  body: string;
  created_at?: string;
  seo_brief?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

function readBrief(draft: DraftRow): Brief {
  const meta = (draft.metadata ?? {}) as Record<string, unknown>;
  const km = (meta.km_brief ?? {}) as Record<string, unknown>;
  const seo = (draft.seo_brief ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const src of [km, seo]) {
      for (const k of keys) {
        const v = src[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
    }
    return "";
  };
  const links = Array.isArray(km.internalLinks)
    ? (km.internalLinks as Brief["internalLinks"])
    : [];
  const secondary = Array.isArray(km.secondaryKeywords)
    ? (km.secondaryKeywords as string[])
    : Array.isArray(seo.secondaryKeywords)
      ? (seo.secondaryKeywords as string[])
      : Array.isArray(seo.targetKeywords)
        ? (seo.targetKeywords as string[])
        : [];
  return {
    primaryKeyword: pick("primaryKeyword"),
    secondaryKeywords: secondary,
    metaTitle: pick("metaTitle"),
    metaDescription: pick("metaDescription"),
    urlSlug: pick("urlSlug"),
    pillarId: pick("pillarId"),
    searchIntent: pick("searchIntent"),
    internalPillarLink: pick("internalPillarLink"),
    internalLinks: links,
    cannibalizationConfirmed: km.cannibalizationConfirmed === true,
    contentType: pick("contentType"),
  };
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
          ok ? "bg-emerald-100 text-emerald-700" : "border border-slate-300 text-transparent"
        }`}
        aria-hidden
      >
        ✓
      </span>
      <span className={ok ? "text-slate-700" : "text-slate-500"}>{label}</span>
    </div>
  );
}

export function DraftDrawer({
  item,
  onClose,
  onChanged,
  onEditMeta,
}: {
  item: ReviewItem;
  onClose: () => void;
  /** Refresh the board after a save / status change. */
  onChanged: () => void;
  /** Open the metadata form (the row "Edit" / "Edit all fields"). */
  onEditMeta?: () => void;
}) {
  const draftId = item.draft_id ?? "";
  const suggestionId = item.suggestion_id ?? "";
  const [draft, setDraft] = useState<DraftRow | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [status, setStatus] = useState<PipelineStatus>(item.status);
  const [legalReview, setLegalReview] = useState(false);
  const [proofread, setProofread] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // When the row has no draft yet (brief stage), we load the linked brief so
  // the reviewer still sees the brief they built — not "Draft not found".
  const [briefOnly, setBriefOnly] = useState<Brief | null>(null);
  const [suggestedRaw, setSuggestedRaw] = useState<Record<string, unknown> | null>(null);
  const [generating, setGenerating] = useState(false);
  // Findings the reviewer chose to apply — opens the AI rewrite/diff modal.
  const [applyingFindings, setApplyingFindings] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDraft(null);
    setBriefOnly(null);
    setSuggestedRaw(null);

    if (draftId) {
      fetch(`/api/content/drafts/${draftId}`)
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          setDraft(data.draft ?? null);
          setAnalysis(data.latest_analysis ?? null);
          setEditBody(data.draft?.body ?? "");
          setLoading(false);
          if (data.draft && !data.latest_analysis) void runAnalysis(data.draft);
        })
        .catch(() => {
          if (!cancelled) setLoading(false);
        });
    } else if (suggestionId) {
      // No draft generated yet — show the brief from the linked suggestion.
      fetch(`/api/seo/suggestions/${suggestionId}`)
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          const raw = (data?.suggested_brief ?? null) as Record<string, unknown> | null;
          setSuggestedRaw(raw);
          setBriefOnly(
            raw
              ? readBrief({ id: "", title: null, body: "", metadata: { km_brief: raw } } as DraftRow)
              : ({} as Brief),
          );
          setLoading(false);
        })
        .catch(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      setLoading(false);
    }
    return () => {
      cancelled = true;
    };
  }, [draftId, suggestionId]);

  const brief = useMemo(
    () => (draft ? readBrief(draft) : (briefOnly ?? ({} as Brief))),
    [draft, briefOnly],
  );
  const body = editing ? editBody : (draft?.body ?? "");
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const { ranges: readabilityRanges } = useReadabilityRanges(body);
  const renderedBody = useMemo(
    () =>
      body.trim()
        ? (marked.parse(body, { async: false }) as string)
        : "<p class='text-slate-400'>No content.</p>",
    [body],
  );

  const wordCount =
    analysis?.word_count ?? (draft?.body ? draft.body.trim().split(/\s+/).filter(Boolean).length : 0);

  // Automatic QA checks — computed from the linked record + latest analysis.
  const metaTitle = brief.metaTitle || item.title;
  const primaryKw = (brief.primaryKeyword || "").toLowerCase();
  const qa = {
    metaDescription: !!brief.metaDescription,
    h1Keyword: !!primaryKw && (draft?.title ?? item.title).toLowerCase().includes(primaryKw),
    pillarLink: !!(brief.internalPillarLink || brief.pillarId),
    internalLinks: (brief.internalLinks?.length ?? 0) > 0,
    wordCount: wordCount >= 600,
    titleLen: metaTitle.length > 0 && metaTitle.length <= 60,
  };
  const autoPassCount = Object.values(qa).filter(Boolean).length;
  const manualPass = (legalReview ? 1 : 0) + (proofread ? 1 : 0);
  const qaTotal = `${autoPassCount + manualPass}/${Object.keys(qa).length + 2}`;

  // HARD QA gate — these four completeness checks must pass (or be explicitly
  // overridden) before approval. The other auto-checks (internal links, title
  // length) stay advisory and don't block. This is a content-completeness gate,
  // not the compliance gate — the owner can override with a deliberate tick.
  const qaRequired: { key: keyof typeof qa; label: string }[] = [
    { key: "metaDescription", label: "Meta description present" },
    { key: "h1Keyword", label: "H1 contains primary keyword" },
    { key: "pillarLink", label: "Pillar link present" },
    { key: "wordCount", label: "Word count meets minimum" },
  ];
  const qaFailed = qaRequired.filter((c) => !qa[c.key]);
  const qaGatePassed = qaFailed.length === 0;

  const canPublish = legalReview && proofread;

  async function runAnalysis(d: DraftRow) {
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/content/drafts/${d.id}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) setAnalysis(data);
    } finally {
      setAnalyzing(false);
    }
  }

  // Generate the draft from the linked brief (brief-stage rows that have no
  // draft yet). On success the new draft is pulled straight into the drawer.
  const generateDraft = async () => {
    if (!suggestedRaw) return;
    setGenerating(true);
    setMsg("Generating draft from brief…");
    try {
      const res = await fetch("/api/content/km-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...suggestedRaw, language: "en", suggestionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data?.draft_id === "string") {
        const r = await fetch(`/api/content/drafts/${data.draft_id}`);
        const dj = await r.json();
        setDraft(dj.draft ?? null);
        setAnalysis(dj.latest_analysis ?? null);
        setEditBody(dj.draft?.body ?? "");
        setBriefOnly(null);
        setStatus("draft");
        setMsg("Draft generated.");
        onChanged();
        if (dj.draft && !dj.latest_analysis) void runAnalysis(dj.draft);
      } else {
        setMsg(data?.error ? `Generation failed: ${data.error}` : "Generation failed.");
      }
    } catch {
      setMsg("Generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  // Persist an AI-proposed edit after the reviewer accepts it in the diff modal.
  const acceptApply = async (newBody: string) => {
    if (!draft) return;
    const res = await fetch(`/api/content/drafts/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: newBody }),
    });
    if (res.ok) {
      setDraft({ ...draft, body: newBody });
      setEditBody(newBody);
      setMsg("Applied.");
      onChanged();
    }
    setApplyingFindings(null);
  };

  // Apply an internal link from the overlap check: turn the first plain-text
  // mention of `term` in the body into a markdown link to the existing page, so
  // the writer can "link, don't redefine" with one click. No AI step.
  const applyOverlapLink = async (term: string, url: string) => {
    if (!draft) return;
    const source = draft.body ?? "";
    if (source.includes(`](${url})`)) {
      setMsg("That page is already linked in the draft.");
      return;
    }
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // First standalone occurrence not already inside a markdown link.
    const re = new RegExp(`(?<!\\[)\\b(${esc})\\b`, "i");
    if (!re.test(source)) {
      setMsg(`Couldn't find "${term}" in the draft — add the link manually.`);
      return;
    }
    const newBody = source.replace(re, `[$1](${url})`);
    const res = await fetch(`/api/content/drafts/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: newBody }),
    });
    if (res.ok) {
      setDraft({ ...draft, body: newBody });
      setEditBody(newBody);
      setMsg(`Linked "${term}" to the existing page.`);
      onChanged();
    } else {
      setMsg("Failed to apply link.");
    }
  };

  // Apply a suggested title — a quick PATCH, no AI step.
  const applyTitle = async (newTitle: string) => {
    if (!draft) return;
    const res = await fetch(`/api/content/drafts/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle }),
    });
    if (res.ok) {
      setDraft({ ...draft, title: newTitle });
      setMsg("Title updated.");
      onChanged();
    }
  };

  const saveBody = async () => {
    if (!draft) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/content/drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: editBody }),
      });
      if (res.ok) {
        setDraft({ ...draft, body: editBody });
        setEditing(false);
        setMsg("Saved.");
        onChanged();
      } else {
        setMsg("Save failed.");
      }
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (next: PipelineStatus, note: string) => {
    setStatus(next);
    setMsg(note);
    await fetch(`/api/content/pipeline/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    onChanged();
  };

  // Move the draft's editorial status. When a draft_id exists we go through the
  // draft endpoint so content_drafts and content_pipeline stay in lockstep (and
  // the site_pages ingest fires on publish); brief-only rows fall back to the
  // pipeline row.
  const setDraftStage = async (next: PipelineStatus, note: string) => {
    setStatus(next);
    setMsg(note);
    if (draftId) {
      await fetch(`/api/content/drafts/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
    } else {
      await fetch(`/api/content/pipeline/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
    }
    onChanged();
  };

  // Approve = the human sign-off. The server re-runs the compliance HARD gate;
  // a 422 means it was held at needs_legal (with violations), not approved.
  const [approving, setApproving] = useState(false);
  const [qaOverride, setQaOverride] = useState(false);
  const approve = async () => {
    if (!draftId) {
      setMsg("No draft to approve yet.");
      return;
    }
    // HARD QA gate: required completeness checks must pass unless overridden.
    if (!qaGatePassed && !qaOverride) {
      setMsg(
        `QA checklist incomplete: ${qaFailed.map((c) => c.label).join(", ")}. ` +
          `Fix these, or tick "Approve despite QA" to override.`,
      );
      return;
    }
    // Soft quality gate: warn (don't block) if SEO/AEO/CASH are below target.
    const short = qualityShortfall(analysis);
    if (short.length > 0) {
      const lines = short.map((s) => `  • ${s.label} ${s.score} (target ${QUALITY_MIN[s.label.toLowerCase() as "seo" | "aeo" | "cash"]})`);
      const ok = window.confirm(
        `This draft is below your quality target:\n\n${lines.join("\n")}\n\nApprove anyway?`,
      );
      if (!ok) return;
    }
    setApproving(true);
    setMsg("Running compliance check…");
    try {
      const res = await fetch("/api/agent/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "content", id: draftId, action: "approve" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus("approved");
        setMsg("Approved — ready to publish.");
      } else if (res.status === 422) {
        setStatus("needs_legal");
        const n = data?.compliance?.violations?.length ?? 0;
        setMsg(
          data?.error ??
            `Held by the compliance gate${n ? ` (${n} issue${n === 1 ? "" : "s"})` : ""}.`,
        );
      } else {
        setMsg(data?.error ?? "Approve failed.");
      }
    } catch {
      setMsg("Approve failed.");
    } finally {
      setApproving(false);
      onChanged();
    }
  };

  // Publish = approved → published. The server re-runs the compliance gate and,
  // for social-format drafts, actually posts via Ayrshare. A 502/400 means the
  // external post failed and the draft stays approved (we never mark something
  // published that didn't go out); a 422 means it was held at needs_legal.
  const [publishing, setPublishing] = useState(false);
  const [queuedForWp, setQueuedForWp] = useState(false);
  const publish = async () => {
    if (!draftId) {
      setMsg("No draft to publish yet.");
      return;
    }
    setPublishing(true);
    setMsg("Publishing…");
    try {
      const res = await fetch(`/api/content/drafts/${draftId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.status === "queued") {
        // Long-form → handed to the WordPress plugin; stays approved until the
        // plugin confirms the post was created.
        setQueuedForWp(true);
        setMsg(data?.message ?? "Queued for WordPress.");
      } else if (res.ok) {
        setStatus("published");
        const urls: string[] = Array.isArray(data?.postUrls) ? data.postUrls : [];
        setMsg(
          data?.channel === "social"
            ? `Published to social${urls[0] ? ` — ${urls[0]}` : "."}`
            : "Published.",
        );
      } else if (res.status === 422) {
        setStatus("needs_legal");
        setMsg(data?.error ?? "Held by the compliance gate.");
      } else {
        setMsg(data?.error ?? "Publish failed — left as approved.");
      }
    } catch {
      setMsg("Publish failed.");
    } finally {
      setPublishing(false);
      onChanged();
    }
  };

  // Compliance verdict the gate stored on the draft (shown when held).
  const compliance = (draft?.metadata as Record<string, unknown> | undefined)
    ?.compliance as
    | {
        score?: number;
        violations?: { rule?: string; severity?: string; reason?: string }[];
      }
    | undefined;

  // A long-form draft handed to the WordPress plugin (queued just now, or still
  // queued from a prior Publish click) sits in approved until the plugin confirms.
  const isQueuedForWp =
    queuedForWp ||
    ((draft?.metadata as Record<string, unknown> | undefined)?.wp_publish as
      | { queued?: unknown }
      | undefined)?.queued === true;

  const copyBody = async () => {
    try {
      await navigator.clipboard.writeText(draft?.body ?? "");
      setMsg("Copied to clipboard.");
    } catch {
      setMsg("Copy failed.");
    }
  };

  const sourceRaw =
    ((draft?.metadata as Record<string, unknown>)?.origin_source as string) ?? "";
  const sourceLabel = SOURCE_LABEL[sourceRaw] ?? (sourceRaw ? sourceRaw : "—");
  const generated = draft?.created_at ? new Date(draft.created_at).toLocaleString() : "—";
  // needs_legal is a hold off the Approve stage, not its own column on the bar.
  const stageStatus: PipelineStatus = status === "needs_legal" ? "review" : status;
  const currentStage = STAGES.findIndex((s) => s.key === stageStatus);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-3 sm:p-6">
      <div className="mx-auto max-w-6xl rounded-xl bg-white shadow-2xl">
        {/* Top: stage bar + close */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {STAGES.map((s, i) => (
              <span key={s.key} className="flex items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                    i < currentStage
                      ? "bg-emerald-50 text-emerald-700"
                      : i === currentStage
                        ? "bg-[#185FA5] text-white"
                        : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {i < currentStage ? "✓" : i + 1} {s.label}
                </span>
                {i < STAGES.length - 1 && <span className="text-slate-300">→</span>}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-500 sm:inline">
              {wordCount.toLocaleString()} words · {generated}
            </span>
            <button onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-slate-700" aria-label="Close">
              ×
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-sm text-slate-500">
            <DashSpinner /> Loading draft…
          </div>
        ) : !draft && !briefOnly ? (
          <div className="py-20 text-center text-sm text-slate-500">
            {suggestionId || draftId ? "Draft not found." : "No brief linked to this item yet."}
          </div>
        ) : (
          <div className="px-5 py-4">
            {/* Title + tags + toolbar */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{item.title}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {brief.contentType && <DashPill tone="blue">{brief.contentType.replace(/_/g, " ")}</DashPill>}
                  {item.bucket && <DashPill tone="violet">{item.bucket.replace(/_/g, " ")}</DashPill>}
                  {sourceLabel !== "—" && <DashPill tone="neutral">{sourceLabel}</DashPill>}
                  {qa.internalLinks && <DashPill tone="emerald">Internal links verified</DashPill>}
                  {brief.cannibalizationConfirmed && <DashPill tone="emerald">No cannibalization</DashPill>}
                </div>
              </div>
              {draft && (
                <div className="flex items-center gap-1.5">
                  <button onClick={copyBody} className="rounded border border-slate-300 px-2.5 py-1 text-xs hover:border-[#185FA5] hover:text-[#185FA5]">
                    Copy
                  </button>
                  <button
                    onClick={() => draft && runAnalysis(draft)}
                    disabled={analyzing}
                    className="rounded border border-slate-300 px-2.5 py-1 text-xs hover:border-[#185FA5] hover:text-[#185FA5] disabled:opacity-50"
                  >
                    {analyzing ? "Analyzing…" : "Run analysis"}
                  </button>
                </div>
              )}
            </div>

            {/* SEO metadata bar — full width, on top */}
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">SEO metadata</span>
                {onEditMeta && (
                  <button onClick={onEditMeta} className="text-xs font-medium text-[#185FA5] hover:underline">
                    Edit all fields
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                <MetaField label="Meta title" value={brief.metaTitle} />
                <MetaField label="URL slug" value={brief.urlSlug} />
                <MetaField label="Pillar link" value={brief.internalPillarLink || PILLAR_URL[brief.pillarId ?? ""]} />
                <MetaField label="Search intent" value={brief.searchIntent} />
              </div>
              <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <MetaField label="Meta description" value={brief.metaDescription} multiline />
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Secondary keywords</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(brief.secondaryKeywords ?? []).length === 0 ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : (
                      brief.secondaryKeywords!.map((k) => (
                        <span key={k} className="rounded bg-[#185FA5]/10 px-1.5 py-0.5 text-[11px] text-[#185FA5]">
                          {k}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Two-column body */}
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
              {/* LEFT: draft content + internal links */}
              <div className="space-y-4">
                <div className="rounded-lg border border-slate-200">
                  <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Draft content</span>
                    {draft &&
                      (editing ? (
                        <div className="flex items-center gap-2">
                          <button onClick={() => { setEditing(false); setEditBody(draft.body); }} className="text-xs text-slate-500 hover:text-slate-700">
                            Cancel
                          </button>
                          <button onClick={saveBody} disabled={saving} className="text-xs font-medium text-[#185FA5] hover:underline disabled:opacity-50">
                            {saving ? "Saving…" : "Save"}
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => { setEditBody(draft.body); setEditing(true); }} className="text-xs font-medium text-[#185FA5] hover:underline">
                          Edit
                        </button>
                      ))}
                  </div>
                  {!draft ? (
                    <div className="px-4 py-8 text-center">
                      <p className="text-sm font-medium text-slate-700">No draft generated yet</p>
                      <p className="mx-auto mt-1 max-w-sm text-xs text-slate-400">
                        This brief is ready. Generate the draft to review, QA, and publish it.
                      </p>
                      <button
                        onClick={generateDraft}
                        disabled={generating || !suggestedRaw}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[#185FA5] px-3 py-2 text-sm font-medium text-white hover:bg-[#1f6fb8] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {generating ? (
                          <>
                            <DashSpinner /> Generating…
                          </>
                        ) : (
                          "Generate draft from brief"
                        )}
                      </button>
                    </div>
                  ) : editing ? (
                    <div className="[&_.cm-editor]:max-h-[60vh] [&_.cm-content]:px-4 [&_.cm-content]:py-3 [&_.cm-content]:font-mono [&_.cm-content]:text-sm [&_.cm-content]:leading-relaxed">
                      <MarkdownEditor
                        ref={editorRef}
                        value={editBody}
                        onChange={setEditBody}
                        ranges={readabilityRanges}
                      />
                    </div>
                  ) : (
                    <div
                      className={`max-h-[60vh] overflow-y-auto px-4 py-3 text-sm text-slate-800 ${PROSE_CLASS}`}
                      dangerouslySetInnerHTML={{ __html: renderedBody }}
                    />
                  )}
                </div>

                {/* Internal links panel */}
                <div className="rounded-lg border border-slate-200">
                  <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Internal links — Cluster Map
                    </span>
                    {qa.internalLinks && <span className="text-xs font-medium text-emerald-600">All verified</span>}
                  </div>
                  <div className="px-4 py-3">
                    {(brief.internalLinks?.length ?? 0) === 0 ? (
                      <p className="text-xs text-slate-400">No internal links on this draft.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {brief.internalLinks!.map((l, i) => (
                          <li key={`${l.url}-${i}`} className="flex items-center justify-between gap-2 text-xs">
                            <span className="flex items-center gap-1.5 text-slate-700">
                              <span className="text-emerald-600">✓</span>
                              <span className="font-mono">{l.url}</span>
                            </span>
                            <span className="text-slate-400">Confirmed live · {l.section}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-2 text-[11px] text-slate-400">
                      Generator used only confirmed Cluster Map pages. No invented links.
                    </p>
                  </div>
                </div>
              </div>

              {/* RIGHT: publish + QA + content info */}
              <div className="space-y-4">
                {draft ? (
                  status === "needs_legal" ? (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                      <div className="text-sm font-semibold text-amber-900">Held by compliance</div>
                      <p className="mt-0.5 text-xs text-amber-700">
                        The compliance gate held this draft
                        {typeof compliance?.score === "number" ? ` (score ${compliance.score})` : ""}.
                        Edit it to compliance, then approve again.
                      </p>
                      {compliance?.violations?.length ? (
                        <ul className="mt-2 space-y-1">
                          {compliance.violations.slice(0, 5).map((v, i) => (
                            <li key={i} className="text-[11px] text-amber-800">
                              <span className="font-medium capitalize">{v.severity ?? "issue"}:</span>{" "}
                              {v.reason ?? v.rule}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <button
                        onClick={() => setDraftStage("draft", "Sent back to draft.")}
                        className="mt-2 w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
                      >
                        Send back to draft
                      </button>
                    </div>
                  ) : status === "published" ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                      <div className="text-sm font-semibold text-emerald-900">Published</div>
                      <p className="mt-0.5 text-xs text-emerald-700">
                        This draft is marked published.
                      </p>
                      <button
                        onClick={() => setDraftStage("draft", "Sent back to draft.")}
                        className="mt-2 w-full rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
                      >
                        Send back to draft
                      </button>
                    </div>
                  ) : status === "approved" ? (
                    isQueuedForWp ? (
                      <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                        <div className="text-sm font-semibold text-sky-900">Queued for WordPress</div>
                        <p className="mt-0.5 text-xs text-sky-700">
                          The site plugin will create the post on its next sync, then this flips to
                          Published automatically.
                        </p>
                        <button
                          onClick={() => setDraftStage("draft", "Sent back to draft.")}
                          className="mt-2 w-full rounded-md border border-sky-300 bg-white px-3 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100"
                        >
                          Send back to draft
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                        <div className="text-sm font-semibold text-emerald-900">Approved — ready to publish</div>
                        <p className="mt-0.5 text-xs text-emerald-700">Signed off and compliance-cleared.</p>
                        <button
                          onClick={publish}
                          disabled={publishing}
                          className="mt-2 w-full rounded-md bg-[#185FA5] px-3 py-2 text-sm font-medium text-white hover:bg-[#1f6fb8] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {publishing ? "Publishing…" : "Publish"}
                        </button>
                        <button
                          onClick={() => setDraftStage("draft", "Sent back to draft.")}
                          className="mt-2 w-full rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
                        >
                          Send back to draft
                        </button>
                        <p className="mt-2 text-[10px] text-emerald-700/80">
                          Social drafts post live via Ayrshare; long-form drafts are queued for
                          WordPress — both run a final compliance check on Publish.
                        </p>
                      </div>
                    )
                  ) : (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                      <div className="text-sm font-semibold text-emerald-900">Ready to approve</div>
                      <p className="mt-0.5 text-xs text-emerald-700">
                        {canPublish ? "Manual checks complete." : "Complete 2 manual checks then approve."}
                      </p>
                      {!qaGatePassed && (
                        <div className="mt-2 rounded-md border border-rose-300 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-800">
                          <span className="font-medium">QA checklist incomplete — fix before approving:</span>
                          <ul className="mt-1 list-disc pl-4">
                            {qaFailed.map((c) => (
                              <li key={c.key}>{c.label}</li>
                            ))}
                          </ul>
                          <label className="mt-1.5 flex items-center gap-1.5 font-medium">
                            <input
                              type="checkbox"
                              checked={qaOverride}
                              onChange={(e) => setQaOverride(e.target.checked)}
                              className="h-3.5 w-3.5"
                            />
                            Approve despite QA
                          </label>
                        </div>
                      )}
                      {qualityShortfall(analysis).length > 0 && (
                        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                          <span className="font-medium">Below quality target ({QUALITY_MIN.seo}):</span>{" "}
                          {qualityShortfall(analysis)
                            .map((s) => `${s.label} ${s.score}`)
                            .join(" · ")}
                          . You can still approve, or improve it first using the analysis findings below.
                        </div>
                      )}
                      <button
                        onClick={approve}
                        disabled={!canPublish || approving || (!qaGatePassed && !qaOverride)}
                        className="mt-2 w-full rounded-md bg-[#185FA5] px-3 py-2 text-sm font-medium text-white hover:bg-[#1f6fb8] disabled:cursor-not-allowed disabled:opacity-50"
                        title={
                          !canPublish
                            ? "Complete the manual checks first"
                            : !qaGatePassed && !qaOverride
                              ? "QA checklist incomplete — fix the flagged items or override"
                              : undefined
                        }
                      >
                        {approving ? "Checking compliance…" : "Approve"}
                      </button>
                      <button
                        onClick={() => setDraftStage("draft", "Sent back to draft.")}
                        className="mt-2 w-full rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
                      >
                        Send back to draft
                      </button>
                      <p className="mt-2 text-[10px] text-emerald-700/80">
                        Approve re-runs the compliance check; if it fails the draft is held for legal.
                      </p>
                    </div>
                  )
                ) : (
                  <div className="rounded-lg border border-[#185FA5]/30 bg-[#185FA5]/5 p-3">
                    <div className="text-sm font-semibold text-slate-900">Brief ready</div>
                    <p className="mt-0.5 text-xs text-slate-600">
                      Generate the draft from this brief to start the review.
                    </p>
                    <button
                      onClick={generateDraft}
                      disabled={generating || !suggestedRaw}
                      className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[#185FA5] px-3 py-2 text-sm font-medium text-white hover:bg-[#1f6fb8] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {generating ? (
                        <>
                          <DashSpinner /> Generating…
                        </>
                      ) : (
                        "Generate draft from brief"
                      )}
                    </button>
                  </div>
                )}

                {/* QA checklist */}
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">QA checklist</span>
                    <span className="text-xs font-medium text-slate-600">{qaTotal}</span>
                  </div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Automatic</div>
                  <div className="mt-1 space-y-1">
                    <Check ok={qa.metaDescription} label="Meta description present" />
                    <Check ok={qa.h1Keyword} label="H1 contains primary keyword" />
                    <Check ok={qa.pillarLink} label="Pillar link present" />
                    <Check ok={qa.internalLinks} label="Internal links verified" />
                    <Check ok={qa.wordCount} label="Word count meets minimum" />
                    <Check ok={qa.titleLen} label="Title under 60 characters" />
                  </div>
                  <div className="mt-2 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                    Manual certification
                  </div>
                  <div className="mt-1 space-y-1">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                      <input type="checkbox" checked={legalReview} onChange={(e) => setLegalReview(e.target.checked)} />
                      Legal review complete
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                      <input type="checkbox" checked={proofread} onChange={(e) => setProofread(e.target.checked)} />
                      Proofread and on-brand
                    </label>
                  </div>
                </div>

                {/* Content info */}
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Content info</div>
                  <dl className="space-y-1.5 text-xs">
                    <InfoRow label="Type" value={brief.contentType ? brief.contentType.replace(/_/g, " ") : "—"} />
                    <InfoRow label="Primary keyword" value={brief.primaryKeyword || "—"} />
                    <InfoRow label="Pillar" value={PILLAR_LABEL[brief.pillarId ?? ""] || "—"} />
                    <InfoRow label="Word count" value={wordCount.toLocaleString()} />
                    <InfoRow
                      label="Cannibalization"
                      value={brief.cannibalizationConfirmed ? "No conflict" : "Review"}
                      valueClass={brief.cannibalizationConfirmed ? "text-emerald-600" : "text-amber-600"}
                    />
                    <InfoRow label="Source" value={sourceLabel} />
                    <InfoRow label="Generated" value={generated} />
                  </dl>
                </div>

                {msg && <p className="text-xs text-slate-500">{msg}</p>}
              </div>
            </div>

            {/* Analysis results — full width, at the bottom. The same rich card
                used in the Drafts studio: scores, findings (apply-to-rewrite),
                suggested titles/images/links, compliance, and overlap. */}
            {draft &&
              (analysis ? (
                <div className="mt-4">
                  <AnalysisCard
                    analysis={analysis}
                    body={body}
                    onSelectRange={(s, e) => editorRef.current?.selectRange(s, e)}
                    onReplaceRange={
                      editing
                        ? (s, e, t) =>
                            setEditBody((prev) => prev.slice(0, s) + t + prev.slice(e))
                        : undefined
                    }
                    onRerun={() => runAnalysis(draft)}
                    rerunning={analyzing}
                    onApplyFindings={(fs) => setApplyingFindings(fs)}
                    onApplyTitle={applyTitle}
                    onApplyLink={applyOverlapLink}
                    currentTitle={draft.title}
                  />
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-slate-200 p-4 text-xs text-slate-500">
                  {analyzing ? (
                    <span className="inline-flex items-center gap-2">
                      <DashSpinner /> Running analysis…
                    </span>
                  ) : (
                    "No analysis yet — click “Run analysis” above."
                  )}
                </div>
              ))}

            {draft && applyingFindings && (
              <ApplySuggestionModal
                draftId={draft.id}
                findings={applyingFindings}
                onAccept={acceptApply}
                onClose={() => setApplyingFindings(null)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MetaField({ label, value, multiline }: { label: string; value?: string; multiline?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div
        className={`mt-1 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 ${
          multiline ? "min-h-[3.5rem] italic" : "truncate"
        }`}
        title={value || undefined}
      >
        {value || <span className="text-slate-300">—</span>}
      </div>
    </div>
  );
}

function InfoRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`text-right font-medium ${valueClass ?? "text-slate-800"}`}>{value}</dd>
    </div>
  );
}
