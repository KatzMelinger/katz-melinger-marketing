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

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Content studio</h1>
        <p className="text-sm text-slate-600 mt-1">
          Every generation autosaves here. Edit, analyze, export. Showing{" "}
          <span className="font-medium">{CONTENT_TYPE_LABEL[contentType]}</span> drafts.
        </p>
      </div>
      <ContentTypeTabs />
      <ContentNav />

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
                  <DashPill tone="blue">{d.format}</DashPill>
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
                  <DashPill tone="blue">{selectedDraft.format}</DashPill>
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
