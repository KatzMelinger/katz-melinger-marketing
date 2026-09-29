"use client";

/**
 * "Changes made" (Diana's Sept 28 spec, section 9).
 *
 * Every automatic edit to the draft, with the original text, the new text, the
 * reason, the source (knowledge base, statute table, firm fact, brand rule,
 * required element) and the date. Each change can be undone on its own, the
 * rewritten spots can be shown highlighted in the text, and Approve waits
 * until someone marks the panel Reviewed.
 *
 * "Fix known errors" runs the rewrite on demand. It rewrites only what has one
 * known correct answer; everything else stays a finding for a person.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import type { FixChange, FixLog } from "@/lib/legal-fix-log";

type Props = {
  draftId: string;
  /** Current body, for the highlighted preview. */
  body: string;
  /** Bump to reload (after a save, an analysis, an apply). */
  nonce?: number;
  /** The draft text changed on the server (rewrite or undo): refresh the editor. */
  onDraftChanged?: (next: { body?: string; title?: string | null }) => void;
  /** Reports how many changes still need review, for the parent's approve button. */
  onUnreviewed?: (n: number) => void;
};

const SOURCE_STYLE: Record<string, string> = {
  "knowledge base": "bg-sky-100 text-sky-800",
  "statute table": "bg-indigo-100 text-indigo-800",
  "firm fact": "bg-rose-100 text-rose-800",
  "brand rule": "bg-slate-100 text-slate-700",
  "required element": "bg-emerald-100 text-emerald-800",
};

