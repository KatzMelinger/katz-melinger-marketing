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
import { ContentNav } from "@/components/content-nav";
import {
  DashCard,
  DashButton,
  DashInput,
  DashPill,
  DashSpinner,
  DashBar,
} from "@/components/dashboard-ui";

type Draft = {
  id: string;
  format: string;
  template: string | null;
  topic: string;
  practice_area: string | null;
  title: string | null;
  body: string;
  metadata: Record<string, unknown>;
  status: string;
  created_at: string;
  updated_at: string;
};

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

const FORMAT_FILTERS = ["all", "blog", "linkedin", "twitter", "facebook", "instagram", "email", "podcast"];

export default function DraftsPage() {
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

  const refresh = async (format?: string) => {
    setLoading(true);
    try {
      const url = format && format !== "all" ? `/api/content/drafts?format=${format}` : "/api/content/drafts";
      const res = await fetch(url);
      const data = await res.json();
      setDrafts(data.drafts ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh(filter);
  }, [filter]);

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
    if (!search.trim()) return drafts;
    const lc = search.toLowerCase();
    return drafts.filter(
      (d) =>
        d.topic.toLowerCase().includes(lc) ||
        (d.title ?? "").toLowerCase().includes(lc) ||
        d.body.toLowerCase().includes(lc),
    );
  }, [drafts, search]);

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
      refresh(filter);
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
    refresh(filter);
    fetch(`/api/content/drafts/${selectedDraft.id}`)
      .then((r) => r.json())
      .then((data) => setSelectedDraft(data.draft));
  };

  const remove = async () => {
    if (!selectedDraft || !confirm("Delete this draft?")) return;
    await fetch(`/api/content/drafts/${selectedDraft.id}`, { method: "DELETE" });
    setSelectedId(null);
    refresh(filter);
  };

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Content studio</h1>
        <p className="text-sm text-slate-600 mt-1">
          Every generation autosaves here. Edit, analyze, export.
        </p>
      </div>
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
              {FORMAT_FILTERS.map((f) => (
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
            {filtered.map((d) => (
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
                  {d.status !== "draft" && <DashPill tone="emerald">{d.status}</DashPill>}
                </div>
                <div className="text-sm font-medium mt-1 line-clamp-2">
                  {d.title || d.topic}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  {new Date(d.created_at).toLocaleString()}
                </div>
              </button>
            ))}
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
                  <div className="ml-auto flex gap-2">
                    <a
                      href={`/api/content/drafts/${selectedDraft.id}/export-docx`}
                      className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-[#185FA5] hover:text-[#185FA5]"
                    >
                      ⬇ Export .docx
                    </a>
                    {selectedDraft.status === "draft" && (
                      <button
                        onClick={() => updateStatus("approved")}
                        className="text-xs px-2 py-1 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                      >
                        Mark approved
                      </button>
                    )}
                    <button
                      onClick={remove}
                      className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="mt-3 text-xs text-slate-500">Topic: {selectedDraft.topic}</div>
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
