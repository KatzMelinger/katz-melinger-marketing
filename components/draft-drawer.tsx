"use client";

/**
 * DraftDrawer — read / edit / approve a content draft INLINE on the Production
 * Board, without navigating away to /content/drafts.
 *
 * It reuses the existing draft APIs:
 *   - GET   /api/content/drafts/[id]          → draft + latest_analysis
 *   - PATCH /api/content/drafts/[id]          → save title/body
 *   - POST  /api/content/drafts/[id]/analyze  → readability + scores
 *   - PATCH /api/content/pipeline/[id]        → advance editorial status (approve)
 *
 * Markdown rendering (PROSE_CLASS + marked) is kept identical to the drafts
 * library so a draft looks the same wherever it is opened.
 */

import { useEffect, useState } from "react";
import { marked } from "marked";

import { DashButton, DashSpinner, DashPill } from "@/components/dashboard-ui";

const PROSE_CLASS =
  "[&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-2 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_strong]:font-semibold [&_em]:italic [&_a]:text-[#185FA5] [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:my-2 [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_table]:my-2 [&_table]:w-full [&_th]:border [&_th]:border-slate-200 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1";

type PipelineStatus = "idea" | "brief" | "draft" | "review" | "published";

const STATUS_LABEL: Record<PipelineStatus, string> = {
  idea: "Idea",
  brief: "Brief",
  draft: "Draft",
  review: "Review",
  published: "Published",
};

type Draft = {
  id: string;
  title: string | null;
  body: string;
  seo_brief?: { targetKeywords?: string[] } | null;
};

type Analysis = {
  readability_score: number | null;
  reading_grade_level: number | null;
  word_count: number | null;
  seo_score: number | null;
  aeo_score: number | null;
  brand_voice_score: number | null;
  brand_voice_findings?: string[] | null;
  seo_findings?: string[] | null;
};

/** Plain-English label for a Flesch reading-ease score (0–100, higher = easier). */
function readabilityLabel(score: number | null): { text: string; tone: "emerald" | "amber" | "red" } {
  if (score == null) return { text: "—", tone: "amber" };
  if (score >= 60) return { text: "Easy to read", tone: "emerald" };
  if (score >= 45) return { text: "Fairly readable", tone: "amber" };
  return { text: "Hard to read", tone: "red" };
}

