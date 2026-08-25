/**
 * Findings as objects with a life, instead of strings that vanish.
 *
 * Every check the system runs produced a `string[]` on `content_analyses` —
 * regenerated wholesale each time it ran. Nothing had an identity, so nothing
 * could carry a state: you could not mark a finding resolved, could not tell
 * a new problem from one that had been sitting there for a week, and a re-run
 * silently replaced the list. That is the mechanism behind the FMLA post, where
 * a memo listing seven issues existed while the draft it described was edited
 * and approved separately, and ten days later was unchanged.
 *
 * A finding now has a stable fingerprint, a status, and a resolution record.
 * Re-running the checks RE-LINKS to the existing rows rather than replacing
 * them, so a reviewer's decisions survive regeneration.
 *
 * This module is pure — no database, no IO — so the reconciliation rules that
 * decide what happens to a reviewer's work are unit-testable on their own.
 */

import type { ComplianceViolation } from "./compliance-core";
import type { ClassifiedFreshnessFlag } from "./freshness-classify";

/** Which check produced this. `legal` is reserved for the accuracy feature. */
export type FindingSource =
  | "readability"
  | "seo"
  | "aeo"
  | "cash"
  | "brand_voice"
  | "linkability"
  | "compliance"
  | "freshness"
  | "structure"
  | "legal";

/**
 * How much this finding matters.
 *
 * `critical` is reserved for things that already block an approval through
 * their own gate (a compliance violation, an outdated statutory figure). The
 * severity here describes the finding; it does not create a second gate.
 */
export type FindingSeverity = "critical" | "important" | "advisory";

export type FindingStatus = "open" | "in_progress" | "resolved" | "dismissed";

export const FINDING_STATUSES: readonly FindingStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "dismissed",
] as const;

export function isFindingStatus(v: unknown): v is FindingStatus {
  return typeof v === "string" && (FINDING_STATUSES as readonly string[]).includes(v);
}

/** A finding as produced by a check, before it meets the database. */
export type NormalizedFinding = {
  fingerprint: string;
  source: FindingSource;
  ruleId: string | null;
  severity: FindingSeverity;
  title: string;
  detail: string | null;
  excerpt: string | null;
  fix: string | null;
};

