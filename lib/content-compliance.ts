/**
 * Attorney-advertising compliance check for ALL outbound content — not just
 * ads. Blog posts, emails, social posts, GBP review replies, and community/
 * forum responses all run through this before they go out.
 *
 * It shares the exact same NY/NJ (+ seeded) rule set and disclaimer library as
 * the ad checker (lib/compliance-core.ts), so a rule the firm cares about is
 * enforced identically everywhere. The result is ADVISORY — it returns a score,
 * violations, warnings, and the disclaimers that must be added; it never blocks
 * publishing. Surfaces display it so the human reviewer catches issues.
 *
 * `surface` matters: the "Attorney Advertising" label and the "this is not
 * legal advice" disclaimer apply differently to a firm-owned blog post than to
 * a reply left on someone else's Reddit thread.
 */

import {
  KEYWORD_RESEARCH_MODEL,
  extractJSON,
  getAnthropic,
} from "@/lib/anthropic";
import {
  COMMON_FAILURE_MODES,
  loadComplianceRuleBlocks,
  normalizeComplianceResult,
  SCORE_GUIDE,
  type BaseComplianceResult,
  type Jurisdiction,
} from "@/lib/compliance-core";

export type ContentSurface =
  | "blog"
  | "webpage"
  | "email"
  | "social"
  | "gbp_reply"
  | "community_reply"
  | "other";

/** Outbound-content result: the shared fields plus one rewritten version. */
export interface ContentComplianceResult extends BaseComplianceResult {
  /** A compliant rewrite of the content (empty string if already clean). */
  suggestedRewrite: string;
}

/** Human label + surface-specific obligations injected into the prompt. */
const SURFACE_GUIDANCE: Record<ContentSurface, { label: string; notes: string }> = {
  blog: {
    label: "blog post / article on the firm's own website",
    notes:
      "Firm-owned advertising. The 'Attorney Advertising' label requirement applies to the page. Any case results, dollar figures, or client outcomes require a prior-results disclaimer. Educational legal content should make clear it is general information, not legal advice.",
  },
  webpage: {
    label: "page on the firm's own website",
    notes:
      "Firm-owned advertising. 'Attorney Advertising' label applies. Case results need a prior-results disclaimer; superlatives and specialist/expert claims are prohibited.",
  },
  email: {
    label: "marketing email / newsletter sent by the firm",
    notes:
      "A solicitation under RPC 7.3 in many cases. The 'Attorney Advertising' label / equivalent disclosure applies. Avoid result guarantees and superlatives; testimonials need a 'results vary' disclaimer.",
  },
  social: {
    label: "social media post published by the firm",
    notes:
      "Firm advertising. 'Attorney Advertising' disclosure applies (a hashtag like #AttorneyAdvertising is acceptable). Keep it short but no superlatives, no guarantees, and disclaim any case results.",
  },
  gbp_reply: {
    label: "public reply to a Google review",
    notes:
      "NOT a firm ad, but public. Never confirm, deny, or imply that the reviewer is or was a client. No legal commitments or outcome promises. Do not disclose case facts. The 'Attorney Advertising' label does NOT apply here — do not flag its absence.",
  },
  community_reply: {
    label: "reply on a third-party forum (Reddit, Quora, Avvo, YouTube)",
    notes:
      "NOT a firm ad and usually NOT on a firm-owned surface — do NOT flag a missing 'Attorney Advertising' label. The real risks: giving content that reads as specific legal advice without a 'general information, not legal advice' disclaimer, creating an attorney-client relationship, and improper solicitation (RPC 7.3). Superlatives and guarantees are still prohibited.",
  },
  other: {
    label: "outbound firm content",
    notes:
      "Apply the general attorney-advertising rules. Avoid superlatives and guarantees; disclaim case results and legal advice as appropriate.",
  },
};

function buildSystemPrompt(
  surface: ContentSurface,
  rulesBlock: string,
  disclaimersBlock: string,
): string {
  const g = SURFACE_GUIDANCE[surface] ?? SURFACE_GUIDANCE.other;
  return `You are an expert in U.S. attorney advertising compliance, reviewing OUTBOUND CONTENT for a plaintiff-side employment law firm before it is published.

The content being reviewed is a ${g.label}.
Surface-specific obligations:
${g.notes}

You apply the following jurisdiction-specific rules:

${rulesBlock}
${disclaimersBlock}
${COMMON_FAILURE_MODES}

LOW-SEVERITY ISSUES (warnings, not violations):
- Aggressive or salesy language that may damage firm reputation
- Vague phrases that hurt clarity
- Tone mismatch with the firm's brand voice (professional but approachable)

Only flag obligations that actually apply to THIS surface (see above) — e.g. do not demand an "Attorney Advertising" label on a reply posted to someone else's forum thread.

You return JSON with this exact shape:
{
  "score": 0-100,
  "status": "compliant" | "needs_changes" | "non_compliant",
  "violations": [
    { "rule": "...", "severity": "high|medium|low", "excerpt": "...", "reason": "...", "fix": "..." }
  ],
  "warnings": ["..."],
  "requiredDisclaimers": ["Attorney Advertising", "Prior results do not guarantee a similar outcome.", ...],
  "suggestedRewrite": "A fully compliant rewrite of the content with required disclaimers worked in. Empty string if the content is already compliant.",
  "summary": "2-3 sentence executive summary"
}

${SCORE_GUIDE}`;
}

/**
 * Run an attorney-advertising compliance review on a piece of outbound content.
 * Advisory: returns a scored result for the reviewer; it does not block.
 */
export async function checkContentCompliance(input: {
  content: string;
  surface: ContentSurface;
  practiceArea?: string;
  jurisdiction?: Jurisdiction;
}): Promise<ContentComplianceResult> {
  const content = input.content.trim();
  if (!content) {
    return {
      score: 100,
      status: "compliant",
      violations: [],
      warnings: [],
      requiredDisclaimers: [],
      suggestedRewrite: "",
      summary: "No content to review.",
    };
  }

  const jurisdiction = input.jurisdiction ?? "NY,NJ";
  const { rulesBlock, disclaimersBlock } =
    await loadComplianceRuleBlocks(jurisdiction);
  const systemPrompt = buildSystemPrompt(
    input.surface,
    rulesBlock,
    disclaimersBlock,
  );

  // Long-form content (blogs) can run past a few thousand words; cap what we
  // send so the review stays fast and within token limits while still seeing
  // the whole intro/CTA where most violations live.
  const truncated =
    content.length > 12000 ? content.slice(0, 12000) + "\n…[truncated]" : content;

  const userPrompt = `Review the following ${SURFACE_GUIDANCE[input.surface]?.label ?? "content"} for attorney-advertising compliance.

Jurisdiction(s): ${jurisdiction}
Practice area: ${input.practiceArea ?? "Employment law (general)"}

CONTENT:
"""
${truncated}
"""

Return ONLY the JSON object — no preamble, no markdown fences. Be strict on superlatives and result guarantees. If the content is clean, return a high score and an empty violations array — but still surface any required disclaimers.`;

  const response = await getAnthropic().messages.create({
    model: KEYWORD_RESEARCH_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "";

  const raw = extractJSON<Partial<ContentComplianceResult>>(text);
  const base = normalizeComplianceResult(raw);
  return {
    ...base,
    suggestedRewrite:
      typeof raw?.suggestedRewrite === "string" ? raw.suggestedRewrite : "",
  };
}
