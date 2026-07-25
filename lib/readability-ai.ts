/**
 * AI-assisted readability rules (08, 11, 12, 13, 14) — the judgment calls the
 * deterministic engine can't make (vague-vs-specific, extractable H2 answers,
 * cited authority, question headings, structural elements). Evaluated by Claude
 * and folded into scoreReadabilityRules via aiFindings + evaluatedAiRuleIds.
 *
 * Degrades to "not evaluated" (empty result) on any error, so a flaky model call
 * never fails the whole analysis — the score simply covers the deterministic
 * rules until the next run.
 */

import { extractJSON, getAnthropic, KEYWORD_RESEARCH_MODEL } from "./anthropic";
import { rule, type ReadabilityFinding, type RuleId } from "./readability-rules";

export const AI_RULE_IDS: RuleId[] = ["08", "11", "12", "13", "14"];

const SYSTEM =
  "You are a legal-content editor checking a draft against five specific KM " +
  "readability/SEO rules. Judge only these rules. Report only clear violations, " +
  "each with a short verbatim excerpt copied from the draft — never invent text.";

function buildPrompt(body: string): string {
  return `Check the draft against these five rules and return the violations.

Rule 08 — Vague instead of specific: a sentence relies on a vague quantifier or claim ("significant", "many", "substantial", "a number of", "various") where a specific fact or number belongs.
Rule 11 — H2 answer: an H2 section whose FIRST sentence is not a direct, factual, extractable answer to that heading.
Rule 12 — Uncited legal claim: a legal assertion (a right, deadline, threshold, or obligation) stated without naming the statute, regulation, agency, or case.
Rule 13 — H2 as question: an H2 heading that is not phrased as a question the section then answers directly.
Rule 14 — Structure: the draft lacks extractable structure (no FAQ, no lists, no one-sentence definitions). Report at most once; use excerpt "(document-level)".

Return JSON only:
{ "findings": [ { "rule": "08"|"11"|"12"|"13"|"14", "excerpt": "<verbatim, <=120 chars>", "note": "<why, <=120 chars>" } ] }
Only real violations — if a rule is satisfied throughout, omit it. Max 12 findings.

===== DRAFT =====
${body.slice(0, 8000)}`;
}

type RawFinding = { rule?: string; excerpt?: string; note?: string };

export async function evaluateAiReadabilityRules(
  body: string,
): Promise<{ findings: ReadabilityFinding[]; evaluatedRuleIds: RuleId[] }> {
  if (!body?.trim() || !process.env.ANTHROPIC_API_KEY?.trim()) {
    return { findings: [], evaluatedRuleIds: [] };
  }
  try {
    const resp = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      messages: [{ role: "user", content: buildPrompt(body) }],
    });
    const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
    const parsed = extractJSON<{ findings?: RawFinding[] }>(text);
    const findings: ReadabilityFinding[] = [];
    const seen = new Set<string>();
    for (const f of parsed.findings ?? []) {
      const id = String(f.rule ?? "").trim().padStart(2, "0") as RuleId;
      if (!AI_RULE_IDS.includes(id)) continue;
      const excerpt = (f.excerpt ?? "").slice(0, 120).trim() || "(document-level)";
      const key = `${id}::${excerpt.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        ruleId: id,
        rule: rule(id).description,
        fix: rule(id).fix,
        excerpt,
        detail: f.note ? f.note.slice(0, 120).trim() : undefined,
      });
    }
    // Rules were evaluated even if clean, so they count toward the score.
    return { findings, evaluatedRuleIds: [...AI_RULE_IDS] };
  } catch {
    return { findings: [], evaluatedRuleIds: [] };
  }
}
