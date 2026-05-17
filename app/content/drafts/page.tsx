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
  brand_voice_score: number;
  brand_voice_findings: string[];
  cash_score?: number;
  cash_breakdown?: {
    conversationalAuthority: number;
    answerCompleteness: number;
    sourceExpertise: number;
    humanAttribution: number;
  };
  cash_findings?: string[];
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

              {analysis && <AnalysisCard analysis={analysis} />}
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

function AnalysisCard({ analysis }: { analysis: Analysis }) {
  const cash = analysis.cash_breakdown;
  return (
    <DashCard>
      <div className="text-sm font-medium mb-3">Analysis</div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <ScoreTile label="Readability" value={analysis.readability_score} />
        <ScoreTile label="AEO" value={analysis.aeo_score} />
        <ScoreTile label="Brand voice" value={analysis.brand_voice_score} />
        <ScoreTile
          label="CASH (AI cite)"
          value={analysis.cash_score ?? 0}
          hint="Conversational Authority / Answer / Source / Human"
        />
        <Tile label="Words" value={analysis.word_count} />
      </div>
      {cash && (
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <CashPillar label="Conversational" letter="C" value={cash.conversationalAuthority} />
          <CashPillar label="Answer" letter="A" value={cash.answerCompleteness} />
          <CashPillar label="Source" letter="S" value={cash.sourceExpertise} />
          <CashPillar label="Human" letter="H" value={cash.humanAttribution} />
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-4 mt-4">
        <div>
          <div className="text-xs font-medium text-slate-700 mb-1">AEO findings</div>
          <ul className="text-xs space-y-1 list-disc pl-4 text-slate-600">
            {analysis.aeo_findings.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
        <div>
          <div className="text-xs font-medium text-slate-700 mb-1">Brand voice findings</div>
          <ul className="text-xs space-y-1 list-disc pl-4 text-slate-600">
            {analysis.brand_voice_findings.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
      </div>
      {analysis.cash_findings && analysis.cash_findings.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-medium text-slate-700 mb-1">
            CASH findings (AI citation-worthiness)
          </div>
          <ul className="text-xs space-y-1 list-disc pl-4 text-slate-600">
            {analysis.cash_findings.map((f, i) => (
              <li key={i}>{f}</li>
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

function ScoreTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
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
