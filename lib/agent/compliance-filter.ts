/**
 * Attorney-advertising compliance HARD GATE for the autonomous content agent.
 *
 * This is the load-bearing guardrail. Where `checkContentCompliance`
 * (lib/content-compliance.ts) is ADVISORY — it returns a score for a human to
 * weigh — this wrapper turns that score into a binary PASS/HOLD verdict the
 * orchestrator branches on. An item that does not PASS is held at
 * `needs_legal` and can never reach the human approval inbox on its own.
 *
 * Gate policy (must satisfy ALL):
 *   - status === "compliant"
 *   - score >= minScore (default 80)
 *   - zero high-severity violations
 *
 * Anything weaker (needs_changes / non_compliant / any high-severity finding)
 * fails closed. The agent is allowed to be wrong here only in the safe
 * direction — holding a borderline-fine draft for a human is acceptable;
 * letting a non-compliant one through is not.
 */

import {
  checkContentCompliance,
  type ContentSurface,
} from "@/lib/content-compliance";
import type { ComplianceViolation } from "@/lib/compliance-core";
import type { FormatKey } from "@/lib/content-multiformat";

/** The default minimum compliance score required to pass the gate. */
export const DEFAULT_GATE_MIN_SCORE = 80;

export type ComplianceVerdict = {
  /** false ⇒ the item is HELD at needs_legal and never auto-surfaced. */
  pass: boolean;
  status: "compliant" | "needs_changes" | "non_compliant";
  score: number;
  violations: ComplianceViolation[];
  highSeverityCount: number;
  requiredDisclaimers: string[];
  /** A compliant rewrite the human reviewer can adopt (empty if clean). */
  suggestedRewrite: string;
  surface: ContentSurface;
  minScore: number;
};

/**
 * Run the compliance hard gate on a single piece of agent-produced content.
 * Always resolves (never throws on a normal compliance "fail" — that is a
 * verdict, not an error); a thrown error here means the check itself broke and
 * the caller should treat the item as held out of caution.
 */
export async function runComplianceGate(args: {
  content: string;
  surface: ContentSurface;
  practiceArea?: string;
  jurisdiction?: string;
  minScore?: number;
}): Promise<ComplianceVerdict> {
  const minScore = args.minScore ?? DEFAULT_GATE_MIN_SCORE;

  const result = await checkContentCompliance({
    content: args.content,
    surface: args.surface,
    practiceArea: args.practiceArea,
    jurisdiction: args.jurisdiction,
  });

  const highSeverityCount = result.violations.filter(
    (v) => v.severity === "high",
  ).length;

  const pass =
    result.status === "compliant" &&
    result.score >= minScore &&
    highSeverityCount === 0;

  return {
    pass,
    status: result.status,
    score: result.score,
    violations: result.violations,
    highSeverityCount,
    requiredDisclaimers: result.requiredDisclaimers,
    suggestedRewrite: result.suggestedRewrite,
    surface: args.surface,
    minScore,
  };
}

/**
 * Map a generated content format to the compliance surface whose obligations
 * apply (the "Attorney Advertising" label rules differ by surface). All of the
 * firm-owned long-form formats are reviewed as a `blog`; social formats as
 * `social`; email as `email`.
 */
export function surfaceForFormat(format: FormatKey | string): ContentSurface {
  switch (format) {
    case "blog":
    case "podcast":
    case "video_short":
    case "video_long":
      return "blog";
    case "email":
      return "email";
    case "linkedin":
    case "twitter":
    case "facebook":
    case "instagram":
      return "social";
    default:
      return "other";
  }
}