export function DraftDrawer({
  pipelineId,
  draftId,
  status,
  onClose,
  onChanged,
}: {
  pipelineId: number;
  draftId: string;
  status: PipelineStatus;
  onClose: () => void;
  /** Called after a save or status change so the board can refresh. */
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [bodyView, setBodyView] = useState<"write" | "preview">("write");
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [statusValue, setStatusValue] = useState<PipelineStatus>(status);
  const [msg, setMsg] = useState<string | null>(null);

  // Load the draft + its latest analysis. If no analysis exists yet, kick one
  // off automatically so the readability check is always present when Diana
  // opens a draft (the "check readability anytime we have content" rule).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/content/drafts/${draftId}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setDraft(data.draft ?? null);
        setAnalysis(data.latest_analysis ?? null);
        setEditTitle(data.draft?.title ?? "");
        setEditBody(data.draft?.body ?? "");
        setLoading(false);
        if (data.draft && !data.latest_analysis) void runAnalysis(data.draft);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  const renderedBody = editBody.trim()
    ? (marked.parse(editBody, { async: false }) as string)
    : "<p class='text-slate-400'>Nothing to preview yet.</p>";

  async function runAnalysis(d: Draft) {
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/content/drafts/${d.id}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetKeywords: d.seo_brief?.targetKeywords ?? [],
        }),
      });
      const data = await res.json();
      if (res.ok) setAnalysis(data);
    } finally {
      setAnalyzing(false);
    }
  }

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/content/drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle, body: editBody }),
      });
      if (res.ok) {
        setMsg("Saved.");
        onChanged();
      } else {
        setMsg("Save failed.");
      }
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (next: PipelineStatus) => {
    setStatusValue(next);
    setMsg(null);
    await fetch(`/api/content/pipeline/${pipelineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    onChanged();
  };

  // Approve = save edits, then advance the editorial stage (draft → review).
  const approve = async () => {
    await save();
    await changeStatus("review");
    setMsg("Approved — moved to Review.");
  };

  const rl = readabilityLabel(analysis?.readability_score ?? null);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Scrim */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      {/* Panel */}
      <div className="relative h-full w-full max-w-2xl bg-white border-l border-slate-200 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200">
          <div className="min-w-0">
            <div className="text-xs text-slate-500">Draft preview · Production Board</div>
            <h2 className="text-base font-semibold text-slate-900 truncate">
              {editTitle || "Untitled draft"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
            <DashSpinner /> Loading draft…
          </div>
        ) : !draft ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
            Draft not found.
          </div>
        ) : (
          <>
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Readability + scores strip */}
              <div className="flex flex-wrap items-center gap-2">
                <DashPill tone={rl.tone}>
                  Readability: {analysis?.readability_score ?? "—"} · {rl.text}
                </DashPill>
                {analysis?.reading_grade_level != null && (
                  <DashPill tone="neutral">Grade {analysis.reading_grade_level}</DashPill>
                )}
                {analysis?.seo_score != null && (
                  <DashPill tone="blue">SEO {analysis.seo_score}</DashPill>
                )}
                {analysis?.brand_voice_score != null && (
                  <DashPill tone="violet">Voice {analysis.brand_voice_score}</DashPill>
                )}
                {analysis?.word_count != null && (
                  <span className="text-xs text-slate-500">{analysis.word_count} words</span>
                )}
                {analyzing && (
                  <span className="text-xs text-slate-500">
                    <DashSpinner /> checking…
                  </span>
                )}
              </div>

              {/* Title */}
              <div>
                <label className="text-xs font-medium text-slate-700">Title</label>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-md border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30 focus:border-[#185FA5]"
                />
              </div>

              {/* Body with Write / Preview toggle */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-700">Body</label>
                  <div className="inline-flex rounded-md border border-slate-200 overflow-hidden text-xs">
                    <button
                      onClick={() => setBodyView("write")}
                      className={`px-2.5 py-1 ${bodyView === "write" ? "bg-[#185FA5] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                    >
                      Write
                    </button>
                    <button
                      onClick={() => setBodyView("preview")}
                      className={`px-2.5 py-1 ${bodyView === "preview" ? "bg-[#185FA5] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                    >
                      Preview
                    </button>
                  </div>
                </div>
                {bodyView === "write" ? (
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    className="w-full min-h-[24rem] mt-1 px-4 py-3 rounded-md border border-slate-300 bg-white text-sm text-slate-800 font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30 focus:border-[#185FA5]"
                  />
                ) : (
                  <div
                    className={`w-full min-h-[24rem] max-h-[60vh] overflow-y-auto px-4 py-3 rounded-md border border-slate-300 bg-white text-sm text-slate-800 mt-1 ${PROSE_CLASS}`}
                    dangerouslySetInnerHTML={{ __html: renderedBody }}
                  />
                )}
              </div>

              {/* Findings */}
              {(analysis?.brand_voice_findings?.length ||
                analysis?.seo_findings?.length) && (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <div className="text-xs font-semibold text-slate-700">
                    What to improve
                  </div>
                  <ul className="list-disc pl-4 space-y-1 text-xs text-slate-600">
                    {(analysis?.seo_findings ?? []).slice(0, 4).map((f, i) => (
                      <li key={`seo-${i}`}>{f}</li>
                    ))}
                    {(analysis?.brand_voice_findings ?? []).slice(0, 3).map((f, i) => (
                      <li key={`bv-${i}`}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div className="border-t border-slate-200 px-5 py-3 flex items-center gap-2 flex-wrap">
              <select
                value={statusValue}
                onChange={(e) => changeStatus(e.target.value as PipelineStatus)}
                className="text-xs px-2 py-1.5 rounded border border-slate-300 bg-white text-slate-700"
                title="Editorial status on the Production Board"
              >
                {(Object.keys(STATUS_LABEL) as PipelineStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              <button
                onClick={() => draft && runAnalysis(draft)}
                disabled={analyzing}
                className="text-xs px-2.5 py-1.5 rounded border border-slate-300 hover:border-[#185FA5] hover:text-[#185FA5] disabled:opacity-50"
              >
                {analyzing ? "Checking…" : "Re-check readability"}
              </button>
              {msg && <span className="text-xs text-slate-500">{msg}</span>}
              <div className="ml-auto flex items-center gap-2">
                <DashButton variant="outline" onClick={save} disabled={saving}>
                  {saving ? <DashSpinner /> : "Save"}
                </DashButton>
                <DashButton onClick={approve} disabled={saving}>
                  Approve ✓
                </DashButton>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
