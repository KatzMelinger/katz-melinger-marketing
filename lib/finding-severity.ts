/**
 * What a finding is allowed to DO — as distinct from how bad it is.
 *
 * The findings table already had a severity (critical / important / advisory),
 * and it was never the question a reviewer needed answered. Eighty-three open
 * findings on one blog, a wrong statute and a passive-voice note rendered
 * identically, and nothing anywhere said which of them stopped the draft
 * publishing. That is Diana's item 12.
 *
 *   blocker      holds publication
 *   recommended  should be addressed, does not hold
 *   optional     a note; never counted, never holds
 *
 * THREE INPUTS, IN THIS ORDER
 *
 *   1. The check's own severity, mapped straight across.
 *   2. An engine ceiling. Three engines can never produce a blocker whatever
 *      they claim — see below.
 *   3. A per-rule override, which wins over both. This is Diana's "editable
 *      table": the defaults live here, and DB rows layer on top of them.
 *
 * WHY THREE ENGINES ARE CAPPED (item 19)
 *
 * CASH, AEO and Readability all aim at the same goal from different angles and
 * duplicate each other constantly — headings-as-questions fires from
 * Readability and AEO, cite-your-sources from AEO, CASH and SEO. Worse, CASH
 * credits a citation for merely existing, which the legal layer may be about to
 * contradict. None of the three is in a position to stop a publication, so the
 * ceiling is structural rather than a judgement about any individual rule.
 *
 * This does NOT make them quiet. They still raise findings, still show in their
 * own tab, still carry `recommended`. They just cannot be the reason a correct
 * draft sits unpublished.
 *
 * Pure module: no IO, so the mapping is unit-testable and the panel (a client
 * component) can import it.
 */

import type { FindingSeverity, FindingSource, StoredFinding } from "./content-findings";

export type PublishSeverity = "blocker" | "recommended" | "optional";

export const PUBLISH_SEVERITY_LABEL: Record<PublishSeverity, string> = {
  blocker: "Blocker",
  recommended: "Recommended",
  optional: "Optional",
};

/** Worst first. Used to pick a group's or an engine's colour. */
export const SEVERITY_RANK: Record<PublishSeverity, number> = {
  blocker: 0,
  recommended: 1,
  optional: 2,
};

/**
 * Diana's default tab order: correctness first, then style.
 *
 * It is not cosmetic. A reviewer who reads top to bottom meets the things that
 * can be WRONG before the things that can be better, and an Apply in a style
 * tab never rewrites a span that is about to change for a legal reason.
 *
 * `structure` is not in her list (she names nine engines, the enum has ten). It
 * sits at the end of the correctness half, next to the other things that are
 * either right or not.
 */
export const ENGINE_ORDER: readonly FindingSource[] = [
  "legal",
  "freshness",
  "compliance",
  "structure",
  "seo",
  "brand_voice",
  "readability",
  "cash",
  "aeo",
  "linkability",
];

/** Engines that may never produce a blocker, however severe they think it is. */
export const CAPPED_ENGINES: ReadonlySet<FindingSource> = new Set<FindingSource>([
  "cash",
  "aeo",
  "readability",
]);

const BASE: Record<FindingSeverity, PublishSeverity> = {
  critical: "blocker",
  important: "recommended",
  advisory: "optional",
};

/** `${source}:${ruleId}` — the key an override is stored under. */
export function severityRuleKey(source: FindingSource, ruleId: string | null): string {
  return `${source}:${ruleId ?? ""}`;
}

/**
 * Per-rule defaults. Diana's "editable table", with the code holding the
 * starting position and `finding_severity_rules` layering the firm's edits on
 * top (lib/finding-severity-store.ts).
 *
 * readability:10 is her item 13. The first-person rule fires on "we can help
 * you" — the firm's own house voice, on every page it has ever published — and
 * it flooded the list. It is not a defect, so it is not counted.
 */
export const DEFAULT_RULE_SEVERITY: Readonly<Record<string, PublishSeverity>> = {
  "readability:10": "optional",
};

export type SeverityOverrides = Readonly<Record<string, PublishSeverity>>;