/** A finding as stored, with the parts only the database knows. */
export type StoredFinding = NormalizedFinding & {
  id: string;
  draftId: string;
  status: FindingStatus;
  resolvedByEmail: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

/**
 * Stable identity for a finding across re-runs.
 *
 * Keyed on the check, the rule, and the text it points at — so the same problem
 * in the same sentence is the same finding tomorrow, while editing that
 * sentence produces a different one. That is the behavior you want: the old
 * finding is genuinely gone (it auto-resolves) and a fresh one appears only if
 * the rewritten sentence still breaks the rule.
 *
 * Document-level findings ("No H1 in body") have no excerpt and key on their
 * title, which is stable for as long as the check phrases them consistently.
 */
export function fingerprintFinding(
  source: FindingSource,
  ruleId: string | null,
  anchor: string,
): string {
  const normalized = anchor.toLowerCase().replace(/\s+/g, " ").trim();
  return fnv1a64(`${source}|${ruleId ?? ""}|${normalized}`);
}

/**
 * Two independent 32-bit FNV-1a passes, concatenated to 64 bits of hex.
 *
 * Deliberately not node:crypto: this module is imported by the findings panel,
 * a client component, and a `node:crypto` import there breaks the browser
 * bundle. A fingerprint is an identity, not a security boundary — it only has
 * to be stable and collide rarely across the few hundred findings a draft can
 * hold, which 64 bits does comfortably.
 *
 * 32-bit arithmetic rather than BigInt because the project targets below ES2020,
 * where BigInt literals are not available. Two passes with different offset
 * bases give the width without needing them.
 */
function fnv1a64(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Normalizers — one per check, turning its output into findings.
// ---------------------------------------------------------------------------

/** `Rule 04: Passive voice. Rewrite in active voice. "was denied by the employer"` */
const RULE_STRING = /^Rule\s+(\d+):\s*([^.]+)\.\s*(.*?)\s*(?:"([^"]*)")?\s*$/;

/**
 * Findings that arrive as plain strings (readability, SEO, AEO, CASH, brand
 * voice, linkability). Readability strings carry a rule id and an excerpt;
 * the rest are prose, and key on the whole string.
 */
export function normalizeStringFindings(
  source: FindingSource,
  findings: readonly string[],
  severity: FindingSeverity = "advisory",
): NormalizedFinding[] {
  const out: NormalizedFinding[] = [];
  const seen = new Set<string>();
  for (const raw of findings) {
    const text = (raw ?? "").trim();
    if (!text) continue;

    const m = text.match(RULE_STRING);
    const ruleId = m ? m[1] : null;
    const title = m ? m[2].trim() : text;
    const fix = m ? (m[3] || null) : null;
    const excerpt = m ? (m[4] || null) : null;
    // Excerpt is the anchor when there is one — that is what makes the finding
    // survive edits elsewhere in the document.
    const fingerprint = fingerprintFinding(source, ruleId, excerpt ?? title);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    out.push({ fingerprint, source, ruleId, severity, title, detail: null, excerpt, fix });
  }
  return out;
}

/** Attorney-advertising violations. High severity is a real blocker. */
export function normalizeComplianceFindings(
  violations: readonly ComplianceViolation[],
): NormalizedFinding[] {
  const out: NormalizedFinding[] = [];
  const seen = new Set<string>();
  for (const v of violations ?? []) {
    const fingerprint = fingerprintFinding("compliance", v.rule ?? null, v.excerpt || v.reason);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push({
      fingerprint,
      source: "compliance",
      ruleId: v.rule ?? null,
      severity: v.severity === "high" ? "critical" : v.severity === "medium" ? "important" : "advisory",
      title: v.reason,
      detail: v.rule ?? null,
      excerpt: v.excerpt || null,
      fix: v.fix || null,
    });
  }
  return out;
}

/**
 * Time-sensitive figures. `current` ones are not findings — they are the check
 * confirming the draft is right, and recording them would bury the real ones.
 */
export function normalizeFreshnessFindings(
  flags: readonly ClassifiedFreshnessFlag[],
): NormalizedFinding[] {
  const out: NormalizedFinding[] = [];
  const seen = new Set<string>();
  for (const f of flags ?? []) {
    if (f.status === "current") continue;
    const fingerprint = fingerprintFinding("freshness", f.fact_key ?? null, `${f.match}|${f.sentence}`);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push({
      fingerprint,
      source: "freshness",
      ruleId: f.fact_key ?? null,
      // An outdated figure is a wrong number in publishable content. "Verify"
      // needs a human but is not yet known to be wrong.
      severity: f.status === "outdated" ? "critical" : "important",
      title:
        f.status === "outdated"
          ? `Outdated figure: ${f.match}${f.current_label ? ` (${f.current_label})` : ""}`
          : `Verify figure: ${f.match}`,
      detail: f.reason ?? null,
      excerpt: f.sentence || f.match,
      fix: f.suggested_value ? `Current value: ${f.suggested_value}` : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reconciliation — what happens to a reviewer's work when checks re-run.
// ---------------------------------------------------------------------------

export type Reconciliation = {
  /** Findings seen for the first time. */
  insert: NormalizedFinding[];
  /** Still present; refresh last-seen and any changed wording. */
  touch: { id: string; finding: NormalizedFinding }[];
  /**
   * Marked resolved, but the check still finds them. Resolving something that
   * was never fixed is exactly the failure this table exists to catch, so these
   * go back to open rather than staying quietly closed.
   */
  reopen: { id: string; finding: NormalizedFinding }[];
  /** Open findings the checks no longer produce — the problem is gone. */
  autoResolve: StoredFinding[];
};

/**
 * Merge a fresh set of findings into what is already recorded.
 *
 * The rules, and why:
 *
 *   - unchanged findings keep their id AND their status, so "in progress"
 *     survives a re-run and a regenerate does not wipe the board;
 *   - a DISMISSED finding that reappears stays dismissed — a dismissal is a
 *     judgment about the finding itself, and re-raising it every run would
 *     train people to ignore the list;
 *   - a RESOLVED finding that reappears re-opens, because the opposite claim
 *     ("fixed") has been contradicted by the check;
 *   - an open finding that stops appearing auto-resolves, since the text it
 *     pointed at is gone.
 *
 * Nothing is deleted. A finding that disappears is recorded as resolved, so the
 * draft's history still shows it was raised.
 */
export function reconcileFindings(
  existing: readonly StoredFinding[],
  incoming: readonly NormalizedFinding[],
): Reconciliation {
  const byFingerprint = new Map(existing.map((f) => [f.fingerprint, f]));
  const incomingPrints = new Set(incoming.map((f) => f.fingerprint));

  const result: Reconciliation = { insert: [], touch: [], reopen: [], autoResolve: [] };

  for (const finding of incoming) {
    const prior = byFingerprint.get(finding.fingerprint);
    if (!prior) {
      result.insert.push(finding);
    } else if (prior.status === "resolved") {
      result.reopen.push({ id: prior.id, finding });
    } else {
      result.touch.push({ id: prior.id, finding });
    }
  }

  for (const prior of existing) {
    if (incomingPrints.has(prior.fingerprint)) continue;
    if (prior.status === "open" || prior.status === "in_progress") {
      result.autoResolve.push(prior);
    }
  }

  return result;
}

/** Findings that still need someone. Used for the counts the drawer shows. */
export function openFindings(findings: readonly StoredFinding[]): StoredFinding[] {
  return findings.filter((f) => f.status === "open" || f.status === "in_progress");
}

export function countBySeverity(
  findings: readonly StoredFinding[],
): Record<FindingSeverity, number> {
  const counts: Record<FindingSeverity, number> = { critical: 0, important: 0, advisory: 0 };
  for (const f of openFindings(findings)) counts[f.severity] += 1;
  return counts;
}

export const SOURCE_LABEL: Record<FindingSource, string> = {
  readability: "Readability",
  seo: "SEO",
  aeo: "AEO",
  cash: "CASH",
  brand_voice: "Brand voice",
  linkability: "Linkability",
  compliance: "Compliance",
  freshness: "Content freshness",
  structure: "Structure",
  legal: "Legal accuracy",
};
