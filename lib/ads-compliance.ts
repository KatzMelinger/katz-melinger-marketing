/**
 * Ad-copy compliance analyzer for Katz Melinger PLLC.
 *
 * Reviews ad copy against NY (22 NYCRR Part 1200, RPC 7.1-7.5) and NJ (RPC
 * 7.1-7.5) attorney advertising rules. Returns a structured analysis with a
 * 0-100 score, specific violations, required disclaimers, and rewritten copy.
 *
 * The system prompt is deliberately concrete about which rules to apply so
 * the model isn't guessing — these are the violations we see most often in
 * employment-law PPC.
 */

import {
  KEYWORD_RESEARCH_MODEL,
  extractJSON,
  getAnthropic,
} from "@/lib/anthropic";

export type Jurisdiction = "NY" | "NJ" | "NY,NJ";

export type CompliancePlatform =
  | "google_search"
  | "google_lsa"
  | "microsoft"
  | "meta"
  | "linkedin"
  | "youtube"
  | "tiktok"
  | "other";

export interface ComplianceViolation {
  rule: string;          // e.g. "NY 22 NYCRR §1200 RPC 7.1(a)"
  severity: "high" | "medium" | "low";
  excerpt: string;       // the offending text
  reason: string;        // why it's a problem
  fix: string;           // concrete suggested replacement
}

export interface ComplianceResult {
  score: number;         // 0-100
  status: "compliant" | "needs_changes" | "non_compliant";
  violations: ComplianceViolation[];
  warnings: string[];    // soft issues / best practices
  requiredDisclaimers: string[];
  rewrites: { headline?: string; description?: string; body?: string }[];
  summary: string;
}

const SYSTEM_PROMPT = `You are an expert in U.S. attorney advertising compliance, specializing in plaintiff-side employment law marketing in New York and New Jersey.

You review ad copy for Katz Melinger PLLC, a plaintiff-side employment law firm in New York City practicing in NY and NJ. You apply these specific rules:

NEW YORK (22 NYCRR Part 1200 — Rules of Professional Conduct):
- RPC 7.1(a): No false, deceptive, or misleading statements. No comparative claims (e.g. "best lawyer," "#1") that cannot be factually substantiated.
- RPC 7.1(b)(2): Computer-accessed communications (i.e., online ads) must include the words "Attorney Advertising" on the first page or home page, OR the label must be clearly disclosed.
- RPC 7.1(d): If an ad mentions specific case results, it must include a prominent disclaimer that prior results do not guarantee a similar outcome.
- RPC 7.1(e): Endorsements/testimonials require a disclaimer that they are paid (if so) and that results vary.
- RPC 7.4: Cannot claim to be a "specialist" or "expert" unless certified by an ABA-accredited or NYS-recognized organization (and Katz Melinger is not so certified — assume "no").

NEW JERSEY (RPC 7.1-7.5 + Committee on Attorney Advertising Opinions):
- RPC 7.1(a): No false or misleading communication. Same superlative ban as NY.
- RPC 7.1(a)(3): No "predictions of success" or guarantees of results.
- RPC 7.4(a): Cannot use "specialist," "specializing," or "expert" without certification by the NJ Supreme Court or ABA-accredited body.
- Opinion 39: Bona fide office requirement — ads should not imply offices in jurisdictions where the firm has none.

COMMON FAILURE MODES YOU MUST FLAG (high severity):
1. Superlatives or self-aggrandizement: "best," "top," "#1," "leading," "most experienced," "premier," "elite," "winningest"
2. Result guarantees: "we'll win your case," "guaranteed recovery," "we will get you compensation"
3. Specific dollar results without prior-results disclaimer
4. "Specialist" / "expert" / "specializing in" without certification disclosure
5. Testimonials without "results vary" disclaimer
6. Missing "Attorney Advertising" label
7. Implying personal endorsement by judges or government bodies
8. Targeting/promising contact with prospective clients in violation of RPC 7.3 (solicitation rules)

LOW-SEVERITY ISSUES (warnings, not violations):
- Aggressive language that may damage firm reputation
- Vague phrases that hurt clarity
- Missing CTA
- Tone mismatch with firm's brand voice (professional but approachable)

You return JSON with this exact shape:
{
  "score": 0-100,
  "status": "compliant" | "needs_changes" | "non_compliant",
  "violations": [
    { "rule": "...", "severity": "high|medium|low", "excerpt": "...", "reason": "...", "fix": "..." }
  ],
  "warnings": ["..."],
  "requiredDisclaimers": ["Attorney Advertising", "Prior results do not guarantee...", ...],
  "rewrites": [{ "headline": "...", "description": "...", "body": "..." }],
  "summary": "2-3 sentence executive summary"
}

Score guide:
- 90-100: ready to publish, only minor warnings
- 70-89: publishable with the listed disclaimers added
- 40-69: needs material rewrites
- 0-39: non-compliant — must be rewritten before any publication`;

export async function checkAdCompliance(input: {
  copy: string;
  platform?: CompliancePlatform | string;
  jurisdiction?: Jurisdiction;
  practiceArea?: string;
  format?: string;
}): Promise<ComplianceResult> {
  const jurisdiction = input.jurisdiction ?? "NY,NJ";
  const platform = input.platform ?? "google_search";
  const userPrompt = `Review the following ad copy for compliance.

Platform: ${platform}
Format: ${input.format ?? "search"}
Jurisdiction(s): ${jurisdiction}
Practice area: ${input.practiceArea ?? "Employment law (general)"}

AD COPY:
"""
${input.copy.trim()}
"""

Return ONLY the JSON object — no preamble, no markdown fences. Be strict on superlatives and result guarantees. If the copy is clean, return a high score and an empty violations array — but still surface required disclaimers and any warnings.`;

  const response = await getAnthropic().messages.create({
    model: KEYWORD_RESEARCH_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "";

  return extractJSON<ComplianceResult>(text);
}
