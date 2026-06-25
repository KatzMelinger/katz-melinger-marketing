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

import { useEffect, useRef, useState, useMemo } from "react";
import MarkdownEditor, { type MarkdownEditorHandle } from "@/components/markdown-editor";
import { useReadabilityRanges } from "@/lib/readability/use-readability";
import {
  AnalysisCard,
  ApplySuggestionModal,
  type Analysis,
} from "@/components/analysis-card";
import { useSearchParams } from "next/navigation";
import { marked } from "marked";

/**
 * Prose styling for rendered markdown previews — kept identical to the Content
 * Studio preview (app/content/page.tsx) so a draft looks the same everywhere.
 */
const PROSE_CLASS =
  "[&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-2 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_strong]:font-semibold [&_em]:italic [&_a]:text-brand [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:my-2 [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_table]:my-2 [&_table]:w-full [&_th]:border [&_th]:border-slate-200 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1";

import { ContentNav } from "@/components/content-nav";
import { ContentTypeTabs } from "@/components/content-type-tabs";
import {
  DashCard,
  DashButton,
  DashInput,
  DashPill,
  DashSpinner,
} from "@/components/dashboard-ui";
import {
  CONTENT_TYPE_FORMATS,
  CONTENT_TYPE_LABEL,
  readContentType,
} from "@/lib/content-types";
import { DEFAULT_PRACTICE_AREAS } from "@/lib/practice-areas";
import { ALL_KM_PILLARS } from "@/lib/km-content-system";

const PILLAR_LABEL: Record<string, string> = Object.fromEntries(
  ALL_KM_PILLARS.map((p) => [p.id, p.label]),
);

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
 * Friendlier labels for the raw `format` column — used as the final fallback
 * for templateless drafts (social/audio/video) so the type pill doesn't show
 * a bare key like "video_short".
 */
const FORMAT_LABEL: Record<string, string> = {
  blog: "Blog post",
  linkedin: "LinkedIn post",
  twitter: "Twitter / X thread",
  facebook: "Facebook post",
  instagram: "Instagram caption",
  email: "Email",
  podcast: "Podcast script",
  video_short: "Short video script",
  video_long: "YouTube video script",
  // KM-generated website formats (km_${contentType} from /api/content/km-draft).
  km_practice_page: "Service / web page",
  km_blog_post: "Blog post",
  km_case_result: "Case result",
};

/**
 * Website drafts come in three editorial kinds that don't map 1:1 to the raw
 * `format` column: imports are all format "blog" distinguished by `template`
 * (webpage / case_study / blog_general), while KM-generated drafts use km_*
 * formats. This classifier collapses both into the kind Diana filters by.
 */
type WebsiteKind = "service_page" | "case_result" | "blog";

function websiteKind(d: Draft): WebsiteKind {
  const meta = (d.metadata ?? {}) as Record<string, unknown>;
  const ctx =
    meta.origin_context && typeof meta.origin_context === "object"
      ? (meta.origin_context as Record<string, unknown>)
      : null;
  const pageType = (
    ctx && typeof ctx.page_type === "string" ? ctx.page_type : ""
  ).toLowerCase();
  const fmt = d.format;
  const tmpl = d.template ?? "";
  if (
    fmt === "km_practice_page" ||
    tmpl === "webpage" ||
    /service|web page|location|practice area/.test(pageType)
  ) {
    return "service_page";
  }
  if (fmt === "km_case_result" || tmpl === "case_study" || /case result|case study/.test(pageType)) {
    return "case_result";
  }
  return "blog";
}

const WEBSITE_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "blog", label: "Blog post" },
  { key: "service_page", label: "Service / web page" },
  { key: "case_result", label: "Case result" },
];

/** Friendly label for a filter chip — website kinds, then formats, then raw. */
function filterLabel(f: string): string {
  const w = WEBSITE_FILTERS.find((x) => x.key === f);
  if (w) return w.label;
  if (f === "all") return "All";
  return FORMAT_LABEL[f] ?? f;
}

/**
 * Diana's "which pillar + keyword is this draft for" label, replacing the
 * unhelpful raw origin source (e.g. MARKETING_ALERT_ANALYSIS). Derived from the
 * KM brief / SEO brief stored on the draft. Falls back to the keyword alone.
 */
