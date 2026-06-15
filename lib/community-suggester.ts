/**
 * Generates suggested responses to community posts (Reddit / Quora / Avvo)
 * using Claude + firm voice context.
 *
 * Each platform has its own posting etiquette baked into the system prompt:
 *
 *   - Reddit: helpful, never self-promotional; frame as "what an employment
 *     lawyer would say" rather than "hire us."
 *   - Quora: expert tone, demonstrate domain knowledge, light on personal
 *     promotion. Long-form OK.
 *   - Avvo: attorney-style, formal, mention the importance of speaking with a
 *     local attorney. Mention NY/NJ jurisdiction explicitly when relevant.
 */

import { getAnthropic, KEYWORD_RESEARCH_MODEL } from "./anthropic";
import {
  checkContentCompliance,
  type ContentComplianceResult,
} from "./content-compliance";
import { getFirmContext } from "./firm-context";

export type Platform = "reddit" | "quora" | "avvo" | "youtube";

const ETIQUETTE: Record<Platform, string> = {
  reddit: `Reddit etiquette:
- DO NOT promote the firm or include a CTA to hire anyone. Reddit has strong anti-promotion rules and self-promotion will get you downvoted and banned.
- Write as a knowledgeable redditor, not as a marketer. Use "you might want to" not "we recommend."
- Cite specific legal concepts (FLSA, NYLL, NYSHRL, FMLA, etc) where they apply.
- Suggest documenting evidence, knowing time limits, and consulting *an* employment attorney (not specifically Katz Melinger) for case-specific advice.
- Use markdown lists when you have 3+ steps. Keep paragraphs short.`,
  youtube: `YouTube comment etiquette:
- Short and direct. 2-4 sentences max. YouTube comments are scanned, not read carefully.
- Lead with the most useful insight or actionable suggestion.
- Cite NY/NJ specifics if relevant (e.g., "in New York, NYLL Section 195…").
- One subtle attribution at the end like "(employment lawyer)" or "(an employment law firm)" is OK — don't push the firm name aggressively.
- Suggest consulting an employment attorney for specifics. No links to the firm site (YouTube hides comments with links).
- Plain text only — no markdown formatting.`,
  quora: `Quora etiquette:
- Expert tone. Demonstrate domain knowledge with specific statutes, case examples, and clear breakdowns.
- Long-form OK (300-700 words). Use H2 / bullet structure if helpful.
- Light promotion is acceptable at the end (one sentence "I work with [firm name]" or similar) but the answer's value should stand alone.
- NY/NJ jurisdiction calls out are valuable since most Quora answers are generic.`,
  avvo: `Avvo etiquette:
- Attorney tone. Formal but accessible.
- Always include the standard disclaimer: this is general information, not legal advice; the user should consult a licensed attorney for their specific situation.
- Mention NY/NJ jurisdiction when relevant.
- Cite the relevant law (e.g., FLSA, NYLL Section 195, NYSHRL, NJLAD).
- Length: 200-400 words is typical for Avvo.`,
};

export type Suggestion = {
  platform: Platform;
  text: string;
  warning: string;
  /** Advisory attorney-advertising compliance review of the suggested text. */
  compliance: ContentComplianceResult | null;
};

const WARNING: Record<Platform, string> = {
  reddit:
    "Review before posting. Reddit's anti-promotion rules are strict — frame as helpful legal information, not advertising.",
  youtube:
    "Review before posting. Keep it short. YouTube hides comments with links and downranks anything pushy.",
  quora:
    "Review before posting. Quora rewards expert depth; one short bio mention is OK at the end but the substance should stand alone.",
  avvo:
    "Review before posting. Always include the standard disclaimer that this is general information, not legal advice for the specific situation.",
};

export async function suggestResponse(args: {
  platform: Platform;
  title: string;
  body?: string;
}): Promise<Suggestion> {
  const firm = await getFirmContext();
  const sys = `You are an employment law attorney drafting a community response. ${firm}

${ETIQUETTE[args.platform]}

Write a suggested response. Output the response text only — no preamble, no "here is your response," no closing notes.`;

  const user = `Question / post:
"""
Title: ${args.title}
${args.body ? `\nBody:\n${args.body}` : ""}
"""

Draft a response that follows the etiquette above for the ${args.platform} platform.`;

  const resp = await getAnthropic().messages.create({
    model: KEYWORD_RESEARCH_MODEL,
    max_tokens: 1500,
    system: sys,
    messages: [{ role: "user", content: user }],
  });
  const text = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "";

  // Advisory compliance pass on the suggested reply. Never let it fail the
  // suggestion — degrade to null (the UI keeps the static etiquette warning).
  const compliance = await checkContentCompliance({
    content: text,
    surface: "community_reply",
  }).catch((err) => {
    console.warn("[community-suggester] Compliance check failed:", err);
    return null;
  });

  return {
    platform: args.platform,
    text,
    warning: WARNING[args.platform],
    compliance,
  };
}
