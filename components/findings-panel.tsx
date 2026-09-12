"use client";

/**
 * Tracked findings for a draft — the durable list, with a status per finding.
 *
 * Distinct from the analysis card, which shows what the LAST run produced and
 * offers Apply-to-rewrite on the text. This shows what is outstanding across
 * runs: who resolved what, what came back after being marked fixed, and what
 * the checks stopped reporting on their own.
 *
 * Tabbed by engine (spec item 2): one chip per source that has findings, plus
 * Legal accuracy / Content freshness whenever their gate flag is armed — even
 * with zero findings, so a reviewer sees "checked, clear" rather than a tab
 * that's just missing. A readiness line and a "Blockers only" toggle work off
 * severity: `critical`/`important` count as blockers, `advisory` never does —
 * which is why a style nit (e.g. first person) can never show up there.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { DashSpinner } from "@/components/dashboard-ui";
import {
  SOURCE_LABEL,
  type FindingSeverity,
  type FindingSource,
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

/** Tab order: gate-related engines first, then the rest. Only sources that are
 *  actually present (or an armed-but-clear gate) become a tab — see `tabs`. */
const TAB_ORDER: FindingSource[] = [
  "compliance",
  "legal",
  "freshness",
  "readability",
  "seo",
  "aeo",
  "cash",
  "brand_voice",
  "linkability",
  "structure",
];

const SEVERITY_RANK: Record<FindingSeverity, number> = { critical: 0, important: 1, advisory: 2 };

/** Sources with their own approval gate (app/api/agent/approve/route.ts).
 *  Readability/SEO/AEO/CASH/brand-voice/linkability have no gate of their
 *  own — per spec item 6 ("none of the three can be a blocker"), a finding
 *  from one of those can be styled `important` but must never count toward
 *  the readiness line, however serious it looks. */
const GATED_SOURCES = new Set<FindingSource>(["compliance", "legal", "freshness"]);

/** A finding counts as a "blocker" for the readiness line/toggle: `critical`
 *  always does (lib/content-findings.ts reserves it for things with their own
 *  gate); `important` only does when it's FROM a gated source — an ungated
 *  engine's "important" finding is worth flagging visually but can't hold up
 *  approval on its own. */
function isBlocker(f: StoredFinding): boolean {
  return f.severity === "critical" || (f.severity === "important" && GATED_SOURCES.has(f.source));
}

type Engines = { legal: boolean; freshness: boolean };

/**
 * Converts a finding into the same free-text feedback shape the apply-suggestion
 * endpoint (app/api/content/drafts/[id]/apply-suggestion) already accepts
 * from the Analysis card — it just wants a natural-language description of
 * what to fix plus the excerpt to anchor on, not a specific schema. Mirrors
 * the "Rule N: description. fix "excerpt"" shape formatReadabilityFindings
 * already produces, generalized to every source.
 */
function findingToFeedback(f: StoredFinding): string {
  const head = [f.title, f.detail].filter(Boolean).join(". ");
  const fix = f.fix ? ` ${f.fix}` : "";
  const excerpt = f.excerpt ? ` "${f.excerpt}"` : "";
  return `${head}.${fix}${excerpt}`.replace(/\s+/g, " ").trim();
}