function readPillarKeyword(d: Draft): string | null {
  const meta = (d.metadata ?? {}) as Record<string, unknown>;
  const brief =
    meta.km_brief && typeof meta.km_brief === "object"
      ? (meta.km_brief as Record<string, unknown>)
      : null;
  const seo = (d.seo_brief ?? null) as Record<string, unknown> | null;
  const primary = String(brief?.primaryKeyword ?? seo?.primaryKeyword ?? "").trim();
  const pillarId = String(brief?.pillarId ?? seo?.pillarId ?? "").trim();
  const pillarLabel = pillarId ? PILLAR_LABEL[pillarId] ?? "" : "";
  if (pillarLabel && primary) return `${pillarLabel} — ${primary}`;
  if (primary) return primary;
  return null;
}

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
  return FORMAT_LABEL[d.format] ?? d.format;
}



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
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const { ranges: readabilityRanges } = useReadabilityRanges(editBody);
  // Findings currently being processed by the Apply Suggestion modal. An
  // array of one or more — single-row Apply passes one, "Apply N selected"
  // passes the whole batch. Empty/null = modal closed.
  const [applyingFindings, setApplyingFindings] = useState<string[] | null>(
    null,
  );
  const [approveMsg, setApproveMsg] = useState<string | null>(null);
  const [bodyView, setBodyView] = useState<"write" | "preview">("write");

  // Format filter buttons are restricted to the active type's formats.
  // "all" means all formats for the current type, not literally every draft.
  const typeFormats = CONTENT_TYPE_FORMATS[contentType];
  const formatFilters = useMemo(
    () =>
      contentType === "website"
        ? WEBSITE_FILTERS.map((f) => f.key)
        : ["all", ...typeFormats],
    [contentType, typeFormats],
  );

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
    setApproveMsg(null);
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
    // Website = imported "blog"-format drafts + KM-generated km_* formats,
    // filtered by editorial kind. Social/email keep simple format filters.
    const byType =
      contentType === "website"
        ? drafts.filter((d) => d.format === "blog" || d.format.startsWith("km_"))
        : drafts.filter((d) => (typeFormats as readonly string[]).includes(d.format));
    const byFilter =
      filter === "all"
        ? byType
        : contentType === "website"
          ? byType.filter((d) => websiteKind(d) === filter)
          : byType.filter((d) => d.format === filter);
    if (!search.trim()) return byFilter;
    const lc = search.toLowerCase();
    return byFilter.filter(
      (d) =>
        d.topic.toLowerCase().includes(lc) ||
        (d.title ?? "").toLowerCase().includes(lc) ||
        d.body.toLowerCase().includes(lc),
    );
  }, [drafts, search, filter, typeFormats, contentType]);

  // Rendered HTML for the Body "Preview" tab. marked.parse is sync here (no
  // async extensions configured), matching the Content Studio preview.
  const renderedBody = useMemo(
    () =>
      editBody.trim()
        ? (marked.parse(editBody, { async: false }) as string)
        : "<p class='text-slate-400'>Nothing to preview yet.</p>",
    [editBody],
  );

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

  // Approve → QA. Setting the draft status to "review" is synced by the
  // drafts [id] PATCH route to the linked Production Board row (and creates one
  // if none exists), which the Publishing QA stage reads (?status=review).
  const approveToQA = async () => {
    if (!selectedDraft) return;
    await updateStatus("review");
    setApproveMsg("Approved — moved to QA. The Production Board item is now at Review (Publishing QA).");
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
                      ? "border-brand text-brand bg-brand/5"
                      : "border-slate-200 text-slate-600 hover:border-slate-400"
                  }`}
                >
                  {filterLabel(f)}
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
              const sourceLabel = readPillarKeyword(d) ?? readOrigin(d).label;
              return (
              <button
                key={d.id}
                onClick={() => setSelectedId(d.id)}
                className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
                  selectedId === d.id
                    ? "border-brand bg-brand/5"
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
                {sourceLabel && (
                  <div className="text-[10px] uppercase tracking-wider text-violet-700 mt-1">
                    from: {sourceLabel}
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
                    {selectedDraft.status !== "review" &&
                      selectedDraft.status !== "published" && (
                        <button
                          onClick={approveToQA}
                          className="text-xs px-2 py-1 rounded bg-emerald-600 text-white font-medium hover:bg-emerald-700"
                          title="Approve this draft and move the Production Board item to QA"
                        >
                          ✓ Approve → QA
                        </button>
                      )}
                    <DraftStatusDropdown
                      current={selectedDraft.status}
                      onChange={updateStatus}
                    />
                    <a
                      href={`/api/content/drafts/${selectedDraft.id}/export-docx`}
                      className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-brand hover:text-brand"
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
                {approveMsg && (
                  <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
                    {approveMsg}
                  </p>
                )}
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
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-700">Body</label>
                  <div className="inline-flex rounded-md border border-slate-200 p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setBodyView("write")}
                      className={`px-2 py-0.5 rounded ${
                        bodyView === "write"
                          ? "bg-brand text-white"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Write
                    </button>
                    <button
                      type="button"
                      onClick={() => setBodyView("preview")}
                      className={`px-2 py-0.5 rounded ${
                        bodyView === "preview"
                          ? "bg-brand text-white"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Preview
                    </button>
                  </div>
                </div>
                {bodyView === "write" ? (
                  <div className="w-full rounded-md border border-slate-300 text-sm mt-1 overflow-hidden focus-within:ring-2 focus-within:ring-brand/30 focus-within:border-brand [&_.cm-editor]:max-h-[60vh] [&_.cm-content]:font-mono [&_.cm-content]:py-2 [&_.cm-content]:px-3">
                    <MarkdownEditor
                      ref={editorRef}
                      value={editBody}
                      onChange={setEditBody}
                      ranges={readabilityRanges}
                    />
                  </div>
                ) : (
                  <div
                    className={`w-full min-h-[20rem] max-h-[60vh] overflow-y-auto px-4 py-3 rounded-md border border-slate-300 bg-white text-sm text-slate-800 mt-1 ${PROSE_CLASS}`}
                    dangerouslySetInnerHTML={{ __html: renderedBody }}
                  />
                )}
                <div className="mt-3 flex items-center gap-2">
                  <DashButton onClick={save} disabled={saving}>
                    {saving ? <DashSpinner /> : "Save"}
                  </DashButton>
                  <DashButton variant="outline" onClick={analyze} disabled={analyzing}>
                    {analyzing ? <DashSpinner /> : "Run analysis"}
                  </DashButton>
                </div>
              </DashCard>

              <LinkVerificationCard
                draftId={selectedDraft.id}
                onBodyChange={(b) => {
                  setEditBody(b);
                  setSelectedDraft((d) => (d ? { ...d, body: b } : d));
                }}
              />

              {analysis && (
                <AnalysisCard
                  analysis={analysis}
                  body={editBody}
                  onSelectRange={(s, e) => editorRef.current?.selectRange(s, e)}
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
  const { label: originLabel, context } = readOrigin(draft);
  const label = readPillarKeyword(draft) ?? originLabel;
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
                  s === current ? "font-semibold text-brand" : "text-slate-700"
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

type VerifiedLink = {
  href: string;
  anchor: string;
  type: "internal" | "external";
  status: "confirmed" | "unverified" | "external";
  matchedUrl?: string;
  matchedTitle?: string | null;
};
type LinkVerifyResult = {
  links: VerifiedLink[];
  counts: { total: number; confirmed: number; unverified: number; external: number };
};

/**
 * Publishing-QA link check. Verifies every link in the draft against the
 * Cluster Map: confirmed (live), unverified (likely invented), or external.
 * Unverified internal links can be stripped before a human publishes.
 */
function LinkVerificationCard({
  draftId,
  onBodyChange,
}: {
  draftId: string;
  onBodyChange: (body: string) => void;
}) {
  const [result, setResult] = useState<LinkVerifyResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (strip: boolean) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/content/drafts/${draftId}/verify-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strip }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ links: data.links ?? [], counts: data.counts });
        if (data.stripped && typeof data.body === "string") onBodyChange(data.body);
      }
    } finally {
      setBusy(false);
    }
  };

  // Auto-verify on load / when switching drafts so the reviewer sees link
  // status without clicking. Read-only — stripping invented links stays the
  // deliberate one-click action below (we never silently delete from a draft).
  useEffect(() => {
    setResult(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/content/drafts/${draftId}/verify-links`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ strip: false }),
        });
        const data = await res.json();
        if (!cancelled && res.ok) {
          setResult({ links: data.links ?? [], counts: data.counts });
        }
      } catch {
        /* leave unverified — the manual "Verify links" button still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  const toneFor = (s: VerifiedLink["status"]): "emerald" | "red" | "neutral" =>
    s === "confirmed" ? "emerald" : s === "unverified" ? "red" : "neutral";
  const labelFor = (s: VerifiedLink["status"]) =>
    s === "confirmed" ? "Live" : s === "unverified" ? "Needs verification" : "External";

  return (
    <DashCard>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Link verification</h3>
          <p className="text-xs text-slate-500">
            Checks every link against the live Cluster Map before publishing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {result && result.counts.unverified > 0 && (
            <DashButton variant="danger" onClick={() => run(true)} disabled={busy}>
              {busy ? <DashSpinner /> : `Strip ${result.counts.unverified} invented`}
            </DashButton>
          )}
          <DashButton variant="outline" onClick={() => run(false)} disabled={busy}>
            {busy ? <DashSpinner /> : result ? "Re-check" : "Verify links"}
          </DashButton>
        </div>
      </div>

      {result && (
        <div className="mt-3">
          <div className="mb-2 flex flex-wrap gap-2 text-xs">
            <DashPill tone="emerald">{result.counts.confirmed} live</DashPill>
            <DashPill tone={result.counts.unverified > 0 ? "red" : "neutral"}>
              {result.counts.unverified} needs verification
            </DashPill>
            <DashPill tone="neutral">{result.counts.external} external</DashPill>
          </div>
          {result.counts.total === 0 ? (
            <p className="text-xs text-slate-400">No links found in this draft.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {result.links.map((l, i) => (
                <li key={`${l.href}-${i}`} className="flex items-start gap-2 px-3 py-2 text-sm">
                  <DashPill tone={toneFor(l.status)}>{labelFor(l.status)}</DashPill>
                  <span className="min-w-0 flex-1">
                    <span className="text-slate-800">{l.anchor || "(no anchor)"}</span>
                    <span className="block truncate text-[11px] text-slate-400">
                      {l.href}
                      {l.matchedTitle ? ` → ${l.matchedTitle}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {result.counts.unverified > 0 && (
            <p className="mt-2 text-[11px] text-red-600">
              {result.counts.unverified} internal link
              {result.counts.unverified > 1 ? "s do" : " does"} not match any live page. Strip
              {result.counts.unverified > 1 ? " them" : " it"} before publishing.
            </p>
          )}
        </div>
      )}
    </DashCard>
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
  { value: "video_short", label: "Short video script (Reels/TikTok)", contentType: "social", format: "video_short", template: null },
  { value: "video_long", label: "YouTube video script", contentType: "social", format: "video_long", template: null },
  // Email
  { value: "email_newsletter", label: "Email — newsletter", contentType: "email", format: "email", template: "newsletter" },
  { value: "email_case_update", label: "Email — case update", contentType: "email", format: "email", template: "case_study" },
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
  const [practiceAreas, setPracticeAreas] = useState<string[]>([
    ...DEFAULT_PRACTICE_AREAS,
  ]);
  const [practiceArea, setPracticeArea] = useState<string>(
    DEFAULT_PRACTICE_AREAS[0],
  );
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [targetKeywords, setTargetKeywords] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live practice-area list (editable on /settings/practice-areas).
  useEffect(() => {
    fetch("/api/practice-areas")
      .then((r) => r.json())
      .then((d) => {
        const list: string[] = Array.isArray(d?.areas) ? d.areas : [];
        if (list.length === 0) return;
        setPracticeAreas(list);
        setPracticeArea((cur) => (list.includes(cur) ? cur : list[0]));
      })
      .catch(() => {});
  }, []);

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
                  ? "bg-brand text-white"
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
                  ? "bg-brand text-white"
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
                className="w-full mt-1 px-3 py-2 rounded-md border border-slate-300 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
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
                className="w-full mt-1 px-3 py-2 rounded-md border border-slate-300 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              >
                {practiceAreas.map((p) => (
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
                className="w-full mt-1 px-3 py-2 rounded-md border border-slate-300 text-sm font-mono focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
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