/**
 * What this finding is allowed to do.
 *
 * The override is applied AFTER the engine cap deliberately: an explicit row
 * saying a particular readability rule is a blocker is a decision someone made
 * on purpose, and the cap is a default, not a prohibition. The cap protects
 * against an engine's own severity, not against the firm's judgement.
 */
export function publishSeverity(
  finding: Pick<StoredFinding, "source" | "ruleId" | "severity">,
  overrides: SeverityOverrides = {},
): PublishSeverity {
  const key = severityRuleKey(finding.source, finding.ruleId);
  const override = overrides[key] ?? DEFAULT_RULE_SEVERITY[key];
  if (override) return override;

  const base = BASE[finding.severity] ?? "optional";
  if (base === "blocker" && CAPPED_ENGINES.has(finding.source)) return "recommended";
  return base;
}

/** Is this finding still outstanding? */
export function isOpen(f: Pick<StoredFinding, "status">): boolean {
  return f.status === "open" || f.status === "in_progress";
}

/**
 * The only number on the panel that decides anything: how many open findings
 * hold publication. Everything else is context.
 */
export function countBlockers(
  findings: readonly StoredFinding[],
  overrides: SeverityOverrides = {},
): number {
  return findings.filter((f) => isOpen(f) && publishSeverity(f, overrides) === "blocker").length;
}

export type EngineSummary = {
  source: FindingSource;
  /** Open findings in this engine, whatever their severity. */
  count: number;
  /** Open blockers — what the readiness line counts. */
  blockers: number;
  /** Worst open severity, or null when the engine has nothing outstanding. */
  worst: PublishSeverity | null;
};

/**
 * One row per engine, in Diana's order — the scorecard.
 *
 * Engines with nothing to say are included with a zero count rather than
 * omitted. A tab strip that changes shape between drafts is one a reviewer has
 * to re-read every time, and "SEO found nothing" is information.
 */
export function summarizeByEngine(
  findings: readonly StoredFinding[],
  overrides: SeverityOverrides = {},
): EngineSummary[] {
  return ENGINE_ORDER.map((source) => {
    const open = findings.filter((f) => f.source === source && isOpen(f));
    let worst: PublishSeverity | null = null;
    let blockers = 0;
    for (const f of open) {
      const sev = publishSeverity(f, overrides);
      if (sev === "blocker") blockers += 1;
      if (worst === null || SEVERITY_RANK[sev] < SEVERITY_RANK[worst]) worst = sev;
    }
    return { source, count: open.length, blockers, worst };
  });
}

export type FindingGroup = {
  /** Stable key for React and for the collapse state. */
  key: string;
  /** What the group is called — the rule, or the finding text when there is no rule. */
  label: string;
  ruleId: string | null;
  severity: PublishSeverity;
  findings: StoredFinding[];
};

/**
 * Group a tab's findings by rule, worst first.
 *
 * Findings with no rule id (the prose ones from SEO, AEO and CASH) group by
 * their own title, which usually means a group of one. That is correct rather
 * than a degenerate case: they ARE one-offs, and forcing them into a shared
 * bucket would invent a rule that does not exist.
 */
export function groupByRule(
  findings: readonly StoredFinding[],
  overrides: SeverityOverrides = {},
): FindingGroup[] {
  const groups = new Map<string, FindingGroup>();

  for (const f of findings) {
    const key = f.ruleId ? `rule:${f.ruleId}` : `text:${f.title}`;
    const severity = publishSeverity(f, overrides);
    const existing = groups.get(key);
    if (existing) {
      existing.findings.push(f);
      // A group is as severe as its worst member — a collapsed group must not
      // hide a blocker behind a calmer colour.
      if (SEVERITY_RANK[severity] < SEVERITY_RANK[existing.severity]) {
        existing.severity = severity;
      }
    } else {
      groups.set(key, {
        key,
        label: f.ruleId ? `Rule ${f.ruleId}: ${f.title}` : f.title,
        ruleId: f.ruleId,
        severity,
        findings: [f],
      });
    }
  }

  return [...groups.values()].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.findings.length - a.findings.length ||
      a.label.localeCompare(b.label),
  );
}
