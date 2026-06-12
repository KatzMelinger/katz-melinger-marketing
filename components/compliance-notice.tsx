"use client";

/**
 * Compact, advisory attorney-advertising compliance notice.
 *
 * Used on the "ephemeral" outbound surfaces — GBP review replies and
 * community/forum responses — where the content is drafted and reviewed in one
 * shot (as opposed to the content pipeline, which persists a full analysis).
 * It surfaces the compliance status, required disclaimers, and violations so
 * the reviewer fixes them before posting. It never blocks anything.
 */

import { useState } from "react";

export type ComplianceNoticeData = {
  score: number;
  status: "compliant" | "needs_changes" | "non_compliant";
  violations: {
    rule: string;
    severity: "high" | "medium" | "low";
    excerpt: string;
    reason: string;
    fix: string;
  }[];
  warnings?: string[];
  requiredDisclaimers: string[];
  summary: string;
};

const STATUS_META: Record<
  ComplianceNoticeData["status"],
  { label: string; cls: string }
> = {
  compliant: {
    label: "Compliant",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  needs_changes: {
    label: "Needs changes",
    cls: "bg-amber-50 text-amber-800 border-amber-200",
  },
  non_compliant: {
    label: "Non-compliant",
    cls: "bg-red-50 text-red-700 border-red-200",
  },
};

const SEV_CLS: Record<"high" | "medium" | "low", string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-slate-100 text-slate-600",
};

export function ComplianceNotice({
  compliance,
  className = "",
}: {
  compliance: ComplianceNoticeData | null | undefined;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!compliance) return null;

  const meta = STATUS_META[compliance.status] ?? STATUS_META.needs_changes;
  const hasDetail =
    compliance.violations.length > 0 ||
    compliance.requiredDisclaimers.length > 0 ||
    Boolean(compliance.summary);

  return (
    <div className={`rounded-md border ${meta.cls} px-2.5 py-2 text-xs ${className}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span aria-hidden>⚖</span>
        <span className="font-semibold">Compliance: {meta.label}</span>
        {typeof compliance.score === "number" && (
          <span className="opacity-70">({compliance.score}/100)</span>
        )}
        {compliance.violations.length > 0 && (
          <span className="opacity-80">
            · {compliance.violations.length} issue
            {compliance.violations.length === 1 ? "" : "s"}
          </span>
        )}
        <span className="ml-auto text-[10px] italic opacity-70">advisory</span>
        {hasDetail && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-[11px] underline underline-offset-2 hover:opacity-80"
          >
            {open ? "Hide" : "Details"}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 space-y-2 text-slate-700">
          {compliance.summary && (
            <p className="text-slate-600">{compliance.summary}</p>
          )}

          {compliance.requiredDisclaimers.length > 0 && (
            <div>
              <div className="font-medium text-slate-700 mb-1">
                Required disclaimers
              </div>
              <div className="flex flex-wrap gap-1.5">
                {compliance.requiredDisclaimers.map((d, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-800"
                  >
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}

          {compliance.violations.length > 0 && (
            <ul className="space-y-1.5">
              {compliance.violations.map((v, i) => (
                <li key={i} className="rounded border border-slate-200 bg-white p-2">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span
                      className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${SEV_CLS[v.severity]}`}
                    >
                      {v.severity}
                    </span>
                    <span className="font-medium text-slate-700">{v.rule}</span>
                  </div>
                  {v.excerpt && (
                    <div className="text-slate-500 italic">“{v.excerpt}”</div>
                  )}
                  <div className="text-slate-600">{v.reason}</div>
                  {v.fix && (
                    <div className="text-emerald-700 mt-0.5">
                      <span className="font-medium">Fix:</span> {v.fix}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
