"use client";

/**
 * Saved drafts library.
 *
 * Every generation (single-format generator + multi-format batches) auto-saves
 * to content_drafts. This page is the searchable index. Pick a draft to:
 *   - edit and save
 *   - run analysis (readability, keyword density, AEO score, brand voice)
 *   - export to .docx
 *   - mark approved / archive
 */

import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { diffWords, type Change } from "diff";

import { ContentNav } from "@/components/content-nav";
import { ContentTypeTabs } from "@/components/content-type-tabs";
import {
  DashCard,
  DashButton,
  DashInput,
  DashPill,
  DashSpinner,
  DashBar,
} from "@/components/dashboard-ui";
import {
  CONTENT_TYPE_FORMATS,
  CONTENT_TYPE_LABEL,
  readContentType,
} from "@/lib/content-types";

type Draft = {
  id: string;
  format: string;
  template: string | null;
  topic: string;
  practice_area: string | null;
  title: string | null;
  body: string;
  metadata: Record<string, unknown>;
  seo_brief?: { targetKeywords?: string[] } | null;
  status: string;
  created_at: string;
  updated_at: string;
};

const ORIGIN_SOURCE_LABEL: Record<string, string> = {
  opportunity_quickwin: "Keyword opportunity · quick win",
  opportunity_missing: "Keyword opportunity · missing target",
  opportunity_longtail: "Keyword opportunity · long-tail",
  fan_out: "AI search fan-out",
  recommendations: "Content idea",
  tracked_keyword: "Tracked keyword",
  batch_topic: "Multi-format batch",
  manual: "Manual",
};

function readOrigin(d: Draft): {
  source: string | null;
  label: string | null;
  context: Record<string, unknown> | null;
} {
  const meta = (d.metadata ?? {}) as Record<string, unknown>;
  const source = typeof meta.origin_source === "string" ? meta.origin_source : null;
  const context =
    meta.origin_context && typeof meta.origin_context === "object"
      ? (meta.origin_context as Record<string, unknown>)
      : null;
  const label = source ? ORIGIN_SOURCE_LABEL[source] ?? source : null;
  return { source, label, context };
}

function readTargetKeywords(d: Draft): string[] {
  const brief = d.seo_brief;
  if (!brief || !Array.isArray(brief.targetKeywords)) return [];
  return brief.targetKeywords.filter((k): k is string => typeof k === "string" && k.length > 0);
}

/**
 * Friendlier labels for the `template` column on content_drafts. Falls
 * through to a humanized version of the raw key if we don't have a label.
 */
const TEMPLATE_LABEL: Record<string, string> = {
  webpage: "Service / web page",
  faq: "FAQ article",
  guide: "Long-form guide",
  case_study: "Case study",
  blog_general: "Blog post",
  newsletter: "Newsletter",
  social_post: "Social post",
};

/**
 * Display label for a draft's "what kind of content is this" pill. Prefers:
 *   1. metadata.origin_context.page_type — set by the import flow with the
 *      precise option label the user picked.
 *   2. TEMPLATE_LABEL[d.template] — for system-generated drafts that have a
 *      template.
 *   3. d.format — the bare format column (blog / linkedin / etc).
 */
function draftTypeLabel(d: Draft): string {
  const meta = (d.metadata ?? {}) as Record<string, unknown>;
  const ctx =
    meta.origin_context && typeof meta.origin_context === "object"
      ? (meta.origin_context as Record<string, unknown>)
      : null;
  const pageType = ctx && typeof ctx.page_type === "string" ? ctx.page_type : null;
  if (pageType) return pageType;
  if (d.template && TEMPLATE_LABEL[d.template]) return TEMPLATE_LABEL[d.template];
  if (d.template) return d.template;
  return d.format;
}

type Analysis = {
  readability_score: number;
  reading_grade_level: number;
  word_count: number;
  sentence_count: number;
  keyword_density: Record<string, number>;
  target_keyword_hits: Record<string, number>;
  aeo_score: number;
  aeo_findings: string[];
  // Claude-backed scores are nullable: null means "couldn't compute, re-run".
  // Distinguishing this from a real 0 score keeps the UI from misleading users.
  brand_voice_score: number | null;
  brand_voice_findings: string[];
  cash_score: number | null;
  cash_breakdown?: {
    conversationalAuthority: number;
    answerCompleteness: number;
    sourceExpertise: number;
    humanAttribution: number;
  };
  cash_findings?: string[];
  seo_score?: number;
  seo_breakdown?: {
    titleQuality: number;
    headingStructure: number;
    keywordPlacement: number;
    authorityLinks: number;
    contentDepth: number;
    schemaReadiness: number;
  };
  seo_findings?: string[];
  linkability_score: number | null;
  linkability_findings?: string[];
  outreach_angles?: { audience: string; pitch: string }[];
  suggested_titles?: string[];
  // Live-only fields (stripped before persistence). Optional so older
  // analyses loaded from DB don't fail the type check.
  suggested_titles_conflicts_avoided?: number;
  suggested_titles_dropped?: {
    title: string;
    conflicts: {
      source: "pipeline" | "draft" | "ranked_keyword";
      text: string;
      url?: string | null;
      similarity: number;
    }[];
  }[];
  suggested_images?: { type: string; description: string; altText: string }[];
  summary: string;
};

type DraftStatus =
  | "initial_review"
  | "brief"
  | "draft"
  | "review"
  | "published";

const DRAFT_STATUSES: DraftStatus[] = [
  "initial_review",
  "brief",
  "draft",
  "review",
  "published",
];

const DRAFT_STATUS_LABEL: Record<DraftStatus, string> = {
  initial_review: "Initial review",
  brief: "Brief",
  draft: "Draft",
  review: "Review",
  published: "Published",
};

const DRAFT_STATUS_TONE: Record<
  DraftStatus,
  "violet" | "blue" | "amber" | "neutral" | "emerald" | "red"
> = {
  initial_review: "amber",
  brief: "blue",
  draft: "amber",
  review: "neutral",
  published: "emerald",
};

