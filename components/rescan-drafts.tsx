"use client";

/**
 * "Rescan all open drafts" (Oct 6 spec, Task 24). Runs the Task 23 fixer on
 * every open draft, a few at a time (POST /api/rules/rescan), and lists every
 * draft it changed with each change. Offered after a rule is saved or approved.
 */

import { useState } from "react";
import Link from "next/link";

import { DashButton, DashCard, DashSpinner } from "@/components/dashboard-ui";

type Result = {
  draftId: string;
  title: string | null;
  skipped?: string | null;
  error?: string;
  changes: { from: string; to: string; reason: string; source: string }[];
  attorneyReview: string[];
};

const BATCH = 4;

export function RescanDrafts({ prompt }: { prompt?: string }) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!window.confirm("Run the fixer on every open draft now? Changed drafts get a Changes made entry to review.")) return;
    setRunning(true);
    setError(null);
    setResults([]);
    setDone(0);
    try {
      const res = await fetch("/api/rules/rescan", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Couldn't list the open drafts.");
      const drafts = (data.drafts ?? []) as { id: string; title: string }[];
      setTotal(drafts.length);
      for (let i = 0; i < drafts.length; i += BATCH) {
        const batch = drafts.slice(i, i + BATCH);
        const r = await fetch("/api/rules/rescan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftIds: batch.map((d) => d.id) }),
        });
        const out = await r.json().catch(() => ({}));
        const rows: Result[] = r.ok
          ? out.results ?? []
          : batch.map((d) => ({ draftId: d.id, title: d.title, error: out?.error ?? `HTTP ${r.status}`, changes: [], attorneyReview: [] }));
        for (const row of rows) row.title ??= batch.find((d) => d.id === row.draftId)?.title ?? null;
        setResults((prev) => [...(prev ?? []), ...rows]);
        setDone(Math.min(i + BATCH, drafts.length));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const changed = (results ?? []).filter((r) => r.changes.length > 0);
  const failed = (results ?? []).filter((r) => r.error);

  return (
    <DashCard className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <DashButton onClick={run} disabled={running}>
          {running ? <DashSpinner /> : null}
          {running ? `Rescanning ${done} of ${total}…` : "Rescan all open drafts"}
        </DashButton>
        <span className="text-xs text-slate-600">
          {prompt ?? "Runs every check and fix on each open draft, and lists the drafts it changed."}
        </span>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {results && !running && (
        <p className="text-sm text-slate-700">
          {results.length} draft{results.length === 1 ? "" : "s"} checked:{" "}
          <span className="font-medium">{changed.length} changed</span>
          {failed.length > 0 && <span className="text-red-700">, {failed.length} failed</span>}.
        </p>
      )}

      {changed.length > 0 && (
        <ul className="space-y-2 border-t border-slate-100 pt-2">
          {changed.map((r) => (
            <li key={r.draftId} className="text-xs">
              <Link href={`/content/drafts?draft=${r.draftId}`} className="font-medium text-brand hover:underline">
                {r.title ?? r.draftId}
              </Link>
              <span className="ml-2 text-slate-500">
                {r.changes.length} change{r.changes.length === 1 ? "" : "s"}
              </span>
              <ul className="mt-1 space-y-0.5 pl-3">
                {r.changes.slice(0, 6).map((c, i) => (
                  <li key={i} className="text-slate-600">
                    {c.reason}
                    {c.from && c.to && (
                      <span className="text-slate-500">
                        {" "}
                        (“{c.from.slice(0, 60)}” → “{c.to.slice(0, 60)}”)
                      </span>
                    )}
                  </li>
                ))}
                {r.changes.length > 6 && <li className="text-slate-500">and {r.changes.length - 6} more</li>}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {failed.length > 0 && !running && (
        <ul className="space-y-0.5 text-xs text-red-700">
          {failed.map((r) => (
            <li key={r.draftId}>
              {r.title ?? r.draftId}: {r.error}
            </li>
          ))}
        </ul>
      )}
    </DashCard>
  );
}
