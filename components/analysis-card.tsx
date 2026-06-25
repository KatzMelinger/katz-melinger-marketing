"use client";

/**
 * Shared analysis UI — the rich content-analysis card and its "Apply
 * suggestion" diff flow. Used by both the Drafts studio (/content/drafts)
 * and the Production Board's review drawer (components/draft-drawer.tsx) so
 * both surfaces show the SAME scores, findings (apply-to-rewrite), suggested
 * titles/images/links, compliance, and overlap checks.
 *
 * Extracted from app/content/drafts/page.tsx — no behavior change.
 */

import { useEffect, useMemo, useState } from "react";
import { diffWords, type Change } from "diff";

import {
  DashBar,
  DashButton,
  DashCard,
  DashPill,
  DashSpinner,
} from "@/components/dashboard-ui";
import { toPlaintext } from "@/lib/readability/plaintext";
import { analyzeLengths } from "@/lib/readability/checks";
import {
  DEFAULT_THRESHOLDS,
  type ReadabilityThresholds,
  type Status,
} from "@/lib/readability/config";

export type Analysis = {
  readability_score: number;
  reading_grade_level: number;
  word_count: number;
  sentence_count: number;
  // Readability detail (Phase 1). Optional so analyses persisted before the
  // migration still satisfy the type.
  readability_avg_sentence_length?: number | null;
  readability_long_sentences_count?: number | null;
  readability_long_paragraphs_count?: number | null;
  readability_overall_status?: "green" | "amber" | "red" | null;
  keyword_density: Record<string, number>;
  target_keyword_hits: Record<string, number>;
  aeo_score: number;
  aeo_findings: string[];
  // Claude-backed scores are nullable: null means "couldn't compute, re-run".
  // Distinguishing this from a real 0 score keeps the UI from misleading users.
  brand_voice_score: number | null;
  brand_voice_findings: string[];
  cash_score: number | null;
  cash_breakdown?: {
    conversationalAuthority: number;
    answerCompleteness: number;
    sourceExpertise: number;
    humanAttribution: number;
  };
  cash_findings?: string[];
  seo_score?: number;
  seo_breakdown?: {
    titleQuality: number;
    headingStructure: number;
    keywordPlacement: number;
    authorityLinks: number;
    contentDepth: number;
    schemaReadiness: number;
  };
  seo_findings?: string[];
  linkability_score: number | null;
  linkability_findings?: string[];
  outreach_angles?: { audience: string; pitch: string }[];
  // Attorney-advertising compliance (advisory). Optional so older analyses
  // loaded from the DB before the migration don't fail the type check.
  compliance_score?: number | null;
  compliance_status?: "compliant" | "needs_changes" | "non_compliant" | null;
  compliance_violations?: {
    rule: string;
    severity: "high" | "medium" | "low";
    excerpt: string;
    reason: string;
    fix: string;
  }[];
  compliance_required_disclaimers?: string[];
  compliance_summary?: string;
  suggested_titles?: string[];
  // Live-only fields (stripped before persistence). Optional so older
  // analyses loaded from DB don't fail the type check.
  suggested_titles_conflicts_avoided?: number;
  suggested_titles_dropped?: {
    title: string;
    conflicts: {
      source: "pipeline" | "draft" | "ranked_keyword";
      text: string;
      url?: string | null;
      similarity: number;
    }[];
  }[];
  suggested_images?: { type: string; description: string; altText: string }[];
  summary: string;
};