export default function DraftsPage() {
  const searchParams = useSearchParams();
  const contentType = readContentType(searchParams);

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDraft, setSelectedDraft] = useState<Draft | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [saving, setSaving] = useState(false);
  // Findings currently being processed by the Apply Suggestion modal. An
  // array of one or more — single-row Apply passes one, "Apply N selected"
  // passes the whole batch. Empty/null = modal closed.
  const [applyingFindings, setApplyingFindings] = useState<string[] | null>(
    null,
  );

  // Format filter buttons are restricted to the active type's formats.
  // "all" means all formats for the current type, not literally every draft.
  const typeFormats = CONTENT_TYPE_FORMATS[contentType];
  const formatFilters = useMemo(() => ["all", ...typeFormats], [typeFormats]);

  // Reset the format filter when the user switches the top-level type tab
  // so we don't leave a stale "linkedin" filter active when switching to
  // Website.
  useEffect(() => {
    setFilter("all");
  }, [contentType]);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/content/drafts");
      const data = await res.json();
      setDrafts(data.drafts ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  // Read ?id= or ?batch= from URL on mount.
  useEffect(() => {
    const url = new URL(window.location.href);
    const id = url.searchParams.get("id");
    if (id) setSelectedId(id);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelectedDraft(null);
      setAnalysis(null);
      return;
    }
    fetch(`/api/content/drafts/${selectedId}`)
      .then((r) => r.json())
      .then((data) => {
        setSelectedDraft(data.draft);
        setAnalysis(data.latest_analysis);
        setEditTitle(data.draft?.title ?? "");
        setEditBody(data.draft?.body ?? "");
      });
  }, [selectedId]);

  const filtered = useMemo(() => {
    const byType = drafts.filter((d) =>
      (typeFormats as readonly string[]).includes(d.format),
    );
    const byFormat =
      filter === "all" ? byType : byType.filter((d) => d.format === filter);
    if (!search.trim()) return byFormat;
    const lc = search.toLowerCase();
    return byFormat.filter(
      (d) =>
        d.topic.toLowerCase().includes(lc) ||
        (d.title ?? "").toLowerCase().includes(lc) ||
        d.body.toLowerCase().includes(lc),
    );
  }, [drafts, search, filter, typeFormats]);

  const save = async () => {
    if (!selectedDraft) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/content/drafts/${selectedDraft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle, body: editBody }),
      });
      const data = await res.json();
      setSelectedDraft(data);
      refresh();
    } finally {
      setSaving(false);
    }
  };

  const analyze = async () => {
    if (!selectedDraft) return;
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/content/drafts/${selectedDraft.id}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) setAnalysis(data);
    } finally {
      setAnalyzing(false);
    }
  };

  const updateStatus = async (status: string) => {
    if (!selectedDraft) return;
    await fetch(`/api/content/drafts/${selectedDraft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    refresh();
    fetch(`/api/content/drafts/${selectedDraft.id}`)
      .then((r) => r.json())
      .then((data) => setSelectedDraft(data.draft));
  };

  const remove = async () => {
    if (!selectedDraft || !confirm("Delete this draft?")) return;
    await fetch(`/api/content/drafts/${selectedDraft.id}`, { method: "DELETE" });
    setSelectedId(null);
    refresh();
  };

  /** Persist a new body after the user accepts an AI-proposed edit. */
  const acceptApply = async (newBody: string) => {
    if (!selectedDraft) return;
    const res = await fetch(`/api/content/drafts/${selectedDraft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: newBody }),
    });
    if (res.ok) {
      const data = await res.json();
      // Reflect the change in the editor + selectedDraft so the user sees
      // their accepted edit immediately.
      setSelectedDraft(data.draft ?? data);
      setEditBody(newBody);
    }
    setApplyingFindings(null);
  };

  /** Apply a suggested title — quick PATCH, no AI step needed. */
  const applyTitle = async (newTitle: string) => {
    if (!selectedDraft) return;
    const res = await fetch(`/api/content/drafts/${selectedDraft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle }),
    });
    if (res.ok) {
      const data = await res.json();
      setSelectedDraft(data.draft ?? data);
      setEditTitle(newTitle);
    }
  };

  const [importOpen, setImportOpen] = useState(false);

  const handleImported = (draftId: string) => {
    setImportOpen(false);
    setSelectedId(draftId);
    refresh();
    // Auto-run the full analysis pipeline so the imported draft has scores
    // ready by the time the detail panel loads on the right.
    fetch(`/api/content/drafts/${draftId}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setAnalysis(data);
      })
      .catch(() => {});
  };

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Content studio</h1>
          <p className="text-sm text-slate-600 mt-1">
            Every generation autosaves here. Edit, analyze, export. Showing{" "}
            <span className="font-medium">{CONTENT_TYPE_LABEL[contentType]}</span> drafts.
          </p>
        </div>
        <DashButton onClick={() => setImportOpen(true)}>
          + Import existing draft
        </DashButton>
      </div>
      <ContentTypeTabs />
      <ContentNav />

      {importOpen && (
        <ImportDraftModal
          defaultContentType={contentType}
          onClose={() => setImportOpen(false)}
          onImported={handleImported}
        />
      )}

      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        <div className="space-y-3">
          <DashCard padding="p-3">
            <DashInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search drafts…"
              className="w-full"
            />
            <div className="flex flex-wrap gap-1 mt-2">
              {formatFilters.map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-[11px] px-2 py-0.5 rounded-full border ${
                    filter === f
                      ? "border-[#185FA5] text-[#185FA5] bg-[#185FA5]/5"
                      : "border-slate-200 text-slate-600 hover:border-slate-400"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </DashCard>

          <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
            {loading && <DashSpinner />}
            {!loading && filtered.length === 0 && (
              <p className="text-xs text-slate-500">No drafts.</p>
            )}
            {filtered.map((d) => {
              const { label: originLabel } = readOrigin(d);
              return (
              <button
                key={d.id}
                onClick={() => setSelectedId(d.id)}
                className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
                  selectedId === d.id
                    ? "border-[#185FA5] bg-[#185FA5]/5"
                    : "border-slate-200 hover:border-slate-300 bg-white"
                }`}
              >
                <div className="flex items-center gap-2">
                  <DashPill tone="blue">{draftTypeLabel(d)}</DashPill>
                  {DRAFT_STATUSES.includes(d.status as DraftStatus) ? (
                    <DashPill tone={DRAFT_STATUS_TONE[d.status as DraftStatus]}>
                      {DRAFT_STATUS_LABEL[d.status as DraftStatus]}
                    </DashPill>
                  ) : (
                    <DashPill tone="emerald">{d.status}</DashPill>
                  )}
                </div>
                <div className="text-sm font-medium mt-1 line-clamp-2">
                  {d.title || d.topic}
                </div>
                {originLabel && (
                  <div className="text-[10px] uppercase tracking-wider text-violet-700 mt-1">
                    from: {originLabel}
                  </div>
                )}
                <div className="text-[11px] text-slate-500 mt-1">
                  {new Date(d.created_at).toLocaleString()}
                </div>
              </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          {!selectedDraft && (
            <DashCard className="text-center text-sm text-slate-500 py-12">
              Pick a draft from the list to view, edit, analyze, or export.
            </DashCard>
          )}
          {selectedDraft && (
            <>
              <DashCard>
                <div className="flex items-center gap-2 flex-wrap">
                  <DashPill tone="blue">{draftTypeLabel(selectedDraft)}</DashPill>
                  <DashPill tone="neutral">{selectedDraft.practice_area ?? "—"}</DashPill>
                  <span className="text-xs text-slate-500">
                    {new Date(selectedDraft.created_at).toLocaleString()}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <DraftStatusDropdown
                      current={selectedDraft.status}
                      onChange={updateStatus}
                    />
                    <a
                      href={`/api/content/drafts/${selectedDraft.id}/export-docx`}
                      className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-[#185FA5] hover:text-[#185FA5]"
                    >
                      ⬇ Export .docx
                    </a>
                    <button
                      onClick={remove}
                      className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="mt-3 text-xs text-slate-500">Topic: {selectedDraft.topic}</div>
                <DraftOriginPanel draft={selectedDraft} />
              </DashCard>

              <DashCard>
                <label className="text-xs font-medium text-slate-700">Title</label>
                <DashInput
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full mt-1 mb-3"
                />
                <label className="text-xs font-medium text-slate-700">Body</label>
                <textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={20}
                  className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm font-mono mt-1 focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30 focus:border-[#185FA5]"
                />
                <div className="mt-3 flex items-center gap-2">
                  <DashButton onClick={save} disabled={saving}>
                    {saving ? <DashSpinner /> : "Save"}
                  </DashButton>
                  <DashButton variant="outline" onClick={analyze} disabled={analyzing}>
                    {analyzing ? <DashSpinner /> : "Run analysis"}
                  </DashButton>
                </div>
              </DashCard>

              {analysis && (
                <AnalysisCard
                  analysis={analysis}
                  onRerun={analyze}
                  rerunning={analyzing}
                  onApplyFindings={(fs) => setApplyingFindings(fs)}
                  onApplyTitle={applyTitle}
                  currentTitle={selectedDraft.title}
                />
              )}

              {applyingFindings && selectedDraft && (
                <ApplySuggestionModal
                  draftId={selectedDraft.id}
                  findings={applyingFindings}
                  onAccept={acceptApply}
                  onClose={() => setApplyingFindings(null)}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DraftOriginPanel({ draft }: { draft: Draft }) {
  const { label, context } = readOrigin(draft);
  const targetKeywords = readTargetKeywords(draft);

  if (!label && targetKeywords.length === 0) return null;

  const sourceKeyword =
    context && typeof context.source_keyword === "string"
      ? (context.source_keyword as string)
      : null;
  const longTailPrompt =
    context && typeof context.long_tail_prompt === "string"
      ? (context.long_tail_prompt as string)
      : null;
  const competitor =
    context && typeof context.competitor === "string"
      ? (context.competitor as string)
      : null;

  return (
    <div className="mt-3 rounded-md border border-violet-200 bg-violet-50/40 px-3 py-2">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-violet-700">
        Origin
        {label && <DashPill tone="violet">{label}</DashPill>}
      </div>
      <div className="mt-1.5 space-y-1 text-xs text-slate-700">
        {sourceKeyword && (
          <div>
            <span className="text-slate-500">Source keyword:</span>{" "}
            <span className="font-medium">{sourceKeyword}</span>
          </div>
        )}
        {longTailPrompt && (
          <div>
            <span className="text-slate-500">Long-tail prompt:</span>{" "}
            <span className="italic">&ldquo;{longTailPrompt}&rdquo;</span>
          </div>
        )}
        {competitor && (
          <div>
            <span className="text-slate-500">Competitor:</span>{" "}
            <span className="font-medium">{competitor}</span>
          </div>
        )}
        {targetKeywords.length > 0 && (
          <div>
            <span className="text-slate-500">Focus keyword{targetKeywords.length > 1 ? "s" : ""}:</span>{" "}
            <span className="inline-flex flex-wrap gap-1 align-middle">
              {targetKeywords.map((k) => (
                <span
                  key={k}
                  className="rounded-full border border-violet-200 bg-white px-2 py-0.5 text-[11px] text-violet-800"
                >
                  {k}
                </span>
              ))}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function DraftStatusDropdown({
  current,
  onChange,
}: {
  current: string;
  onChange: (s: DraftStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const known = DRAFT_STATUSES.includes(current as DraftStatus);
  const tone = known ? DRAFT_STATUS_TONE[current as DraftStatus] : "neutral";
  const label = known ? DRAFT_STATUS_LABEL[current as DraftStatus] : current;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center"
        title="Change status. Moving out of Initial review puts the draft into the editorial pipeline."
      >
        <DashPill tone={tone}>{label} ▾</DashPill>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-1 z-40 bg-white border border-slate-200 rounded-md shadow-lg py-1 min-w-[160px]">
            {DRAFT_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => {
                  onChange(s);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 ${
                  s === current ? "font-semibold text-[#185FA5]" : "text-slate-700"
                }`}
              >
                {DRAFT_STATUS_LABEL[s]}
                {s === current ? " ✓" : ""}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AnalysisCard({
  analysis,
  onRerun,
  rerunning,
  onApplyFindings,
  onApplyTitle,
  currentTitle,
}: {
  analysis: Analysis;
  onRerun?: () => void;
  rerunning?: boolean;
  /** Called when the user invokes Apply — either via a single row's button
   *  or via "Apply N selected". The list contains one or more finding
   *  strings; the modal handles both shapes. */
  onApplyFindings?: (findings: string[]) => void;
  /** When provided, suggested titles get an inline Apply button that PATCHes
   *  the draft title to the picked option. */
  onApplyTitle?: (title: string) => void;
  /** Current draft title — used to mark the active title in the picker. */
  currentTitle?: string | null;
}) {
  // Set of finding strings the user has checked for batch-apply. Spans all
  // categories (SEO + AEO + CASH + brand voice + linkability) so the user
  // can mix and match before sending one Claude call.
  const [selectedFindings, setSelectedFindings] = useState<Set<string>>(
    new Set(),
  );
  const toggleFinding = (f: string) => {
    setSelectedFindings((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };
  const clearFindingSelection = () => setSelectedFindings(new Set());
  const handleApplySelected = () => {
    if (selectedFindings.size === 0 || !onApplyFindings) return;
    onApplyFindings(Array.from(selectedFindings));
    // Don't clear yet — wait until the modal closes (the user might Discard
    // and want to re-try). Cleared in onAccept via parent state reset.
  };
  const cash = analysis.cash_breakdown;
  const seoBreakdown = analysis.seo_breakdown;
  const hasMissingScores =
    analysis.brand_voice_score === null ||
    analysis.cash_score === null ||
    analysis.linkability_score === null;
  const selectedCount = selectedFindings.size;

  return (
    <DashCard>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="text-sm font-medium">Analysis</div>
        <div className="flex items-center gap-2">
          {onApplyFindings && selectedCount > 0 && (
            <>
              <button
                type="button"
                onClick={clearFindingSelection}
                className="text-xs text-slate-500 hover:text-slate-700 underline"
              >
                clear
              </button>
              <button
                type="button"
                onClick={handleApplySelected}
                className="text-xs px-2.5 py-1 rounded border border-emerald-400 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 inline-flex items-center gap-1.5 font-medium"
                title={`Send all ${selectedCount} selected findings to Claude in one shot — faster than applying one at a time.`}
              >
                <span aria-hidden>✨</span>
                Apply {selectedCount} selected
              </button>
            </>
          )}
          {onRerun && (
            <button
              type="button"
              onClick={onRerun}
              disabled={rerunning}
              className={`text-xs px-2.5 py-1 rounded border ${
                hasMissingScores
                  ? "border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100"
                  : "border-slate-300 text-slate-700 hover:border-[#185FA5] hover:text-[#185FA5]"
              } disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1.5`}
              title={
                hasMissingScores
                  ? "Some scores couldn't compute — try re-running."
                  : "Recompute all scores from scratch."
              }
            >
              {rerunning ? (
                <DashSpinner />
              ) : (
                <span aria-hidden>{hasMissingScores ? "⚠" : "↻"}</span>
              )}
              {rerunning ? "Re-running…" : "Re-run analysis"}
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <ScoreTile label="Readability" value={analysis.readability_score} />
        <ScoreTile
          label="SEO"
          value={analysis.seo_score ?? 0}
          hint="Title / headings / keyword placement / authority links / depth / schema"
        />
        <ScoreTile label="AEO" value={analysis.aeo_score} />
        <ScoreTile
          label="CASH (AI cite)"
          value={analysis.cash_score}
          hint="Conversational Authority / Answer / Source / Human"
        />
        <ScoreTile label="Brand voice" value={analysis.brand_voice_score} />
        <ScoreTile
          label="Linkability"
          value={analysis.linkability_score}
          hint="How earnable backlinks to this piece are"
        />
      </div>
      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <Tile label="Words" value={analysis.word_count} />
      </div>
      {seoBreakdown && (
        <div className="mt-4">
          <div className="text-xs font-medium text-slate-700 mb-2">SEO breakdown</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <SeoPillar label="Title" value={seoBreakdown.titleQuality} />
            <SeoPillar label="Headings" value={seoBreakdown.headingStructure} />
            <SeoPillar label="Keyword placement" value={seoBreakdown.keywordPlacement} />
            <SeoPillar label="Authority links" value={seoBreakdown.authorityLinks} />
            <SeoPillar label="Content depth" value={seoBreakdown.contentDepth} />
            <SeoPillar label="Schema readiness" value={seoBreakdown.schemaReadiness} />
          </div>
        </div>
      )}
      {cash && (
        <div className="mt-4">
          <div className="text-xs font-medium text-slate-700 mb-2">
            CASH breakdown (AI citation-worthiness)
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <CashPillar label="Conversational" letter="C" value={cash.conversationalAuthority} />
            <CashPillar label="Answer" letter="A" value={cash.answerCompleteness} />
            <CashPillar label="Source" letter="S" value={cash.sourceExpertise} />
            <CashPillar label="Human" letter="H" value={cash.humanAttribution} />
          </div>
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-4 mt-4">
        {analysis.seo_findings && analysis.seo_findings.length > 0 && (
          <FindingsList
            label="SEO findings"
            findings={analysis.seo_findings}
            onApply={onApplyFindings ? (f) => onApplyFindings([f]) : undefined}
            selected={selectedFindings}
            onToggleSelected={onApplyFindings ? toggleFinding : undefined}
          />
        )}
        <FindingsList
          label="AEO findings"
          findings={analysis.aeo_findings}
          onApply={onApplyFindings ? (f) => onApplyFindings([f]) : undefined}
          selected={selectedFindings}
          onToggleSelected={onApplyFindings ? toggleFinding : undefined}
        />
        {analysis.cash_findings && analysis.cash_findings.length > 0 && (
          <FindingsList
            label="CASH findings"
            findings={analysis.cash_findings}
            onApply={onApplyFindings ? (f) => onApplyFindings([f]) : undefined}
            selected={selectedFindings}
            onToggleSelected={onApplyFindings ? toggleFinding : undefined}
          />
        )}
        <FindingsList
          label="Brand voice findings"
          findings={analysis.brand_voice_findings}
          onApply={onApplyFindings ? (f) => onApplyFindings([f]) : undefined}
          selected={selectedFindings}
          onToggleSelected={onApplyFindings ? toggleFinding : undefined}
        />
      </div>
      {analysis.linkability_findings && analysis.linkability_findings.length > 0 && (
        <div className="mt-4">
          <FindingsList
            label="Linkability findings"
            findings={analysis.linkability_findings}
            onApply={onApplyFindings ? (f) => onApplyFindings([f]) : undefined}
            selected={selectedFindings}
            onToggleSelected={onApplyFindings ? toggleFinding : undefined}
          />
        </div>
      )}
      {analysis.outreach_angles && analysis.outreach_angles.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-medium text-slate-700 mb-2">
            Outreach angles (who to pitch + what to say)
          </div>
          <ul className="space-y-2">
            {analysis.outreach_angles.map((angle, i) => (
              <li
                key={i}
                className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <div className="text-[11px] uppercase tracking-wider text-slate-500">
                  {angle.audience}
                </div>
                <div className="text-xs text-slate-700 mt-0.5">{angle.pitch}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {analysis.suggested_titles && analysis.suggested_titles.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <div className="text-xs font-medium text-slate-700">
              Suggested titles
            </div>
            {(analysis.suggested_titles_conflicts_avoided ?? 0) > 0 && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full border border-amber-300 bg-amber-50 text-amber-800"
                title={
                  analysis.suggested_titles_dropped
                    ?.map(
                      (d) =>
                        `"${d.title}" conflicts with ${d.conflicts[0]?.source}: "${d.conflicts[0]?.text}"`,
                    )
                    .join("\n") ?? ""
                }
              >
                {analysis.suggested_titles_conflicts_avoided} conflict
                {analysis.suggested_titles_conflicts_avoided === 1 ? "" : "s"}{" "}
                avoided
              </span>
            )}
          </div>
          <ul className="space-y-1.5">
            {analysis.suggested_titles.map((t, i) => {
              const isCurrent = currentTitle && currentTitle.trim() === t.trim();
              return (
                <li
                  key={i}
                  className={`flex items-start gap-2 rounded-md border px-3 py-2 ${
                    isCurrent
                      ? "border-emerald-300 bg-emerald-50/60"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <span className="text-[10px] text-slate-400 mt-0.5 tabular-nums">
                    {i + 1}.
                  </span>
                  <span className="text-xs text-slate-800 flex-1">{t}</span>
                  <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
                    {t.length} chars
                  </span>
                  {onApplyTitle && !isCurrent && (
                    <button
                      type="button"
                      onClick={() => onApplyTitle(t)}
                      className="text-[10px] px-2 py-0.5 rounded border border-slate-300 text-slate-700 hover:border-[#185FA5] hover:text-[#185FA5] shrink-0"
                      title="Use this as the draft title"
                    >
                      Use
                    </button>
                  )}
                  {isCurrent && (
                    <span className="text-[10px] text-emerald-700 shrink-0">
                      Current
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {analysis.suggested_images && analysis.suggested_images.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-medium text-slate-700 mb-2">
            Suggested images
            <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-400">
              Click Create to generate, or hand off to Midjourney / DALL-E
            </span>
          </div>
          <ul className="space-y-2">
            {analysis.suggested_images.map((img, i) => (
              <li
                key={i}
                className="rounded-md border border-slate-200 bg-white px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-violet-700">
                    {img.type}
                  </span>
                  <a
                    href={`/content/images?prompt=${encodeURIComponent(
                      `${img.type ? `${img.type}: ` : ""}${img.description}`,
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50"
                  >
                    Create image
                  </a>
                </div>
                <div className="mt-1.5 text-xs text-slate-800">{img.description}</div>
                <div className="mt-1 text-[11px] italic text-slate-500">
                  <span className="font-semibold not-italic">Alt text:</span>{" "}
                  {img.altText}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {Object.keys(analysis.target_keyword_hits).length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-medium text-slate-700 mb-1">Target keyword hits</div>
          <div className="space-y-1.5">
            {Object.entries(analysis.target_keyword_hits).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 text-xs">
                <span className="w-48 truncate">{k}</span>
                <span className="w-8 text-right text-slate-600">{v}×</span>
                <DashPill tone={v === 0 ? "red" : v > 5 ? "amber" : "emerald"}>
                  {v === 0 ? "missing" : v > 5 ? "over-stuffed" : "good"}
                </DashPill>
              </div>
            ))}
          </div>
        </div>
      )}
      {analysis.summary && (
        <div className="mt-4 pt-4 border-t border-slate-200 text-sm italic text-slate-600">
          {analysis.summary}
        </div>
      )}
    </DashCard>
  );
}

/**
 * Findings list with a per-row "Apply" button. When onApply isn't provided
 * (e.g. for findings about meta-issues that don't have a clear in-body fix),
 * the component falls back to the original bulleted display.
 */
function FindingsList({
  label,
  findings,
  onApply,
  selected,
  onToggleSelected,
}: {
  label: string;
  findings: string[];
  /** Single-row Apply (the inline button). Receives one finding string. */
  onApply?: (finding: string) => void;
  /** Set of finding strings checked for batch-apply. */
  selected?: Set<string>;
  /** Called when the user toggles a row's checkbox. */
  onToggleSelected?: (finding: string) => void;
}) {
  // Some findings describe meta-issues (missing keywords on the draft,
  // analysis failures, scoring re-run prompts) that an in-body edit can't
  // fix. Filter Apply out of those so users don't waste a Claude call.
  const isApplicable = (f: string) => {
    const lc = f.toLowerCase();
    return !(
      lc.includes("scoring couldn't run") ||
      lc.includes("scoring failed") ||
      lc.includes("re-run analysis") ||
      lc.includes("no target keywords set") ||
      lc.includes("recommended structured data")
    );
  };

  // Select-all-in-this-list helper. Only operates on applicable findings.
  const applicableCount = findings.filter(isApplicable).length;
  const selectedHereCount = onToggleSelected
    ? findings.filter((f) => isApplicable(f) && selected?.has(f)).length
    : 0;
  const allSelectedHere =
    applicableCount > 0 && selectedHereCount === applicableCount;
  const toggleAllInList = () => {
    if (!onToggleSelected) return;
    if (allSelectedHere) {
      // Untoggle each applicable finding
      for (const f of findings) {
        if (isApplicable(f) && selected?.has(f)) onToggleSelected(f);
      }
    } else {
      for (const f of findings) {
        if (isApplicable(f) && !selected?.has(f)) onToggleSelected(f);
      }
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs font-medium text-slate-700">{label}</div>
        {onToggleSelected && applicableCount > 1 && (
          <button
            type="button"
            onClick={toggleAllInList}
            className="text-[10px] text-slate-500 hover:text-[#185FA5] underline"
          >
            {allSelectedHere ? "deselect all" : "select all"}
          </button>
        )}
      </div>
      <ul className="text-xs space-y-1.5">
        {findings.map((f, i) => {
          const applicable = isApplicable(f);
          const isSelected = !!selected?.has(f);
          return (
            <li
              key={i}
              className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 ${
                isSelected
                  ? "border-emerald-300 bg-emerald-50/60"
                  : "border-slate-200 bg-white/60"
              }`}
            >
              {onToggleSelected && applicable ? (
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelected(f)}
                  className="mt-0.5 accent-emerald-600 cursor-pointer"
                  title="Include in batch Apply"
                />
              ) : (
                <span aria-hidden className="text-slate-400 mt-0.5">
                  ·
                </span>
              )}
              <span className="flex-1 text-slate-700">{f}</span>
              {onApply && applicable && (
                <button
                  type="button"
                  onClick={() => onApply(f)}
                  className="text-[10px] px-2 py-0.5 rounded border border-slate-300 text-slate-700 hover:border-[#185FA5] hover:text-[#185FA5] shrink-0"
                  title="Apply just this one"
                >
                  Apply
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Diff modal for the Apply Suggestion flow. Loads a proposed edit from the
 * AI, shows before/after, lets the user accept or discard. The accept
 * callback is responsible for PATCHing the draft — this component only
 * surfaces the candidate edit.
 */
function ApplySuggestionModal({
  draftId,
  findings,
  onAccept,
  onClose,
}: {
  draftId: string;
  /** One or more findings to apply. Multi-mode triggers a richer header
   *  listing each finding so the user can verify the batch before accepting. */
  findings: string[];
  onAccept: (newBody: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const isMulti = findings.length > 1;
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [originalBody, setOriginalBody] = useState<string>("");
  const [updatedBody, setUpdatedBody] = useState<string>("");
  const [summary, setSummary] = useState<string>("");
  const [noChange, setNoChange] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/content/drafts/${draftId}/apply-suggestion`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Always send as an array — backend handles both keys.
            body: JSON.stringify({ findings }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Apply failed");
        if (cancelled) return;
        setOriginalBody(data.original_body ?? "");
        setUpdatedBody(data.updated_body ?? "");
        setSummary(data.summary ?? "");
        setNoChange(!!data.no_change);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // join() gives a stable dep value so swapping order of an identical
    // findings list doesn't trigger a re-fetch.
  }, [draftId, findings.join("\n")]);

  const handleAccept = async () => {
    setAccepting(true);
    try {
      await onAccept(updatedBody);
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-5xl max-h-[90vh] flex flex-col rounded-xl bg-white border border-slate-200 shadow-xl relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-slate-400 hover:text-slate-700 text-xl"
          aria-label="Close"
        >
          ×
        </button>
        <div className="p-5 border-b border-slate-200">
          <h2 className="text-base font-semibold">
            {isMulti
              ? `Apply ${findings.length} suggestions`
              : "Apply suggestion"}
          </h2>
          {isMulti ? (
            <div className="text-xs text-slate-600 mt-1.5">
              <div className="font-medium mb-1">Findings being applied:</div>
              <ol className="list-decimal pl-5 space-y-0.5 max-h-24 overflow-auto">
                {findings.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="text-xs text-slate-600 mt-1">
              <span className="font-medium">Finding:</span> {findings[0]}
            </p>
          )}
        </div>

        {loading ? (
          <div className="p-12 flex flex-col items-center gap-3 text-sm text-slate-600">
            <DashSpinner />
            {isMulti
              ? `Asking Claude to resolve all ${findings.length} in one pass…`
              : "Asking Claude for the smallest edit that resolves this…"}
          </div>
        ) : error ? (
          <div className="p-5 text-sm text-red-700 bg-red-50 border-t border-red-200">
            {error}
            <div className="mt-3">
              <DashButton variant="outline" onClick={onClose}>
                Close
              </DashButton>
            </div>
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
              <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">
                Summary
              </div>
              <div className="text-sm text-slate-800">
                {summary || "(no summary returned)"}
              </div>
              {noChange && (
                <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded px-2 py-1">
                  Claude decided not to change the draft. Read the summary
                  before accepting — there&apos;s no edit to apply.
                </div>
              )}
            </div>

            <RedlinePanel original={originalBody} updated={updatedBody} />


            <div className="p-4 border-t border-slate-200 flex items-center justify-end gap-2">
              <DashButton variant="outline" onClick={onClose} disabled={accepting}>
                Discard
              </DashButton>
              <DashButton onClick={handleAccept} disabled={accepting || noChange}>
                {accepting ? <DashSpinner /> : "Accept changes"}
              </DashButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Word-level redline diff between two text blobs. Renders in a single
 * scrollable pane in the format a legal editor expects:
 *   - Deletions: red, line-through
 *   - Additions: green background, underlined
 *   - Unchanged: regular color
 *
 * Diff is computed lazily via useMemo so re-renders during scroll don't
 * re-run the diff algorithm. For drafts up to ~10k chars (well above our
 * typical post length) this is sub-50ms on commodity hardware.
 */
function RedlinePanel({
  original,
  updated,
}: {
  original: string;
  updated: string;
}) {
  const changes = useMemo<Change[]>(
    () => diffWords(original, updated),
    [original, updated],
  );

  const hasAnyChange = changes.some((c) => c.added || c.removed);

  // Counts surfaced in the legend so the user can scan "what's the scope of
  // this edit" without reading the whole pane.
  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const c of changes) {
      if (c.added) added += c.value.trim() ? c.value.trim().split(/\s+/).length : 0;
      if (c.removed) removed += c.value.trim() ? c.value.trim().split(/\s+/).length : 0;
    }
    return { added, removed };
  }, [changes]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 text-[11px] bg-slate-50 border-b border-slate-200">
        <span className="uppercase tracking-wider text-slate-500 font-medium">
          Redline
        </span>
        <span className="inline-flex items-center gap-1 text-emerald-700">
          <span className="inline-block w-3 h-3 rounded-sm bg-emerald-100 border border-emerald-400" />
          added
          {stats.added > 0 && (
            <span className="tabular-nums">({stats.added})</span>
          )}
        </span>
        <span className="inline-flex items-center gap-1 text-red-700">
          <span className="inline-block w-3 h-3 rounded-sm bg-red-100 border border-red-400" />
          removed
          {stats.removed > 0 && (
            <span className="tabular-nums">({stats.removed})</span>
          )}
        </span>
        {!hasAnyChange && (
          <span className="text-slate-500 italic ml-auto">
            (no changes — text is identical)
          </span>
        )}
      </div>
      <pre className="flex-1 overflow-auto p-4 text-xs whitespace-pre-wrap font-mono text-slate-700 leading-relaxed">
        {changes.map((c, i) => {
          if (c.added) {
            return (
              <span
                key={i}
                className="bg-emerald-100 text-emerald-900 underline decoration-emerald-500 decoration-1"
              >
                {c.value}
              </span>
            );
          }
          if (c.removed) {
            return (
              <span
                key={i}
                className="bg-red-100 text-red-800 line-through decoration-red-500 decoration-1"
              >
                {c.value}
              </span>
            );
          }
          return <span key={i}>{c.value}</span>;
        })}
      </pre>
    </div>
  );
}

function SeoPillar({ label, value }: { label: string; value: number }) {
  const tone =
    value >= 70
      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
      : value >= 40
        ? "border-amber-300 bg-amber-50 text-amber-700"
        : "border-red-300 bg-red-50 text-red-700";
  return (
    <div className={`rounded-md border px-2 py-1.5 ${tone}`}>
      <div className="flex items-baseline gap-1.5">
        <span className="text-base font-semibold tabular-nums">{value}</span>
      </div>
      <div className="text-[10px] opacity-80">{label}</div>
    </div>
  );
}

function ScoreTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | null;
  hint?: string;
}) {
  // null means "couldn't compute" (Claude failure). Render an obvious "n/a"
  // rather than a red 0 that misrepresents the content.
  if (value === null) {
    return (
      <div
        className="rounded-lg border border-dashed border-slate-300 p-3 bg-slate-50/60"
        title={hint ? `${hint} — couldn't compute, re-run analysis` : "Couldn't compute — re-run analysis"}
      >
        <div className="text-2xl font-bold text-slate-400">n/a</div>
        <div className="text-xs text-slate-500 mt-1">{label}</div>
        <div className="text-[10px] text-slate-400 mt-2 italic">
          re-run analysis
        </div>
      </div>
    );
  }
  const tone = value >= 70 ? "emerald" : value >= 40 ? "amber" : "red";
  const color = tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-red-700";
  return (
    <div className="rounded-lg border border-slate-200 p-3" title={hint}>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
      <div className="mt-2"><DashBar pct={value} tone={tone === "emerald" ? "self" : "blue"} /></div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}

function CashPillar({
  label,
  letter,
  value,
}: {
  label: string;
  letter: string;
  value: number;
}) {
  const tone =
    value >= 70
      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
      : value >= 40
        ? "border-amber-300 bg-amber-50 text-amber-700"
        : "border-red-300 bg-red-50 text-red-700";
  return (
    <div className={`rounded-md border px-2 py-1.5 ${tone}`}>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-xs font-bold">{letter}</span>
        <span className="text-base font-semibold tabular-nums">{value}</span>
      </div>
      <div className="text-[10px] opacity-80">{label}</div>
    </div>
  );
}

/**
 * Each option maps a user-facing page type to a `format` (the column on
 * content_drafts that decides Website / Social / Email grouping) and an
 * optional `template` (the structural variant within that format — service
 * page vs FAQ vs blog post). The analysis pipeline uses both as context.
 */
const IMPORT_FORMAT_OPTIONS: {
  value: string;
  label: string;
  contentType: "website" | "social" | "email";
  format: string;
  template: string | null;
}[] = [
  // Website
  { value: "service_page", label: "Service / practice area page", contentType: "website", format: "blog", template: "webpage" },
  { value: "webpage", label: "Web page (general)", contentType: "website", format: "blog", template: "webpage" },
  { value: "location_page", label: "Location page (borough / city)", contentType: "website", format: "blog", template: "webpage" },
  { value: "faq", label: "FAQ article", contentType: "website", format: "blog", template: "faq" },
  { value: "guide", label: "Long-form guide / pillar", contentType: "website", format: "blog", template: "guide" },
  { value: "case_study", label: "Case study", contentType: "website", format: "blog", template: "case_study" },
  { value: "blog_post", label: "Blog post", contentType: "website", format: "blog", template: "blog_general" },
  // Social
  { value: "linkedin", label: "LinkedIn post", contentType: "social", format: "linkedin", template: "social_post" },
  { value: "twitter", label: "Twitter / X thread", contentType: "social", format: "twitter", template: null },
  { value: "facebook", label: "Facebook post", contentType: "social", format: "facebook", template: null },
  { value: "instagram", label: "Instagram caption", contentType: "social", format: "instagram", template: null },
  { value: "podcast", label: "Podcast script", contentType: "social", format: "podcast", template: null },
  // Email
  { value: "email_newsletter", label: "Email — newsletter", contentType: "email", format: "email", template: "newsletter" },
  { value: "email_case_update", label: "Email — case update", contentType: "email", format: "email", template: "case_study" },
];

const IMPORT_PRACTICE_AREAS = [
  "General",
  "Wage & Hour",
  "Discrimination",
  "Class Action",
  "Judgment Enforcement",
  "Severance",
];

function ImportDraftModal({
  defaultContentType,
  onClose,
  onImported,
}: {
  defaultContentType: "website" | "social" | "email";
  onClose: () => void;
  onImported: (draftId: string) => void;
}) {
  const [mode, setMode] = useState<"paste" | "file">("paste");
  // `formatOption` is the option `value` (e.g. "service_page"). The real
  // `format` + `template` sent to the API are looked up from the option.
  const [formatOption, setFormatOption] = useState<string>(
    IMPORT_FORMAT_OPTIONS.find((f) => f.contentType === defaultContentType)?.value ??
      "blog_post",
  );
  const selectedOption =
    IMPORT_FORMAT_OPTIONS.find((f) => f.value === formatOption) ?? IMPORT_FORMAT_OPTIONS[0];
  const [topic, setTopic] = useState("");
  const [title, setTitle] = useState("");
  const [practiceArea, setPracticeArea] = useState("General");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [targetKeywords, setTargetKeywords] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    !submitting &&
    topic.trim().length > 0 &&
    (mode === "paste" ? body.trim().length > 0 : file !== null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      let res: Response;
      if (mode === "file") {
        if (!file) {
          setError("Pick a file to upload.");
          setSubmitting(false);
          return;
        }
        const form = new FormData();
        form.append("file", file);
        form.append("format", selectedOption.format);
        if (selectedOption.template) form.append("template", selectedOption.template);
        form.append("formatOptionLabel", selectedOption.label);
        form.append("topic", topic.trim());
        if (title.trim()) form.append("title", title.trim());
        if (practiceArea) form.append("practiceArea", practiceArea);
        if (targetKeywords.trim()) form.append("targetKeywords", targetKeywords.trim());
        res = await fetch("/api/content/drafts/import", {
          method: "POST",
          body: form,
        });
      } else {
        res = await fetch("/api/content/drafts/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            format: selectedOption.format,
            template: selectedOption.template,
            formatOptionLabel: selectedOption.label,
            topic: topic.trim(),
            title: title.trim() || undefined,
            body,
            practiceArea,
            targetKeywords: targetKeywords
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          }),
        });
      }
      const data = await res.json();
      if (!res.ok || !data?.draft_id) {
        setError(data?.error ?? "Import failed.");
        setSubmitting(false);
        return;
      }
      onImported(data.draft_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold">Import existing draft</h3>
            <p className="mt-1 text-xs text-slate-500">
              Bring in content drafted outside the system so it can be analyzed
              (Readability / AEO / Brand voice / CASH) and tracked alongside
              AI-generated drafts.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="inline-flex rounded-lg border border-slate-200 p-1">
            <button
              type="button"
              onClick={() => setMode("paste")}
              className={`text-xs px-3 py-1.5 rounded ${
                mode === "paste"
                  ? "bg-[#185FA5] text-white"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              Paste text
            </button>
            <button
              type="button"
              onClick={() => setMode("file")}
              className={`text-xs px-3 py-1.5 rounded ${
                mode === "file"
                  ? "bg-[#185FA5] text-white"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              Upload file
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-700">Topic</label>
              <DashInput
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. NYC wrongful termination FAQ"
                className="w-full mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">
                Title (optional)
              </label>
              <DashInput
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="If different from topic"
                className="w-full mt-1"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-700">Type</label>
              <select
                value={formatOption}
                onChange={(e) => setFormatOption(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-md border border-slate-300 text-sm focus:border-[#185FA5] focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30"
              >
                <optgroup label="Website">
                  {IMPORT_FORMAT_OPTIONS.filter((f) => f.contentType === "website").map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Social media">
                  {IMPORT_FORMAT_OPTIONS.filter((f) => f.contentType === "social").map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Email">
                  {IMPORT_FORMAT_OPTIONS.filter((f) => f.contentType === "email").map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">
                Practice area
              </label>
              <select
                value={practiceArea}
                onChange={(e) => setPracticeArea(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-md border border-slate-300 text-sm focus:border-[#185FA5] focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30"
              >
                {IMPORT_PRACTICE_AREAS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">
              Target keywords (comma separated, optional)
            </label>
            <DashInput
              value={targetKeywords}
              onChange={(e) => setTargetKeywords(e.target.value)}
              placeholder="wrongful termination nyc, retaliation lawyer"
              className="w-full mt-1"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Used by the AEO + target-keyword-hits scoring.
            </p>
          </div>

          {mode === "paste" ? (
            <div>
              <label className="text-xs font-medium text-slate-700">
                Paste the full draft
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                placeholder="Paste plain text or markdown…"
                className="w-full mt-1 px-3 py-2 rounded-md border border-slate-300 text-sm font-mono focus:border-[#185FA5] focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Markdown formatting is preserved.
              </p>
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium text-slate-700">
                Upload a document
              </label>
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md,.rtf,.html,.htm"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full mt-1 text-sm text-slate-600"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Accepts .pdf, .docx, .txt, .md, .rtf, .html. The server
                extracts the text and stores it as the draft body.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
            <DashButton variant="outline" onClick={onClose}>
              Cancel
            </DashButton>
            <DashButton onClick={submit} disabled={!canSubmit}>
              {submitting ? <DashSpinner /> : "Import + analyze"}
            </DashButton>
          </div>
        </div>
      </div>
    </div>
  );
}
