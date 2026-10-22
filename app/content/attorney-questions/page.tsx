"use client";

/**
 * Attorney questions (Oct 20 spec, Task A14). Each reviewing attorney sees only
 * their questions: the sentence, the source passage, and two answers. Every
 * answer is saved so the same question is never asked twice; when a draft's
 * last question is answered and it passes its checklist, Diana is told.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DashButton, DashCard, DashPill, DashSpinner } from "@/components/dashboard-ui";
import { PipelineStageNav } from "@/components/pipeline-stage-nav";

type Question = {
  draftId: string;
  draftTitle: string;
  attorney: string | null;
  hash: string;
  sentence: string;
  verdict: string;
  question: string;
  passage: string | null;
  sourceUrl: string | null;
  kbLabel: string | null;
  businessDaysOpen: number;
  overdue: boolean;
};

export default function AttorneyQuestionsPage() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isAttorney, setIsAttorney] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/legal/questions${showAll ? "?all=1" : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not load the questions.");
      setQuestions(j.questions ?? []);
      setIsAttorney(!!j.isAttorney);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [showAll]);
  useEffect(() => {
    void load();
  }, [load]);

  const answer = async (q: Question, action: "approve" | "replace") => {
    const key = `${q.draftId}:${q.hash}`;
    setBusy(key);
    setNotice(null);
    try {
      const r = await fetch("/api/legal/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: q.draftId, hash: q.hash, action, replacement: replacing[key] ?? null }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setNotice(j.error ?? "That did not work.");
      else setNotice(j.remaining === 0 ? (j.ready ? `"${q.draftTitle}" has no questions left and is Ready for Diana; she has been told.` : `"${q.draftTitle}" has no questions left.`) : `Saved. ${j.remaining} question${j.remaining === 1 ? "" : "s"} left on this draft.`);
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <PipelineStageNav />
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Attorney questions</h1>
          <p className="mt-1 text-sm text-slate-600">
            Legal claims no source settled. Approve the sentence as written, or replace it with the correct one. Each answer is
            saved and reused, so the same question is never asked twice.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAttorney && (
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show every attorney&apos;s questions
            </label>
          )}
          <DashButton onClick={() => void load()} disabled={loading}>
            Refresh
          </DashButton>
        </div>
      </div>
      {notice && <p className="mb-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">{notice}</p>}
      {error && <p className="mb-3 text-sm text-rose-700">{error}</p>}
      {loading ? (
        <DashCard className="py-10 text-center text-sm text-slate-500">
          <DashSpinner /> Loading…
        </DashCard>
      ) : questions.length === 0 ? (
        <DashCard className="py-10 text-center text-sm text-slate-500">No open questions.</DashCard>
      ) : (
        <div className="space-y-3">
          {questions.map((q) => {
            const key = `${q.draftId}:${q.hash}`;
            return (
              <DashCard key={key}>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Link href={`/content/drafts?id=${q.draftId}`} className="font-medium text-brand hover:underline">
                    {q.draftTitle}
                  </Link>
                  {q.attorney && <DashPill tone="neutral">{q.attorney}</DashPill>}
                  <DashPill tone={q.overdue ? "red" : q.businessDaysOpen >= 2 ? "amber" : "neutral"}>
                    {q.businessDaysOpen} business day{q.businessDaysOpen === 1 ? "" : "s"}
                    {q.overdue ? " · overdue" : ""}
                  </DashPill>
                </div>
                <p className="mt-2 text-sm text-slate-900">&ldquo;{q.sentence}&rdquo;</p>
                <p className="mt-1 text-xs text-slate-600">{q.question}</p>
                {q.passage && (
                  <blockquote className="mt-2 border-l-2 border-slate-300 pl-2 text-xs italic text-slate-600">&ldquo;{q.passage}&rdquo;</blockquote>
                )}
                <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-500">
                  {q.kbLabel && <span>Entry: {q.kbLabel}</span>}
                  {q.sourceUrl && (
                    <a href={q.sourceUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                      Source
                    </a>
                  )}
                </div>
                {isAttorney ? (
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={replacing[key] ?? ""}
                      onChange={(e) => setReplacing((r) => ({ ...r, [key]: e.target.value }))}
                      placeholder="Replace with (the correct sentence)…"
                      rows={2}
                      className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => void answer(q, "approve")}
                        disabled={busy === key}
                        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Approve as is
                      </button>
                      <button
                        onClick={() => void answer(q, "replace")}
                        disabled={busy === key || (replacing[key] ?? "").trim().length < 10}
                        className="rounded-md border border-brand px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand/5 disabled:opacity-50"
                      >
                        Replace with my sentence
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-slate-500">Only the reviewing attorneys can answer.</p>
                )}
              </DashCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
