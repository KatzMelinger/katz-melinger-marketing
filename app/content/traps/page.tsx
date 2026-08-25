"use client";

/**
 * Known traps — find one error everywhere it appears.
 *
 * B6: the EEOC/Title VII mistake was in both the body and the FAQ of the same
 * post, and nothing could answer "how many other drafts say this". Fixing one
 * instance never fixed the pattern.
 *
 * Every result here is a SUSPICION. The patterns match correct writing as well
 * as wrong writing — a draft can mention the FMLA and the EEOC together
 * perfectly properly — so this is a worklist of drafts to read, not a list of
 * errors. The page says so, prominently, because a reviewer who reads it as a
 * verdict will either panic or stop trusting it.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { ContentNav } from "@/components/content-nav";
import { DashButton, DashCard, DashPill, DashSpinner } from "@/components/dashboard-ui";
import type { KnownTrap, TrapScanResult } from "@/lib/known-traps";

const SEVERITY_TONE: Record<KnownTrap["severity"], "red" | "amber" | "neutral"> = {
  critical: "red",
  important: "amber",
  advisory: "neutral",
};

export default function KnownTrapsPage() {
  const [results, setResults] = useState<TrapScanResult[] | null>(null);
  const [traps, setTraps] = useState<KnownTrap[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [draftsScanned, setDraftsScanned] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadTraps = useCallback(async () => {
    const res = await fetch("/api/content/traps", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setTraps(data.traps ?? []);
    else setError(data?.error ?? "Couldn't load traps.");
  }, []);

  useEffect(() => {
    void loadTraps();
  }, [loadTraps]);

  const scan = async () => {
    setScanning(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/content/traps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Scan failed.");
        return;
      }
      setResults(data.results ?? []);
      setDraftsScanned(data.draftsScanned ?? 0);
      if (data.note) setNote(data.note);
    } finally {
      setScanning(false);
    }
  };

  const withHits = (results ?? []).filter((r) => r.drafts.length > 0);
  const clean = (results ?? []).filter((r) => r.drafts.length === 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Content / Known traps
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
          Known traps
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Errors the firm has been caught by before, searched across every draft at
          once — so a pattern gets fixed rather than one instance of it.
        </p>
      </div>

      <ContentNav />

      <DashCard className="mt-4 border-amber-200 bg-amber-50/60">
        <p className="text-sm text-amber-900">
          <span className="font-medium">These are suspicions, not errors.</span> The
          patterns match correct writing too — a draft can mention the FMLA and the EEOC
          together perfectly properly. Every hit needs a person to read it. The point is
          that nothing gets missed, not that everything listed is wrong.
        </p>
      </DashCard>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <DashButton onClick={scan} disabled={scanning}>
          {scanning ? <DashSpinner /> : results ? "Re-scan every draft" : "Scan every draft"}
        </DashButton>
        <span className="text-xs text-slate-500">
          {traps.length} trap{traps.length === 1 ? "" : "s"} configured
          {results ? ` · ${draftsScanned} drafts scanned` : ""}
        </span>
      </div>

      {error && (
        <DashCard className="mt-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-800">{error}</p>
        </DashCard>
      )}
      {note && (
        <DashCard className="mt-4">
          <p className="text-sm text-slate-600">{note}</p>
        </DashCard>
      )}

      {results && withHits.length === 0 && !note && (
        <DashCard className="mt-4 py-10 text-center">
          <div className="text-2xl" aria-hidden>
            ✓
          </div>
          <h3 className="mt-1 text-base font-semibold">No traps found</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
            None of the {traps.length} known patterns appear in any of the {draftsScanned}{" "}
            drafts scanned.
          </p>
        </DashCard>
      )}

      {withHits.length > 0 && (
        <div className="mt-4 space-y-3">
          {withHits.map((r) => {
            const open = expanded === r.trap.id;
            return (
              <DashCard key={r.trap.id} className="space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-slate-900">
                        {r.trap.label}
                      </h3>
                      <DashPill tone={SEVERITY_TONE[r.trap.severity]}>
                        {r.trap.severity}
                      </DashPill>
                    </div>
                    <p className="mt-1 max-w-3xl text-sm text-slate-600">{r.trap.note}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-lg font-semibold text-slate-900">
                      {r.drafts.length}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      draft{r.drafts.length === 1 ? "" : "s"}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : r.trap.id)}
                  className="text-xs text-brand underline hover:opacity-80"
                >
                  {open ? "hide the drafts" : `show the ${r.drafts.length} draft${r.drafts.length === 1 ? "" : "s"}`}
                </button>

                {open && (
                  <ul className="space-y-1.5 border-t border-slate-100 pt-2">
                    {r.drafts.map((d) => (
                      <li key={d.draftId} className="text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/content/drafts?draft=${d.draftId}`}
                            className="font-medium text-brand hover:underline"
                          >
                            {d.title}
                          </Link>
                          <DashPill tone="neutral">{d.status}</DashPill>
                          {d.hits.length > 1 && (
                            <span className="text-[10px] text-slate-500">
                              {d.hits.length} places
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] italic text-slate-500">
                          “{d.hits[0]?.excerpt}”
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </DashCard>
            );
          })}
        </div>
      )}

      {clean.length > 0 && (
        <p className="mt-4 text-xs text-slate-500">
          {clean.length} trap{clean.length === 1 ? "" : "s"} found nothing:{" "}
          {clean.map((r) => r.trap.label).join(", ")}.
        </p>
      )}
    </div>
  );
}
