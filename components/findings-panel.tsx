"use client";

/**
 * Tracked findings for a draft — the durable list, with a status per finding.
 *
 * Distinct from the analysis card, which shows what the LAST run produced and
 * offers Apply-to-rewrite on the text. This shows what is outstanding across
 * runs: who resolved what, what came back after being marked fixed, and what
 * the checks stopped reporting on their own.
 */

import { useCallback, useEffect, useState } from "react";

import { DashSpinner } from "@/components/dashboard-ui";
import {
  SOURCE_LABEL,
  type FindingSeverity,
  type FindingStatus,
  type StoredFinding,
} from "@/lib/content-findings";

const SEVERITY_STYLE: Record<FindingSeverity, string> = {
  critical: "border-red-300 bg-red-50 text-red-800",
  important: "border-amber-300 bg-amber-50 text-amber-800",
  advisory: "border-slate-200 bg-white text-slate-600",
};

const STATUS_LABEL: Record<FindingStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export function FindingsPanel({ draftId, nonce }: { draftId: string; nonce?: number }) {
  const [findings, setFindings] = useState<StoredFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [showClosed, setShowClosed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/content/drafts/${draftId}/findings`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setFindings(data.findings ?? []);
    } finally {
      setLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    void load();
  }, [load, nonce]);

  const move = async (finding: StoredFinding, status: FindingStatus) => {
    // Dismissing stops this finding being raised on every future run, so the
    // reason is required rather than optional — the API enforces it too.
    let note: string | undefined;
    if (status === "dismissed") {
      const reason = window.prompt(
        "Why is this being dismissed? It will not be raised again on future runs.",
      );
      if (!reason?.trim()) return;
      note = reason.trim();
    }
    setBusy(finding.id);
    setMsg(null);
    try {
      const res = await fetch(`/api/content/drafts/${draftId}/findings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId: finding.id, status, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data?.error ?? "Couldn't update that finding.");
        return;
      }
      setFindings(data.findings ?? []);
    } finally {
      setBusy(null);
    }
  };

  const open = findings.filter((f) => f.status === "open" || f.status === "in_progress");
  const closed = findings.filter((f) => f.status === "resolved" || f.status === "dismissed");
  const visible = showClosed ? [...open, ...closed] : open;

  const counts = open.reduce(
    (acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] ?? 0) + 1 }),
    {} as Record<FindingSeverity, number>,
  );

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 p-3 text-xs text-slate-500">
        <DashSpinner /> Loading findings…
      </div>
    );
  }

  // Nothing tracked yet is a normal state (the migration may not be run, or the
  // draft has never been analyzed). Say so plainly rather than showing an
  // empty box that reads like "no problems".
  if (findings.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 p-3 text-xs text-slate-500">
        No tracked findings yet — they are recorded the next time the analysis runs.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Findings
          {open.length > 0 && (
            <span className="ml-1.5 font-normal normal-case tracking-normal text-slate-600">
              · {open.length} open
              {counts.critical ? `, ${counts.critical} critical` : ""}
            </span>
          )}
        </div>
        {closed.length > 0 && (
          <button
            type="button"
            onClick={() => setShowClosed((v) => !v)}
            className="text-[10px] text-slate-500 underline hover:text-brand"
          >
            {showClosed ? "hide" : `show ${closed.length} closed`}
          </button>
        )}
      </div>

      {open.length === 0 && !showClosed && (
        <p className="text-xs text-emerald-700">
          Nothing outstanding. {closed.length} finding{closed.length === 1 ? "" : "s"} closed.
        </p>
      )}

      <ul className="space-y-1.5">
        {visible.map((f) => {
          const isClosed = f.status === "resolved" || f.status === "dismissed";
          return (
            <li
              key={f.id}
              className={`rounded-md border px-2.5 py-1.5 text-xs ${
                isClosed ? "border-slate-200 bg-slate-50 text-slate-500" : SEVERITY_STYLE[f.severity]
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-medium">{f.title}</span>
                  <span className="ml-1.5 text-[10px] opacity-70">
                    {SOURCE_LABEL[f.source]}
                    {f.ruleId ? ` · ${f.ruleId}` : ""}
                    {isClosed ? ` · ${STATUS_LABEL[f.status]}` : ""}
                    {f.status === "in_progress" ? " · In progress" : ""}
                  </span>
                </div>
                {!isClosed && (
                  <div className="flex shrink-0 gap-1">
                    {f.status === "open" && (
                      <button
                        type="button"
                        disabled={busy === f.id}
                        onClick={() => void move(f, "in_progress")}
                        className="rounded border border-current/30 px-1.5 py-0.5 text-[10px] hover:bg-white/60 disabled:opacity-50"
                      >
                        Start
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy === f.id}
                      onClick={() => void move(f, "resolved")}
                      className="rounded border border-current/30 px-1.5 py-0.5 text-[10px] hover:bg-white/60 disabled:opacity-50"
                    >
                      Resolve
                    </button>
                    <button
                      type="button"
                      disabled={busy === f.id}
                      onClick={() => void move(f, "dismissed")}
                      className="rounded border border-current/30 px-1.5 py-0.5 text-[10px] hover:bg-white/60 disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
                {isClosed && (
                  <button
                    type="button"
                    disabled={busy === f.id}
                    onClick={() => void move(f, "open")}
                    className="shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] hover:bg-white disabled:opacity-50"
                  >
                    Re-open
                  </button>
                )}
              </div>
              {f.excerpt && (
                <p className="mt-0.5 truncate text-[10px] italic opacity-80">“{f.excerpt}”</p>
              )}
              {f.resolvedByEmail && isClosed && (
                <p className="mt-0.5 text-[10px] opacity-70">
                  {STATUS_LABEL[f.status]} by {f.resolvedByEmail.split("@")[0]}
                  {f.resolvedAt ? ` · ${new Date(f.resolvedAt).toLocaleDateString()}` : ""}
                  {f.resolutionNote ? ` — ${f.resolutionNote}` : ""}
                </p>
              )}
              {/* A finding that came back after being resolved is the signal the
                  whole table exists to surface. */}
              {!isClosed && f.resolutionNote?.startsWith("Re-opened") && (
                <p className="mt-0.5 text-[10px] font-medium opacity-80">{f.resolutionNote}</p>
              )}
            </li>
          );
        })}
      </ul>

      {msg && <p className="mt-1.5 text-[10px] text-red-600">{msg}</p>}
    </div>
  );
}
