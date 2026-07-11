/**
 * Fast, deterministic brand + attorney-advertising checks for the social
 * composer's approval gate. Pure and client-safe (no server imports), so the
 * composer can flag a variation live as it's edited and block scheduling until
 * it's cleared — the "brand or compliance flag" the spec requires.
 *
 * This is the cheap, always-on floor. It encodes the same failure modes the
 * LLM compliance reviewer (lib/compliance-core.ts) enforces on publish, plus
 * the Katz Melinger brand rules (no dashes, no fear-based urgency, no fee
 * language, New York / New Jersey spelled out). It is intentionally strict on
 * high-confidence patterns and silent on judgment calls, so a block is almost
 * always a real problem.
 */

export type FlagSeverity = "block" | "warn";

export type ComplianceFlag = {
  code: string;
  label: string;
  severity: FlagSeverity;
  /** The offending text, for display. */
  excerpt: string;
};

type Rule = { code: string; label: string; severity: FlagSeverity; re: RegExp };

// Order matters only for display. Each `re` has a capture/target used as the
// excerpt. All case-insensitive unless the pattern is inherently cased.
const RULES: Rule[] = [
  {
    code: "dash",
    label: "Em or en dash — brand rule is no dashes",
    severity: "block",
    re: /[‒–—―]|\s--\s/,
  },
  {
    code: "guarantee",
    label: "Result guarantee — prohibited (RPC 7.1)",
    severity: "block",
    re: /\b(guarantee(d|s)?|we('| wi)ll win|no win,?\s*no fee|100%\s*(win|success|recovery))\b/i,
  },
  {
    code: "superlative",
    label: "Superlative or specialist claim — prohibited (RPC 7.1 / 7.4)",
    severity: "block",
    // `#1` is pulled out of the \b group (a leading \b can't match before '#').
    // "expert"/"specialist" are only flagged as a self-claim ("we are experts",
    // "specializing in …"), not in legitimate terms like "expert witness".
    re: /#\s?1\b|\bnumber one\b|\btop[-\s]rated\b|\bbest (lawyer|attorney|law firm|firm)\b|\bleading (law )?firm\b|\bpremier (law )?firm\b|\bwinningest\b|\bmost experienced (lawyer|attorney|firm)\b|\b(we are|we're|our)( the)? (experts?|specialists?)\b|\bspecializ(e|es|ing) in\b/i,
  },
  {
    code: "fear",
    label: "Fear-based urgency — off-brand",
    severity: "block",
    re: /\b(act now|limited time|don'?t wait|before it'?s too late|time is running out|hurry|urgent(ly)?)\b/i,
  },
  {
    code: "fee",
    label: "Fee or price language — off-brand",
    severity: "block",
    re: /\bfree consultation\b|\bno fee\b|\bcontingency\b|\$\s?\d/i,
  },
  {
    code: "state_abbrev",
    label: "Spell out New York / New Jersey",
    severity: "block",
    re: /\b(N\.?Y\.?C?|N\.?J\.?)\b/i,
  },
];

/** Run every rule over a body and return the flags that fired. */
export function checkSocialCompliance(text: string): ComplianceFlag[] {
  const body = text ?? "";
  const flags: ComplianceFlag[] = [];
  for (const r of RULES) {
    const m = body.match(r.re);
    if (m) {
      flags.push({
        code: r.code,
        label: r.label,
        severity: r.severity,
        excerpt: (m[0] ?? "").trim().slice(0, 40),
      });
    }
  }
  return flags;
}

/** True if any blocking flag is present — the post cannot be scheduled. */
export function hasBlockingFlag(text: string): boolean {
  return checkSocialCompliance(text).some((f) => f.severity === "block");
}