export function AnalysisCard({
  analysis,
  onRerun,
  rerunning,
  onApplyFindings,
  onApplyTitle,
  onApplyLink,
  currentTitle,
  body,
  onSelectRange,
}: {
  analysis: Analysis;
  onRerun?: () => void;
  rerunning?: boolean;
  /** Draft Markdown — lets the readability panel recompute flagged ranges
   *  client-side (same pure checks the server scored with). */
  body?: string;
  /** Called when a flagged sentence/paragraph is clicked, with its source
   *  character range, so the editor can scroll to / select it. */
  onSelectRange?: (start: number, end: number) => void;
  /** Called when the user invokes Apply — either via a single row's button
   *  or via "Apply N selected". The list contains one or more finding
   *  strings; the modal handles both shapes. */
  onApplyFindings?: (findings: string[]) => void;
  /** When provided, suggested titles get an inline Apply button that PATCHes
   *  the draft title to the picked option. */
  onApplyTitle?: (title: string) => void;
  /** When provided, the overlap check shows an "Add link" button per existing
   *  page that links the matched term to it in the draft body. */
  onApplyLink?: (term: string, url: string) => void | Promise<void>;
  /** Current draft title — used to mark the active title in the picker. */
  currentTitle?: string | null;
}) {
  // Set of finding strings the user has checked for batch-apply. Spans all
  // categories (SEO + AEO + CASH + brand voice + linkability) so the user
  // can mix and match before sending one Claude call.
  const [selectedFindings, setSelectedFindings] = useState<Set<string>>(
    new Set(),
  );
  const toggleFinding = (f: string) => {
    setSelectedFindings((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };
  const clearFindingSelection = () => setSelectedFindings(new Set());
  const handleApplySelected = () => {
    if (selectedFindings.size === 0 || !onApplyFindings) return;
    onApplyFindings(Array.from(selectedFindings));
    // Don't clear yet — wait until the modal closes (the user might Discard
    // and want to re-try). Cleared in onAccept via parent state reset.
  };
  const cash = analysis.cash_breakdown;
  const seoBreakdown = analysis.seo_breakdown;
  const hasMissingScores =
    analysis.brand_voice_score === null ||
    analysis.cash_score === null ||
    analysis.linkability_score === null ||
    analysis.compliance_score === null;
  const selectedCount = selectedFindings.size;

  return (
    <DashCard>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="text-sm font-medium">Analysis</div>
        <div className="flex items-center gap-2">
          {onApplyFindings && selectedCount > 0 && (
            <>
              <button
                type="button"
                onClick={clearFindingSelection}
                className="text-xs text-slate-500 hover:text-slate-700 underline"
              >
                clear
              </button>
              <button
                type="button"
                onClick={handleApplySelected}
                className="text-xs px-2.5 py-1 rounded border border-emerald-400 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 inline-flex items-center gap-1.5 font-medium"
                title={`Send all ${selectedCount} selected findings to Claude in one shot — faster than applying one at a time.`}
              >
                <span aria-hidden>✨</span>
                Apply {selectedCount} selected
              </button>
            </>
          )}
          {onRerun && (
            <button
              type="button"
              onClick={onRerun}
              disabled={rerunning}
              className={`text-xs px-2.5 py-1 rounded border ${
                hasMissingScores
                  ? "border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100"
                  : "border-slate-300 text-slate-700 hover:border-brand hover:text-brand"
              } disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1.5`}
              title={
                hasMissingScores
                  ? "Some scores couldn't compute — try re-running."
                  : "Recompute all scores from scratch."
              }
            >
              {rerunning ? (
                <DashSpinner />
              ) : (
                <span aria-hidden>{hasMissingScores ? "⚠" : "↻"}</span>
              )}
              {rerunning ? "Re-running…" : "Re-run analysis"}
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
        <ScoreTile label="Readability" value={analysis.readability_score} />
        <ScoreTile
          label="SEO"
          value={analysis.seo_score ?? 0}
          hint="Title / headings / keyword placement / authority links / depth / schema"
        />
        <ScoreTile label="AEO" value={analysis.aeo_score} />
        <ScoreTile
          label="CASH (AI cite)"
          value={analysis.cash_score}
          hint="Conversational Authority / Answer / Source / Human"
        />
        <ScoreTile label="Brand voice" value={analysis.brand_voice_score} />
        <ScoreTile
          label="Linkability"
          value={analysis.linkability_score}
          hint="How earnable backlinks to this piece are"
        />
        <ScoreTile
          label="Compliance"
          value={analysis.compliance_score ?? null}
          hint="NY/NJ attorney-advertising review (advisory)"
        />
      </div>
      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <Tile label="Words" value={analysis.word_count} />
        <Tile
          label="Avg sentence"
          value={
            analysis.readability_avg_sentence_length != null
              ? `${analysis.readability_avg_sentence_length} words`
              : "—"
          }
        />
        <Tile label="Grade level" value={analysis.reading_grade_level} />
        <Tile label="Sentences" value={analysis.sentence_count} />
      </div>
      <ReadabilitySection
        analysis={analysis}
        body={body}
        onSelectRange={onSelectRange}
      />
      {seoBreakdown && (
        <div className="mt-4">
          <div className="text-xs font-medium text-slate-700 mb-2">SEO breakdown</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <SeoPillar label="Title" value={seoBreakdown.titleQuality} />
            <SeoPillar label="Headings" value={seoBreakdown.headingStructure} />
            <SeoPillar label="Keyword placement" value={seoBreakdown.keywordPlacement} />
            <SeoPillar label="Authority links" value={seoBreakdown.authorityLinks} />
            <SeoPillar label="Content depth" value={seoBreakdown.contentDepth} />
            <SeoPillar label="Schema readiness" value={seoBreakdown.schemaReadiness} />
          </div>
        </div>
      )}
      {cash && (
        <div className="mt-4">
          <div className="text-xs font-medium text-slate-700 mb-2">
            CASH breakdown (AI citation-worthiness)
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <CashPillar label="Conversational" letter="C" value={cash.conversationalAuthority} />
            <CashPillar label="Answer" letter="A" value={cash.answerCompleteness} />
            <CashPillar label="Source" letter="S" value={cash.sourceExpertise} />
            <CashPillar label="Human" letter="H" value={cash.humanAttribution} />
          </div>
        </div>
      )}
      {(analysis.compliance_status ||
        (analysis.compliance_violations?.length ?? 0) > 0 ||
        (analysis.compliance_required_disclaimers?.length ?? 0) > 0) && (
        <CompliancePanel
          status={analysis.compliance_status ?? null}
          summary={analysis.compliance_summary ?? ""}
          violations={analysis.compliance_violations ?? []}
          requiredDisclaimers={analysis.compliance_required_disclaimers ?? []}
        />
      )}
      <div className="grid md:grid-cols-2 gap-4 mt-4">
        {analysis.seo_findings && analysis.seo_findings.length > 0 && (
          <FindingsList
            label="SEO findings"
            findings={analysis.seo_findings}
            onApply={onApplyFindings ? (f) => onApplyFindings([f]) : undefined}
            selected={selectedFindings}
            onToggleSelected={onApplyFindings ? toggleFinding : undefined}
          />
        )}
        <FindingsList
          label="AEO findings"
          findings={analysis.aeo_findings}
          onApply={onApplyFindings ? (f) => onApplyFindings([f]) : undefined}
          selected={selectedFindings}
          onToggleSelected={onApplyFindings ? toggleFinding : undefined}
        />
        {analysis.cash_findings && analysis.cash_findings.length > 0 && (
          <FindingsList
            label="CASH findings"
            findings={analysis.cash_findings}
            onApply={onApplyFindings ? (f) => onApplyFindings([f]) : undefined}
            selected={selectedFindings}
            onToggleSelected={onApplyFindings ? toggleFinding : undefined}
          />
        )}
        <FindingsList
          label="Brand voice findings"
          findings={analysis.brand_voice_findings}
          onApply={onApplyFindings ? (f) => onApplyFindings([f]) : undefined}
          selected={selectedFindings}
          onToggleSelected={onApplyFindings ? toggleFinding : undefined}
        />
      </div>
      {analysis.linkability_findings && analysis.linkability_findings.length > 0 && (
        <div className="mt-4">
          <FindingsList
            label="Linkability findings"
            findings={analysis.linkability_findings}
            onApply={onApplyFindings ? (f) => onApplyFindings([f]) : undefined}
            selected={selectedFindings}
            onToggleSelected={onApplyFindings ? toggleFinding : undefined}
          />
        </div>
      )}
      {analysis.outreach_angles && analysis.outreach_angles.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-medium text-slate-700 mb-2">
            Outreach angles (who to pitch + what to say)
          </div>
          <ul className="space-y-2">
            {analysis.outreach_angles.map((angle, i) => (
              <li
                key={i}
                className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <div className="text-[11px] uppercase tracking-wider text-slate-500">
                  {angle.audience}
                </div>
                <div className="text-xs text-slate-700 mt-0.5">{angle.pitch}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {analysis.suggested_titles && analysis.suggested_titles.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <div className="text-xs font-medium text-slate-700">
              Suggested titles
            </div>
            {(analysis.suggested_titles_conflicts_avoided ?? 0) > 0 && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full border border-amber-300 bg-amber-50 text-amber-800"
                title={
                  analysis.suggested_titles_dropped
                    ?.map(
                      (d) =>
                        `"${d.title}" conflicts with ${d.conflicts[0]?.source}: "${d.conflicts[0]?.text}"`,
                    )
                    .join("\n") ?? ""
                }
              >
                {analysis.suggested_titles_conflicts_avoided} conflict
                {analysis.suggested_titles_conflicts_avoided === 1 ? "" : "s"}{" "}
                avoided
              </span>
            )}
          </div>
          <ul className="space-y-1.5">
            {analysis.suggested_titles.map((t, i) => {
              const isCurrent = currentTitle && currentTitle.trim() === t.trim();
              return (
                <li
                  key={i}
                  className={`flex items-start gap-2 rounded-md border px-3 py-2 ${
                    isCurrent
                      ? "border-emerald-300 bg-emerald-50/60"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <span className="text-[10px] text-slate-400 mt-0.5 tabular-nums">
                    {i + 1}.
                  </span>
                  <span className="text-xs text-slate-800 flex-1">{t}</span>
                  <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
                    {t.length} chars
                  </span>
                  {onApplyTitle && !isCurrent && (
                    <button
                      type="button"
                      onClick={() => onApplyTitle(t)}
                      className="text-[10px] px-2 py-0.5 rounded border border-slate-300 text-slate-700 hover:border-brand hover:text-brand shrink-0"
                      title="Use this as the draft title"
                    >
                      Use
                    </button>
                  )}
                  {isCurrent && (
                    <span className="text-[10px] text-emerald-700 shrink-0">
                      Current
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {analysis.suggested_images && analysis.suggested_images.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-medium text-slate-700 mb-2">
            Suggested images
            <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-400">
              Click Create to generate, or hand off to Midjourney / DALL-E
            </span>
          </div>
          <ul className="space-y-2">
            {analysis.suggested_images.map((img, i) => (
              <li
                key={i}
                className="rounded-md border border-slate-200 bg-white px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-violet-700">
                    {img.type}
                  </span>
                  <a
                    href={`/content/images?prompt=${encodeURIComponent(
                      `${img.type ? `${img.type}: ` : ""}${img.description}`,
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50"
                  >
                    Create image
                  </a>
                </div>
                <div className="mt-1.5 text-xs text-slate-800">{img.description}</div>
                <div className="mt-1 text-[11px] italic text-slate-500">
                  <span className="font-semibold not-italic">Alt text:</span>{" "}
                  {img.altText}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {Object.keys(analysis.target_keyword_hits).length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-medium text-slate-700 mb-1">Target keyword hits</div>
          <div className="space-y-1.5">
            {Object.entries(analysis.target_keyword_hits).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 text-xs">
                <span className="w-48 truncate">{k}</span>
                <span className="w-8 text-right text-slate-600">{v}×</span>
                <DashPill tone={v === 0 ? "red" : v > 5 ? "amber" : "emerald"}>
                  {v === 0 ? "missing" : v > 5 ? "over-stuffed" : "good"}
                </DashPill>
              </div>
            ))}
          </div>
        </div>
      )}
      <ContentOverlapPanel
        terms={[
          ...Object.keys(analysis.target_keyword_hits ?? {}),
          ...(currentTitle ? [currentTitle] : []),
        ]}
        onApplyLink={onApplyLink}
      />

      {analysis.summary && (
        <div className="mt-4 pt-4 border-t border-slate-200 text-sm italic text-slate-600">
          {analysis.summary}
        </div>
      )}
    </DashCard>
  );
}

/**
 * Content-overlap panel — on demand, checks the site_pages cluster map for
 * existing pages that already cover this draft's keywords/title, and surfaces
 * "link, don't redefine" recommendations. Decoupled from the main analysis
 * pipeline so it never slows a re-analyze.
 */
/** Friendly label for why a page is the recommended link target. */
function pageTypeLabel(t?: string): string {
  switch (t) {
    case "pillar":
      return "pillar page";
    case "service_page":
    case "practice_area":
      return "service page";
    case "cluster":
      return "cluster page";
    case "blog_post":
      return "blog post";
    case "case_result":
      return "case result";
    default:
      return "";
  }
}

function ContentOverlapPanel({
  terms,
  onApplyLink,
}: {
  terms: string[];
  onApplyLink?: (term: string, url: string) => void | Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const [matches, setMatches] = useState<
    { term: string; pages: { url: string; title: string | null; page_type?: string }[] }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  // Track which term→url link is being applied / has been applied.
  const [applying, setApplying] = useState<string | null>(null);
  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(new Set());

  const apply = async (term: string, url: string) => {
    if (!onApplyLink) return;
    const key = `${term}→${url}`;
    setApplying(key);
    try {
      await onApplyLink(term, url);
      setAppliedKeys((prev) => new Set(prev).add(key));
    } finally {
      setApplying(null);
    }
  };

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/content/overlap-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terms }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "check failed");
      setMatches(json.matches ?? []);
      setChecked(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "check failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-200">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-slate-700">
          Content overlap check
          <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-400">
            link, don&apos;t redefine
          </span>
        </div>
        <button
          onClick={run}
          disabled={loading || terms.length === 0}
          className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-400 disabled:opacity-50"
        >
          {loading ? "Checking…" : "Check site for overlap"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      {checked && matches.length === 0 && !error && (
        <p className="mt-2 text-xs text-emerald-700">
          No overlap found in the cluster map — nothing to link instead of
          redefine.
        </p>
      )}
      {matches.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {matches.map((m, i) => (
            <li
              key={i}
              className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs"
            >
              <span className="font-medium text-amber-900">
                &quot;{m.term}&quot; already covered — link, don&apos;t redefine:
              </span>
              <ul className="mt-1 space-y-1">
                {m.pages.map((p, j) => {
                  const key = `${m.term}→${p.url}`;
                  const isApplied = appliedKeys.has(key);
                  // Pages arrive pre-ranked (pillar → service → cluster → blog →
                  // case result), so the first one is the best link target.
                  const recommended = j === 0;
                  return (
                    <li key={j} className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          className="min-w-0 truncate text-slate-700 underline-offset-2 hover:underline"
                        >
                          {p.title ?? p.url}
                        </a>
                        {recommended && (
                          <span
                            title={`Best target${pageTypeLabel(p.page_type) ? ` — ${pageTypeLabel(p.page_type)}` : ""}`}
                            className="shrink-0 rounded bg-emerald-100 px-1.5 text-[10px] font-medium uppercase text-emerald-700"
                          >
                            ★ Recommended{pageTypeLabel(p.page_type) ? ` · ${pageTypeLabel(p.page_type)}` : ""}
                          </span>
                        )}
                      </span>
                      {onApplyLink && (
                        <button
                          onClick={() => apply(m.term, p.url)}
                          disabled={applying === key || isApplied}
                          title={`Link "${m.term}" to this page in the draft body`}
                          className="shrink-0 rounded border border-amber-400 bg-white px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60"
                        >
                          {isApplied
                            ? "✓ Linked"
                            : applying === key
                              ? "Linking…"
                              : "Add link"}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Findings list with a per-row "Apply" button. When onApply isn't provided
 * (e.g. for findings about meta-issues that don't have a clear in-body fix),
 * the component falls back to the original bulleted display.
 */
function FindingsList({
  label,
  findings,
  onApply,
  selected,
  onToggleSelected,
}: {
  label: string;
  findings: string[];
  /** Single-row Apply (the inline button). Receives one finding string. */
  onApply?: (finding: string) => void;
  /** Set of finding strings checked for batch-apply. */
  selected?: Set<string>;
  /** Called when the user toggles a row's checkbox. */
  onToggleSelected?: (finding: string) => void;
}) {
  // Some findings describe meta-issues (missing keywords on the draft,
  // analysis failures, scoring re-run prompts) that an in-body edit can't
  // fix. Filter Apply out of those so users don't waste a Claude call.
  const isApplicable = (f: string) => {
    const lc = f.toLowerCase();
    return !(
      lc.includes("scoring couldn't run") ||
      lc.includes("scoring failed") ||
      lc.includes("re-run analysis") ||
      lc.includes("no target keywords set") ||
      lc.includes("recommended structured data")
    );
  };

  // Select-all-in-this-list helper. Only operates on applicable findings.
  const applicableCount = findings.filter(isApplicable).length;
  const selectedHereCount = onToggleSelected
    ? findings.filter((f) => isApplicable(f) && selected?.has(f)).length
    : 0;
  const allSelectedHere =
    applicableCount > 0 && selectedHereCount === applicableCount;
  const toggleAllInList = () => {
    if (!onToggleSelected) return;
    if (allSelectedHere) {
      // Untoggle each applicable finding
      for (const f of findings) {
        if (isApplicable(f) && selected?.has(f)) onToggleSelected(f);
      }
    } else {
      for (const f of findings) {
        if (isApplicable(f) && !selected?.has(f)) onToggleSelected(f);
      }
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs font-medium text-slate-700">{label}</div>
        {onToggleSelected && applicableCount > 1 && (
          <button
            type="button"
            onClick={toggleAllInList}
            className="text-[10px] text-slate-500 hover:text-brand underline"
          >
            {allSelectedHere ? "deselect all" : "select all"}
          </button>
        )}
      </div>
      <ul className="text-xs space-y-1.5">
        {findings.map((f, i) => {
          const applicable = isApplicable(f);
          const isSelected = !!selected?.has(f);
          return (
            <li
              key={i}
              className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 ${
                isSelected
                  ? "border-emerald-300 bg-emerald-50/60"
                  : "border-slate-200 bg-white/60"
              }`}
            >
              {onToggleSelected && applicable ? (
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelected(f)}
                  className="mt-0.5 accent-emerald-600 cursor-pointer"
                  title="Include in batch Apply"
                />
              ) : (
                <span aria-hidden className="text-slate-400 mt-0.5">
                  ·
                </span>
              )}
              <span className="flex-1 text-slate-700">{f}</span>
              {onApply && applicable && (
                <button
                  type="button"
                  onClick={() => onApply(f)}
                  className="text-[10px] px-2 py-0.5 rounded border border-slate-300 text-slate-700 hover:border-brand hover:text-brand shrink-0"
                  title="Apply just this one"
                >
                  Apply
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Diff modal for the Apply Suggestion flow. Loads a proposed edit from the
 * AI, shows before/after, lets the user accept or discard. The accept
 * callback is responsible for PATCHing the draft — this component only
 * surfaces the candidate edit.
 */
export function ApplySuggestionModal({
  draftId,
  findings,
  onAccept,
  onClose,
}: {
  draftId: string;
  /** One or more findings to apply. Multi-mode triggers a richer header
   *  listing each finding so the user can verify the batch before accepting. */
  findings: string[];
  onAccept: (newBody: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const isMulti = findings.length > 1;
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [originalBody, setOriginalBody] = useState<string>("");
  const [updatedBody, setUpdatedBody] = useState<string>("");
  const [summary, setSummary] = useState<string>("");
  const [noChange, setNoChange] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/content/drafts/${draftId}/apply-suggestion`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Always send as an array — backend handles both keys.
            body: JSON.stringify({ findings }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Apply failed");
        if (cancelled) return;
        setOriginalBody(data.original_body ?? "");
        setUpdatedBody(data.updated_body ?? "");
        setSummary(data.summary ?? "");
        setNoChange(!!data.no_change);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // join() gives a stable dep value so swapping order of an identical
    // findings list doesn't trigger a re-fetch.
  }, [draftId, findings.join("\n")]);

  const handleAccept = async () => {
    setAccepting(true);
    try {
      await onAccept(updatedBody);
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-5xl max-h-[90vh] flex flex-col rounded-xl bg-white border border-slate-200 shadow-xl relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-slate-400 hover:text-slate-700 text-xl"
          aria-label="Close"
        >
          ×
        </button>
        <div className="p-5 border-b border-slate-200">
          <h2 className="text-base font-semibold">
            {isMulti
              ? `Apply ${findings.length} suggestions`
              : "Apply suggestion"}
          </h2>
          {isMulti ? (
            <div className="text-xs text-slate-600 mt-1.5">
              <div className="font-medium mb-1">Findings being applied:</div>
              <ol className="list-decimal pl-5 space-y-0.5 max-h-24 overflow-auto">
                {findings.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="text-xs text-slate-600 mt-1">
              <span className="font-medium">Finding:</span> {findings[0]}
            </p>
          )}
        </div>

        {loading ? (
          <div className="p-12 flex flex-col items-center gap-3 text-sm text-slate-600">
            <DashSpinner />
            {isMulti
              ? `Asking Claude to resolve all ${findings.length} in one pass…`
              : "Asking Claude for the smallest edit that resolves this…"}
          </div>
        ) : error ? (
          <div className="p-5 text-sm text-red-700 bg-red-50 border-t border-red-200">
            {error}
            <div className="mt-3">
              <DashButton variant="outline" onClick={onClose}>
                Close
              </DashButton>
            </div>
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
              <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">
                Summary
              </div>
              <div className="text-sm text-slate-800">
                {summary || "(no summary returned)"}
              </div>
              {noChange && (
                <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded px-2 py-1">
                  Claude decided not to change the draft. Read the summary
                  before accepting — there&apos;s no edit to apply.
                </div>
              )}
            </div>

            <RedlinePanel original={originalBody} updated={updatedBody} />


            <div className="p-4 border-t border-slate-200 flex items-center justify-end gap-2">
              <DashButton variant="outline" onClick={onClose} disabled={accepting}>
                Discard
              </DashButton>
              <DashButton onClick={handleAccept} disabled={accepting || noChange}>
                {accepting ? <DashSpinner /> : "Accept changes"}
              </DashButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Word-level redline diff between two text blobs. Renders in a single
 * scrollable pane in the format a legal editor expects:
 *   - Deletions: red, line-through
 *   - Additions: green background, underlined
 *   - Unchanged: regular color
 *
 * Diff is computed lazily via useMemo so re-renders during scroll don't
 * re-run the diff algorithm. For drafts up to ~10k chars (well above our
 * typical post length) this is sub-50ms on commodity hardware.
 */
function RedlinePanel({
  original,
  updated,
}: {
  original: string;
  updated: string;
}) {
  const changes = useMemo<Change[]>(
    () => diffWords(original, updated),
    [original, updated],
  );

  const hasAnyChange = changes.some((c) => c.added || c.removed);

  // Counts surfaced in the legend so the user can scan "what's the scope of
  // this edit" without reading the whole pane.
  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const c of changes) {
      if (c.added) added += c.value.trim() ? c.value.trim().split(/\s+/).length : 0;
      if (c.removed) removed += c.value.trim() ? c.value.trim().split(/\s+/).length : 0;
    }
    return { added, removed };
  }, [changes]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 text-[11px] bg-slate-50 border-b border-slate-200">
        <span className="uppercase tracking-wider text-slate-500 font-medium">
          Redline
        </span>
        <span className="inline-flex items-center gap-1 text-emerald-700">
          <span className="inline-block w-3 h-3 rounded-sm bg-emerald-100 border border-emerald-400" />
          added
          {stats.added > 0 && (
            <span className="tabular-nums">({stats.added})</span>
          )}
        </span>
        <span className="inline-flex items-center gap-1 text-red-700">
          <span className="inline-block w-3 h-3 rounded-sm bg-red-100 border border-red-400" />
          removed
          {stats.removed > 0 && (
            <span className="tabular-nums">({stats.removed})</span>
          )}
        </span>
        {!hasAnyChange && (
          <span className="text-slate-500 italic ml-auto">
            (no changes — text is identical)
          </span>
        )}
      </div>
      <pre className="flex-1 overflow-auto p-4 text-xs whitespace-pre-wrap font-mono text-slate-700 leading-relaxed">
        {changes.map((c, i) => {
          if (c.added) {
            return (
              <span
                key={i}
                className="bg-emerald-100 text-emerald-900 underline decoration-emerald-500 decoration-1"
              >
                {c.value}
              </span>
            );
          }
          if (c.removed) {
            return (
              <span
                key={i}
                className="bg-red-100 text-red-800 line-through decoration-red-500 decoration-1"
              >
                {c.value}
              </span>
            );
          }
          return <span key={i}>{c.value}</span>;
        })}
      </pre>
    </div>
  );
}

function SeoPillar({ label, value }: { label: string; value: number }) {
  const tone =
    value >= 70
      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
      : value >= 40
        ? "border-amber-300 bg-amber-50 text-amber-700"
        : "border-red-300 bg-red-50 text-red-700";
  return (
    <div className={`rounded-md border px-2 py-1.5 ${tone}`}>
      <div className="flex items-baseline gap-1.5">
        <span className="text-base font-semibold tabular-nums">{value}</span>
      </div>
      <div className="text-[10px] opacity-80">{label}</div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

function StatusChip({ status }: { status: Status | null | undefined }) {
  if (!status) return null;
  const meta = {
    green: { label: "Good", cls: "border-emerald-300 bg-emerald-50 text-emerald-700" },
    amber: { label: "Review", cls: "border-amber-300 bg-amber-50 text-amber-700" },
    red: { label: "Needs work", cls: "border-red-300 bg-red-50 text-red-700" },
  }[status];
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

/**
 * Readability detail (Phase 1: sentence/paragraph length). Summary counts come
 * from the persisted analysis; when the draft `body` is available the flagged
 * ranges are recomputed client-side with the SAME pure checks the server scored
 * with, so clicking a flagged item can jump to it in the editor.
 */
function ReadabilitySection({
  analysis,
  body,
  onSelectRange,
}: {
  analysis: Analysis;
  body?: string;
  onSelectRange?: (start: number, end: number) => void;
}) {
  const [thresholds, setThresholds] = useState<ReadabilityThresholds>(DEFAULT_THRESHOLDS);
  useEffect(() => {
    let active = true;
    fetch("/api/content/readability-thresholds")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active && d?.thresholds) setThresholds(d.thresholds as ReadabilityThresholds);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const flags = useMemo(
    () => (body ? analyzeLengths(toPlaintext(body), thresholds) : null),
    [body, thresholds],
  );

  const status = analysis.readability_overall_status ?? flags?.overallStatus ?? null;
  const longSentences =
    flags?.longSentencesCount ?? analysis.readability_long_sentences_count ?? null;
  const longParagraphs =
    flags?.longParagraphsCount ?? analysis.readability_long_paragraphs_count ?? null;

  // Nothing to show: analysis predates the migration and we have no body to
  // recompute from.
  if (status === null && longSentences === null && longParagraphs === null) return null;

  const flagged = flags
    ? [
        ...flags.longSentences.map((f) => ({ ...f, kind: "Sentence" as const })),
        ...flags.longParagraphs.map((f) => ({ ...f, kind: "Paragraph" as const })),
      ]
    : [];

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="text-xs font-medium text-slate-700">Readability</div>
        <StatusChip status={status} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Tile label="Long sentences" value={longSentences ?? "—"} />
        <Tile label="Long paragraphs" value={longParagraphs ?? "—"} />
      </div>
      {flagged.length > 0 && (
        <ul className="mt-2 space-y-1">
          {flagged.map((f, i) => (
            <li key={`${f.kind}-${f.start}-${i}`}>
              <button
                type="button"
                onClick={() => onSelectRange?.(f.start, f.end)}
                disabled={!onSelectRange}
                className={`w-full text-left text-xs rounded border px-2 py-1.5 flex items-start gap-2 ${
                  f.severity === "red"
                    ? "border-red-200 bg-red-50/60 hover:bg-red-50"
                    : "border-amber-200 bg-amber-50/60 hover:bg-amber-50"
                } ${onSelectRange ? "cursor-pointer" : "cursor-default"}`}
                title={onSelectRange ? "Jump to this in the draft" : undefined}
              >
                <span
                  className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${
                    f.severity === "red" ? "bg-red-500" : "bg-amber-500"
                  }`}
                  aria-hidden
                />
                <span className="flex-1">
                  <span className="text-slate-400 mr-1">{f.kind}</span>
                  <span className="font-medium tabular-nums">{f.words}w</span>{" "}
                  <span className="text-slate-600">{truncate(f.text, 110)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {body && flagged.length === 0 && (
        <div className="mt-2 text-xs text-slate-500">
          No long sentences or paragraphs flagged.
        </div>
      )}
    </div>
  );
}

function ScoreTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | null;
  hint?: string;
}) {
  // null means "couldn't compute" (Claude failure). Render an obvious "n/a"
  // rather than a red 0 that misrepresents the content.
  if (value === null) {
    return (
      <div
        className="rounded-lg border border-dashed border-slate-300 p-3 bg-slate-50/60"
        title={hint ? `${hint} — couldn't compute, re-run analysis` : "Couldn't compute — re-run analysis"}
      >
        <div className="text-2xl font-bold text-slate-400">n/a</div>
        <div className="text-xs text-slate-500 mt-1">{label}</div>
        <div className="text-[10px] text-slate-400 mt-2 italic">
          re-run analysis
        </div>
      </div>
    );
  }
  const tone = value >= 70 ? "emerald" : value >= 40 ? "amber" : "red";
  const color = tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-red-700";
  return (
    <div className="rounded-lg border border-slate-200 p-3" title={hint}>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
      <div className="mt-2"><DashBar pct={value} tone={tone === "emerald" ? "self" : "blue"} /></div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}

type ComplianceViolationView = {
  rule: string;
  severity: "high" | "medium" | "low";
  excerpt: string;
  reason: string;
  fix: string;
};

/**
 * Attorney-advertising compliance detail. Advisory — it never blocks
 * publishing; it surfaces the status, the rule violations, and the disclaimers
 * the firm needs to add before this content goes out.
 */
function CompliancePanel({
  status,
  summary,
  violations,
  requiredDisclaimers,
}: {
  status: "compliant" | "needs_changes" | "non_compliant" | null;
  summary: string;
  violations: ComplianceViolationView[];
  requiredDisclaimers: string[];
}) {
  const statusMeta: Record<
    "compliant" | "needs_changes" | "non_compliant",
    { label: string; cls: string }
  > = {
    compliant: { label: "Compliant", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    needs_changes: { label: "Needs changes", cls: "bg-amber-50 text-amber-800 border-amber-200" },
    non_compliant: { label: "Non-compliant", cls: "bg-red-50 text-red-700 border-red-200" },
  };
  const sevCls: Record<"high" | "medium" | "low", string> = {
    high: "bg-red-100 text-red-700",
    medium: "bg-amber-100 text-amber-800",
    low: "bg-slate-100 text-slate-600",
  };
  const meta = status ? statusMeta[status] : null;

  return (
    <div className="mt-4 rounded-lg border border-slate-200 p-4">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span aria-hidden>⚖</span>
        <div className="text-sm font-medium">Attorney-advertising compliance</div>
        {meta && (
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${meta.cls}`}>
            {meta.label}
          </span>
        )}
        <span className="text-[10px] text-slate-400 italic ml-auto">
          advisory — review before publishing
        </span>
      </div>
      {summary && <p className="text-xs text-slate-600 mb-3">{summary}</p>}

      {requiredDisclaimers.length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-medium text-slate-700 mb-1.5">
            Required disclaimers
          </div>
          <div className="flex flex-wrap gap-1.5">
            {requiredDisclaimers.map((d, i) => (
              <span
                key={i}
                className="text-[11px] px-2 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-800"
              >
                {d}
              </span>
            ))}
          </div>
        </div>
      )}

      {violations.length > 0 ? (
        <ul className="space-y-2">
          {violations.map((v, i) => (
            <li key={i} className="rounded border border-slate-200 p-2.5 text-xs">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${sevCls[v.severity]}`}>
                  {v.severity}
                </span>
                <span className="font-medium text-slate-700">{v.rule}</span>
              </div>
              {v.excerpt && (
                <div className="text-slate-500 italic mb-1">“{v.excerpt}”</div>
              )}
              <div className="text-slate-600">{v.reason}</div>
              {v.fix && (
                <div className="mt-1 text-emerald-700">
                  <span className="font-medium">Fix:</span> {v.fix}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-xs text-slate-500">
          No specific violations flagged{requiredDisclaimers.length > 0 ? " — add the disclaimers above." : "."}
        </div>
      )}
    </div>
  );
}

function CashPillar({
  label,
  letter,
  value,
}: {
  label: string;
  letter: string;
  value: number;
}) {
  const tone =
    value >= 70
      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
      : value >= 40
        ? "border-amber-300 bg-amber-50 text-amber-700"
        : "border-red-300 bg-red-50 text-red-700";
  return (
    <div className={`rounded-md border px-2 py-1.5 ${tone}`}>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-xs font-bold">{letter}</span>
        <span className="text-base font-semibold tabular-nums">{value}</span>
      </div>
      <div className="text-[10px] opacity-80">{label}</div>
    </div>
  );
}
