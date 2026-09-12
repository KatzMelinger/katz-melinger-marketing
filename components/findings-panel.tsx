"use client";

/**
 * Tracked findings for a draft — the durable list, with a status per finding.
 *
 * Distinct from the analysis card, which shows what the LAST run produced and
 * offers Apply-to-rewrite on the text. This shows what is outstanding across
 * runs: who resolved what, what came back after being marked fixed, and what
 * the checks stopped reporting on their own.
 *
 * ITEM 12 — WHY THIS IS A SCORECARD AND NOT A LIST
 *
 * It was a flat list. One blog carried 83 open findings and 298 closed, and a
 * wrong statute and a passive-voice note rendered identically, so the question
 * a reviewer actually has — "can I publish this, and if not, why not" — had no
 * answer anywhere on screen.
 *
 * So: one chip per engine showing its count and its worst severity, each chip a
 * tab; findings grouped by rule and collapsed, because 40 instances of one rule
 * is one decision and not 40; and a readiness line that counts ONLY blockers.
 * Everything else on the panel is context for that one number.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { DashSpinner } from "@/components/dashboard-ui";
import {
  SOURCE_LABEL,
  type FindingStatus,
  type FindingSource,
  type StoredFinding,
} from "@/lib/content-findings";
import {
  countBlockers,
  groupByRule,
  isOpen,
  publishSeverity,
  summarizeByEngine,
  type PublishSeverity,
  type SeverityOverrides,
} from "@/lib/finding-severity";

/** Colour by what a finding DOES, not by which engine raised it. */
const SEVERITY_STYLE: Record<PublishSeverity, string> = {
  blocker: "border-red-300 bg-red-50 text-red-900",
  recommended: "border-amber-300 bg-amber-50 text-amber-900",
  optional: "border-slate-200 bg-white text-slate-600",
};

const CHIP_STYLE: Record<PublishSeverity | "clear", string> = {
  blocker: "border-red-300 bg-red-50 text-red-800",
  recommended: "border-amber-300 bg-amber-50 text-amber-800",
  optional: "border-slate-300 bg-slate-50 text-slate-600",
  clear: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const STATUS_LABEL: Record<FindingStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  resolved_by_edit: "Fixed in the text",
  dismissed: "Dismissed",
};

