"use client";

/**
 * The keyword decision on a draft (Oct 6 spec, Tasks 15 and 17): the chosen
 * keyword with its volume, difficulty and 12-month trend, each with its source
 * and date; the rejected candidates and why; and "New page" or "Update of
 * [URL]". A keyword that fails the guard shows "Keyword needs selection".
 */

import { useState } from "react";

import { keywordProblem } from "@/lib/keyword-guard";
import type { KeywordDecision } from "@/lib/keyword-selection";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });

function Trend({ monthly }: { monthly: number[] }) {
  if (monthly.length < 2) return null;
  const max = Math.max(...monthly, 1);
  return (
    <svg width={monthly.length * 5} height={16} aria-label="12-month search trend" className="inline-block align-middle">
      {monthly.map((v, i) => (
        <rect key={i} x={i * 5} y={16 - (v / max) * 16} width={4} height={(v / max) * 16} className="fill-slate-400" />
      ))}
    </svg>
  );
}

export function KeywordDecisionPanel({
  keyword,
  decision,
  onUse,
}: {
  /** The keyword the draft carries now. */
  keyword: string;
  decision: KeywordDecision | null | undefined;
  /** Offered in the wizard: put a candidate in the keyword field. */
  onUse?: (keyword: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const problem = keywordProblem(keyword);
  const c = decision?.chosen ?? null;
  return (
    <div className="space-y-1.5 text-xs">
      {problem && (
        <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-red-800">
          <span className="font-semibold">Keyword needs selection.</span> {problem}. SEO checks and Apply fix do not run
          against it.
        </div>
      )}
      {c ? (
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="font-medium text-slate-900">{c.keyword}</span>
            {onUse && c.keyword !== keyword.trim().toLowerCase() && (
              <button type="button" className="text-brand underline" onClick={() => onUse(c.keyword)}>
                use this
              </button>
            )}
          </div>
          <div className="text-slate-700">
            {c.volume?.toLocaleString() ?? "—"} searches/mo (US)
            {c.volumeNy != null ? ` · ${c.volumeNy.toLocaleString()} (New York)` : ""} · difficulty {c.difficulty ?? "—"}{" "}
            <Trend monthly={c.monthly} />
          </div>
          <div className="text-[10px] text-slate-500">Source: DataForSEO, {day(c.fetchedAt)}</div>
        </div>
      ) : decision ? (
        <div className="text-slate-600">No candidate with real search volume and no existing target was found for &quot;{decision.seed}&quot;.</div>
      ) : (
        <div className="text-slate-500">No keyword decision recorded for this draft.</div>
      )}
      {decision && (
        <div className={decision.mode === "update" ? "font-medium text-amber-800" : "text-slate-700"}>
          {decision.mode === "update" && decision.updateTargetUrl ? (
            <>
              Update of{" "}
              <a href={decision.updateTargetUrl} target="_blank" rel="noreferrer" className="underline">
                {decision.updateTargetUrl.replace(/^https?:\/\/(www\.)?/, "")}
              </a>
            </>
          ) : (
            "New page"
          )}
        </div>
      )}
      {decision && (decision.rejected.length > 0 || decision.related.length > 0) && (
        <div>
          <button type="button" className="text-brand underline" onClick={() => setOpen((v) => !v)}>
            {open ? "hide" : `${decision.rejected.length} rejected, ${decision.related.length} related`}
          </button>
          {open && (
            <ul className="mt-1 space-y-0.5 text-slate-600">
              {decision.rejected.map((r) => (
                <li key={`${r.keyword}:${r.reason}`}>
                  <span className="text-slate-800">{r.keyword}</span>: {r.reason}
                </li>
              ))}
              {decision.related.map((r) => (
                <li key={r.label} className="text-slate-500">
                  related: {r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="underline">{r.label}</a> : r.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