export function ChangesMadePanel({ draftId, body, nonce, onDraftChanged, onUnreviewed }: Props) {
  const [log, setLog] = useState<FixLog | null>(null);
  const [unreviewed, setUnreviewed] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [review, setReview] = useState<string[]>([]);
  const [highlight, setHighlight] = useState(false);
  const [showUndone, setShowUndone] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/content/drafts/${draftId}/changes`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setLog(data.log ?? { changes: [] });
      setUnreviewed(data.unreviewed ?? 0);
    }
  }, [draftId]);

  useEffect(() => {
    void load();
  }, [load, nonce]);

  useEffect(() => {
    onUnreviewed?.(unreviewed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreviewed]);

  const runFix = async () => {
    setBusy("fix");
    setMsg(null);
    setReview([]);
    try {
      const res = await fetch(`/api/content/drafts/${draftId}/auto-fix`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data?.error ?? "The rewrite could not run.");
        return;
      }
      if (data.fullRedraft) setMsg(`Full redraft needed: ${data.fullRedraft}`);
      else setMsg(data.changes ? `${data.changes} change${data.changes === 1 ? "" : "s"} made. Review them below.` : "Nothing with a known correct answer needed changing.");
      setReview(Array.isArray(data.attorneyReview) ? data.attorneyReview : []);
      if (data.changes) onDraftChanged?.({ body: data.body, title: data.title });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const post = async (payload: Record<string, unknown>, key: string) => {
    setBusy(key);
    setMsg(null);
    try {
      const res = await fetch(`/api/content/drafts/${draftId}/changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data?.error ?? "That did not work.");
        return;
      }
      setLog(data.log);
      setUnreviewed(data.unreviewed ?? 0);
      if (typeof data.body === "string") onDraftChanged?.({ body: data.body, title: data.title });
    } finally {
      setBusy(null);
    }
  };

  const changes = log?.changes ?? [];
  const live = changes.filter((c) => !c.undone_at);
  const shown = showUndone ? changes : live;
  const reviewedAt = log?.reviewed_at ? Date.parse(log.reviewed_at) : 0;

  const preview = useMemo(() => (highlight ? highlightBody(body, live) : null), [highlight, body, live]);

  return (
    <div className="rounded-lg border border-slate-200">
      <div
        className={`flex flex-wrap items-center justify-between gap-2 rounded-t-lg border-b px-3 py-2 ${
          unreviewed > 0 ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-800"
        }`}
      >
        <div className="text-xs font-semibold">
          Changes made
          <span className="ml-1.5 font-normal opacity-75">
            {live.length} change{live.length === 1 ? "" : "s"}
            {unreviewed > 0 ? ` · ${unreviewed} not yet reviewed (Approve is on hold)` : live.length ? " · reviewed" : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => void runFix()}
            disabled={busy !== null}
            className="rounded border border-brand/40 bg-white px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand/10 disabled:opacity-50"
            title="Rewrite only errors with one known correct answer. Every change is listed here and can be undone."
          >
            {busy === "fix" ? "Fixing…" : "Fix known errors"}
          </button>
          {live.length > 0 && (
            <button
              type="button"
              onClick={() => setHighlight((v) => !v)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] hover:bg-slate-50"
            >
              {highlight ? "Hide highlights" : "Show in text"}
            </button>
          )}
          {unreviewed > 0 && (
            <button
              type="button"
              onClick={() => void post({ action: "review" }, "review")}
              disabled={busy !== null}
              className="rounded bg-amber-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              Mark reviewed
            </button>
          )}
        </div>
      </div>

      {log?.full_redraft_needed && (
        <div className="border-b border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
          <span className="font-semibold">Full redraft needed.</span> {log.full_redraft_needed} This draft is not patched
          sentence by sentence; regenerate it for the right audience or archive it.
        </div>
      )}

      {msg && <p className="border-b border-slate-100 px-3 py-1.5 text-[11px] text-slate-700">{msg}</p>}

      {review.length > 0 && (
        <div className="border-b border-slate-100 px-3 py-2 text-[11px] text-slate-700">
          <div className="font-medium">Left for a person (not rewritten automatically):</div>
          <ul className="mt-0.5 list-disc pl-4">
            {review.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {preview && (
        <div
          className="max-h-96 overflow-auto whitespace-pre-wrap border-b border-slate-100 px-3 py-2 text-xs leading-relaxed text-slate-800"
          // The body is escaped before the <mark> tags are added (highlightBody).
          dangerouslySetInnerHTML={{ __html: preview }}
        />
      )}

      <div className="p-3">
        {changes.length === 0 ? (
          <p className="text-xs text-slate-500">No automatic changes on this draft.</p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {shown.map((c) => (
                <ChangeRow
                  key={c.id}
                  change={c}
                  isNew={!c.undone_at && Date.parse(c.at) > reviewedAt}
                  busy={busy === c.id}
                  onUndo={() => void post({ action: "undo", changeId: c.id }, c.id)}
                />
              ))}
            </ul>
            {changes.length > live.length && (
              <button type="button" onClick={() => setShowUndone((v) => !v)} className="mt-2 text-[10px] text-slate-500 underline">
                {showUndone ? "Hide undone changes" : `Show ${changes.length - live.length} undone`}
              </button>
            )}
            {log?.reviewed_at && (
              <p className="mt-2 text-[10px] text-slate-500">
                Last reviewed by {log.reviewed_by ?? "someone"} on {new Date(log.reviewed_at).toLocaleString()}.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ChangeRow({ change, isNew, busy, onUndo }: { change: FixChange; isNew: boolean; busy: boolean; onUndo: () => void }) {
  const undone = !!change.undone_at;
  return (
    <li className={`rounded-md border px-2.5 py-1.5 text-xs ${undone ? "border-slate-200 opacity-60" : isNew ? "border-amber-300" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${SOURCE_STYLE[change.source] ?? "bg-slate-100 text-slate-700"}`}>
              {change.source}
            </span>
            <span className="text-[10px] text-slate-500">{change.where || "—"}</span>
            <span className="text-[10px] text-slate-400">{new Date(change.at).toLocaleDateString()}</span>
            {undone && <span className="text-[10px] font-medium text-slate-500">Undone</span>}
          </div>
          <p className="mt-1 text-[11px] text-slate-700">{change.reason}</p>
          {change.from && (
            <p className="mt-1 text-[11px] text-rose-800 line-through decoration-rose-400">{clip(change.from)}</p>
          )}
          {change.to && <p className="mt-0.5 text-[11px] text-emerald-800">{clip(change.to)}</p>}
          {!change.to && <p className="mt-0.5 text-[11px] italic text-slate-500">(removed)</p>}
        </div>
        {!undone && (
          <button
            type="button"
            onClick={onUndo}
            disabled={busy}
            className="shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? "…" : "Undo"}
          </button>
        )}
      </div>
    </li>
  );
}

function clip(s: string, n = 400): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The body with every live change's new text wrapped in <mark>. */
function highlightBody(body: string, changes: FixChange[]): string {
  const spans: { start: number; end: number }[] = [];
  for (const c of changes) {
    if (!c.to || c.where === "Title") continue;
    const i = body.indexOf(c.to);
    if (i !== -1) spans.push({ start: i, end: i + c.to.length });
  }
  spans.sort((a, b) => a.start - b.start);
  let out = "";
  let pos = 0;
  for (const s of spans) {
    if (s.start < pos) continue;
    out += escapeHtml(body.slice(pos, s.start));
    out += `<mark class="rounded bg-amber-200 px-0.5">${escapeHtml(body.slice(s.start, s.end))}</mark>`;
    pos = s.end;
  }
  return out + escapeHtml(body.slice(pos));
}