export function FindingsPanel({
  draftId,
  nonce,
  onFixAll,
}: {
  draftId: string;
  nonce?: number;
  /**
   * Hand a group's finding text to the Apply flow. Absent on a read-only
   * mount, which is why every Fix all button is conditional rather than
   * disabled — an affordance that cannot do anything should not be drawn.
   */
  onFixAll?: (findingTexts: string[]) => void;
}) {
  const [findings, setFindings] = useState<StoredFinding[]>([]);
  const [overrides, setOverrides] = useState<SeverityOverrides>({});
  const [loading, setLoading] = useState(true);
  const [showClosed, setShowClosed] = useState(false);
  const [blockersOnly, setBlockersOnly] = useState(false);
  const [tab, setTab] = useState<FindingSource | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/content/drafts/${draftId}/findings`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setFindings(data.findings ?? []);
        setOverrides(data.severityOverrides ?? {});
      }
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

  const open = useMemo(() => findings.filter(isOpen), [findings]);
  const closed = useMemo(() => findings.filter((f) => !isOpen(f)), [findings]);
  const engines = useMemo(() => summarizeByEngine(findings, overrides), [findings, overrides]);
  const blockers = useMemo(() => countBlockers(findings, overrides), [findings, overrides]);

  // The active tab, with a sensible landing point: the first engine that has
  // anything outstanding, so opening a draft shows work rather than an empty
  // Legal tab. Falls back to the first engine when everything is clear.
  const activeTab: FindingSource = tab ?? engines.find((e) => e.count > 0)?.source ?? engines[0].source;

  const groups = useMemo(() => {
    const scope = (showClosed ? findings : open).filter((f) => f.source === activeTab);
    const filtered = blockersOnly
      ? scope.filter((f) => publishSeverity(f, overrides) === "blocker")
      : scope;
    return groupByRule(filtered, overrides);
  }, [findings, open, activeTab, showClosed, blockersOnly, overrides]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 p-3 text-xs text-slate-500">
        <DashSpinner /> Loading findings…
      </div>
    );
  }

  // Nothing tracked yet, and no gated engine armed to show a "checked, clear"
  // chip — a normal state (the migration may not be run, or the draft has
  // never been analyzed). Say so plainly rather than showing an empty box
  // that reads like "no problems".
  if (findings.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 p-3 text-xs text-slate-500">
        No tracked findings yet — they are recorded the next time the analysis runs.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200">
      {/* Publish readiness. The only line on the panel that decides anything,
          so it leads and it counts blockers and nothing else. */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 rounded-t-lg border-b px-3 py-2 ${
          blockers > 0
            ? "border-red-200 bg-red-50 text-red-900"
            : "border-emerald-200 bg-emerald-50 text-emerald-800"
        }`}
      >
        <div className="text-xs font-semibold">
          {blockers > 0 ? (
            <>
              Not ready to publish · {blockers} blocker{blockers === 1 ? "" : "s"}
            </>
          ) : (
            <>Ready to publish · no blockers</>
          )}
          <span className="ml-1.5 font-normal opacity-70">
            {open.length} open finding{open.length === 1 ? "" : "s"} in total
          </span>
        </div>
        <div className="flex items-center gap-2.5 text-[10px]">
          <label className="flex cursor-pointer items-center gap-1">
            <input
              type="checkbox"
              checked={blockersOnly}
              onChange={(e) => setBlockersOnly(e.target.checked)}
              className="h-3 w-3 cursor-pointer accent-current"
            />
            Blockers only
          </label>
          {closed.length > 0 && (
            <button
              type="button"
              onClick={() => setShowClosed((v) => !v)}
              className="underline opacity-80 hover:opacity-100"
            >
              {showClosed ? "hide closed" : `show ${closed.length} closed`}
            </button>
          )}
        </div>
      </div>

      {/* Scorecard. Every engine appears, including the quiet ones — a tab strip
          that changes shape between drafts has to be re-read every time, and
          "SEO found nothing" is information. */}
      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 px-3 py-2">
        {engines.map((e) => {
          const active = e.source === activeTab;
          const style = e.count === 0 ? CHIP_STYLE.clear : CHIP_STYLE[e.worst ?? "optional"];
          return (
            <button
              key={e.source}
              type="button"
              onClick={() => setTab(e.source)}
              aria-pressed={active}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${style} ${
                active ? "ring-2 ring-brand/40 ring-offset-1" : "opacity-80 hover:opacity-100"
              }`}
            >
              {SOURCE_LABEL[e.source]}
              <span className="ml-1 tabular-nums opacity-80">{e.count === 0 ? "✓" : e.count}</span>
              {e.blockers > 0 && (
                <span className="ml-1 rounded-sm bg-red-600 px-1 text-[9px] font-bold text-white tabular-nums">
                  {e.blockers}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="p-3">
        {groups.length === 0 && (
          <p className="text-xs text-slate-500">
            {blockersOnly
              ? `No blockers in ${SOURCE_LABEL[activeTab]}.`
              : `Nothing outstanding in ${SOURCE_LABEL[activeTab]}.`}
          </p>
        )}

        <ul className="space-y-1.5">
          {groups.map((g) => {
            const isExpanded = expanded.has(g.key);
            // Only findings that carry a suggested fix can be handed to Apply.
            const fixable = g.findings.filter((f) => isOpen(f) && f.fix);
            return (
              <li key={g.key} className={`rounded-md border ${SEVERITY_STYLE[g.severity]}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5">
                  <button
                    type="button"
                    onClick={() => toggle(g.key)}
                    aria-expanded={isExpanded}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs"
                  >
                    <span className="shrink-0 text-[9px] opacity-60">{isExpanded ? "▼" : "▶"}</span>
                    <span className="truncate font-medium">{g.label}</span>
                    <span className="shrink-0 rounded-full bg-white/70 px-1.5 text-[10px] tabular-nums">
                      {g.findings.length}
                    </span>
                  </button>
                  {onFixAll && fixable.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onFixAll(fixable.map((f) => fixText(f)))}
                      className="shrink-0 rounded border border-current/30 px-1.5 py-0.5 text-[10px] hover:bg-white/60"
                    >
                      Fix all {fixable.length}
                    </button>
                  )}
                </div>

                {isExpanded && (
                  <ul className="space-y-1 border-t border-current/15 px-2.5 py-1.5">
                    {g.findings.map((f) => {
                      const closedRow = !isOpen(f);
                      return (
                        <li key={f.id} className="text-xs">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <span className={closedRow ? "line-through opacity-60" : ""}>
                                {f.title}
                              </span>
                              {closedRow && (
                                <span className="ml-1.5 text-[10px] opacity-70">
                                  {STATUS_LABEL[f.status]}
                                </span>
                              )}
                              {f.status === "in_progress" && (
                                <span className="ml-1.5 text-[10px] opacity-70">In progress</span>
                              )}
                            </div>
                            {!closedRow ? (
                              <div className="flex shrink-0 gap-1">
                                {/* One finding on its own. "Fix all" above sends
                                    the whole group; a reviewer who wants just
                                    this one had to resolve it by hand. Only
                                    drawn when there is a suggested fix to send
                                    and somewhere to send it. */}
                                {onFixAll && f.fix && (
                                  <button
                                    type="button"
                                    onClick={() => onFixAll([fixText(f)])}
                                    className="rounded border border-current/30 px-1.5 py-0.5 text-[10px] hover:bg-white/60"
                                  >
                                    Apply fix
                                  </button>
                                )}
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
                            ) : (
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
                            <p className="mt-0.5 truncate text-[10px] italic opacity-80">
                              “{f.excerpt}”
                            </p>
                          )}
                          {f.detail && (
                            <p className="mt-0.5 text-[10px] opacity-75">{f.detail}</p>
                          )}
                          {f.resolvedByEmail && closedRow && (
                            <p className="mt-0.5 text-[10px] opacity-70">
                              {STATUS_LABEL[f.status]} by {f.resolvedByEmail.split("@")[0]}
                              {f.resolvedAt
                                ? ` · ${new Date(f.resolvedAt).toLocaleDateString()}`
                                : ""}
                              {f.resolutionNote ? ` — ${f.resolutionNote}` : ""}
                            </p>
                          )}
                          {/* A finding that came back after being resolved is the
                              signal the whole table exists to surface. */}
                          {!closedRow && f.resolutionNote?.startsWith("Re-opened") && (
                            <p className="mt-0.5 text-[10px] font-medium opacity-80">
                              {f.resolutionNote}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>

        {msg && <p className="mt-1.5 text-[10px] text-red-600">{msg}</p>}
      </div>
    </div>
  );
}

/**
 * Rebuild the string the Apply flow expects.
 *
 * ApplySuggestionModal takes finding TEXT, not ids — it feeds the rewriter
 * prose, and the excerpt is what anchors the change to a span. Reassembling it
 * here keeps the panel from needing its own Apply endpoint.
 */
function fixText(f: StoredFinding): string {
  const head = f.ruleId ? `Rule ${f.ruleId}: ${f.title}.` : `${f.title}.`;
  const fix = f.fix ? ` ${f.fix}` : "";
  const excerpt = f.excerpt ? ` "${f.excerpt}"` : "";
  return `${head}${fix}${excerpt}`.trim();
}