export function FindingsPanel({
  draftId,
  nonce,
  onApplyFinding,
}: {
  draftId: string;
  nonce?: number;
  /** Sends this finding's text to the same Apply-and-review-diff flow the
   *  Analysis card uses (via ApplySuggestionModal) — the caller owns opening
   *  the modal, this component just hands it the feedback text. Omit to hide
   *  the Apply button entirely (e.g. a read-only context). */
  onApplyFinding?: (findingText: string) => void;
}) {
  const [findings, setFindings] = useState<StoredFinding[]>([]);
  const [engines, setEngines] = useState<Engines>({ legal: false, freshness: false });
  const [loading, setLoading] = useState(true);
  const [showClosed, setShowClosed] = useState(false);
  const [blockersOnly, setBlockersOnly] = useState(false);
  const [activeTab, setActiveTab] = useState<FindingSource | "all">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/content/drafts/${draftId}/findings`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setFindings(data.findings ?? []);
        setEngines(data.engines ?? { legal: false, freshness: false });
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

  // Tabs: any source with at least one finding, plus Legal/Freshness whenever
  // their gate is armed (even at zero findings — that's the "clear" state).
  const tabs = useMemo(() => {
    const present = new Set(findings.map((f) => f.source));
    if (engines.legal) present.add("legal");
    if (engines.freshness) present.add("freshness");
    return TAB_ORDER.filter((s) => present.has(s));
  }, [findings, engines]);

  // A single tab is its own "All" — showing both would just duplicate it.
  const showAllTab = tabs.length > 1;
  const effectiveTab = activeTab === "all" && !showAllTab ? (tabs[0] ?? "all") : activeTab;

  const bySource = effectiveTab === "all" ? findings : findings.filter((f) => f.source === effectiveTab);
  const open = bySource.filter((f) => f.status === "open" || f.status === "in_progress");
  const closed = bySource.filter((f) => f.status === "resolved" || f.status === "dismissed");
  let visible = showClosed ? [...open, ...closed] : open;
  if (blockersOnly) visible = visible.filter(isBlocker);
  visible = [...visible].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  // Readiness line counts across the WHOLE draft, not just the active tab —
  // that's the number a reviewer needs before approving, regardless of which
  // tab happens to be open.
  const openAll = findings.filter((f) => f.status === "open" || f.status === "in_progress");
  const blockerCount = openAll.filter(isBlocker).length;
  const advisoryCount = openAll.length - blockerCount;

  const tabCount = (source: FindingSource) => {
    const inTab = openAll.filter((f) => f.source === source);
    return { total: inTab.length, blockers: inTab.filter(isBlocker).length };
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 p-3 text-xs text-slate-500">
        <DashSpinner /> Loading findings…
      </div>
    );
  }

  // Nothing tracked yet, and no gated engine is armed to show a clear state —
  // a normal state (the migration may not be run, or the draft has never
  // been analyzed). Say so plainly rather than showing an empty box that
  // reads like "no problems".
  if (findings.length === 0 && tabs.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 p-3 text-xs text-slate-500">
        No tracked findings yet — they are recorded the next time the analysis runs.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold">
          {blockerCount > 0 ? (
            <span className="text-red-700">
              <span aria-hidden>🚫</span> {blockerCount} blocker{blockerCount === 1 ? "" : "s"} to resolve
            </span>
          ) : (
            <span className="text-emerald-700">
              <span aria-hidden>✓</span> No blockers
            </span>
          )}
          {advisoryCount > 0 && (
            <span className="ml-1.5 font-normal text-slate-500">
              · {advisoryCount} advisory
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-[10px] text-slate-500">
            <input
              type="checkbox"
              checked={blockersOnly}
              onChange={(e) => setBlockersOnly(e.target.checked)}
              className="h-3 w-3"
            />
            Blockers only
          </label>
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
      </div>

      {(showAllTab || tabs.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-1.5 border-b border-slate-100 pb-2">
          {showAllTab && (
            <TabChip
              label="All"
              active={effectiveTab === "all"}
              onClick={() => setActiveTab("all")}
            />
          )}
          {tabs.map((s) => {
            const c = tabCount(s);
            return (
              <TabChip
                key={s}
                label={SOURCE_LABEL[s]}
                count={c.total}
                hasBlocker={c.blockers > 0}
                active={effectiveTab === s}
                onClick={() => setActiveTab(s)}
              />
            );
          })}
        </div>
      )}

      {bySource.length === 0 ? (
        <p className="text-xs text-emerald-700">
          <span aria-hidden>✓</span> {SOURCE_LABEL[effectiveTab as FindingSource]} checked — no issues found.
        </p>
      ) : open.length === 0 && !showClosed ? (
        <p className="text-xs text-emerald-700">
          Nothing outstanding. {closed.length} finding{closed.length === 1 ? "" : "s"} closed.
        </p>
      ) : visible.length === 0 && blockersOnly ? (
        <p className="text-xs text-slate-500">No blockers here.</p>
      ) : (
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
                      {onApplyFinding && (
                        <button
                          type="button"
                          onClick={() => onApplyFinding(findingToFeedback(f))}
                          className="rounded border border-brand/40 bg-brand/5 px-1.5 py-0.5 text-[10px] font-medium text-brand hover:bg-brand/10"
                          title="Send this finding to Claude for a rewrite — you review the diff before it saves."
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
      )}

      {msg && <p className="mt-1.5 text-[10px] text-red-600">{msg}</p>}
    </div>
  );
}

function TabChip({
  label,
  count,
  hasBlocker,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  hasBlocker?: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active
          ? "border-brand bg-brand/10 text-brand"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
      }`}
    >
      {label}
      {typeof count === "number" && count > 0 && (
        <span
          className={`ml-1 rounded-full px-1.5 text-[10px] ${
            hasBlocker ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
