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
import {
  COMMON_FAILURE_MODES,
  loadComplianceRuleBlocks,
  SCORE_GUIDE,
  type BaseComplianceResult,
  type Jurisdiction,
} from "@/lib/compliance-core";

export type { Jurisdiction, ComplianceViolation } from "@/lib/compliance-core";

export type CompliancePlatform =
  | "google_search"
  | "google_lsa"
  | "microsoft"
  | "meta"
  | "linkedin"
  | "youtube"
  | "tiktok"
  | "other";

// Ad copy gets an extra `rewrites` field (compliant headline/description/body
// suggestions) on top of the shared compliance result.
export interface ComplianceResult extends BaseComplianceResult {
  rewrites: { headline?: string; description?: string; body?: string }[];
}

function buildSystemPrompt(rulesBlock: string, disclaimersBlock: string): string {
  return `You are an expert in U.S. attorney advertising compliance, reviewing ad copy for a plaintiff-side law firm.

You apply the following jurisdiction-specific rules:

${rulesBlock}
${disclaimersBlock}
${COMMON_FAILURE_MODES}

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

${SCORE_GUIDE}`;
}

export async function checkAdCompliance(input: {
  copy: string;
  platform?: CompliancePlatform | string;
  jurisdiction?: Jurisdiction;
  practiceArea?: string;
  format?: string;
}): Promise<ComplianceResult> {
  const jurisdiction = input.jurisdiction ?? "NY,NJ";
  const platform = input.platform ?? "google_search";

  const { rulesBlock, disclaimersBlock } =
    await loadComplianceRuleBlocks(jurisdiction);
  const systemPrompt = buildSystemPrompt(rulesBlock, disclaimersBlock);

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
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "";

  return extractJSON<ComplianceResult>(text);
}
