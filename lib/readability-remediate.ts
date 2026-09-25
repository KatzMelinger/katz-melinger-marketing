/**
 * The readability self-correction loop, shared.
 *
 * A generator that writes a dense draft can usually fix it if asked, and asking
 * costs one more call rather than a reviewer's afternoon. This is Diana's
 * "apply automatically, do not make it a task list" (item 3, 21 September) done
 * at the point the draft is written, before anyone has read it.
 *
 * WHY THIS IS NOT A DETERMINISTIC SENTENCE SPLITTER
 *
 * Breaking a long PARAGRAPH is mechanical — see autoBreakLongParagraphs, which
 * inserts a break at a sentence boundary and changes no words. Splitting a long
 * SENTENCE is not: in legal copy the qualifiers carry the meaning, and "an
 * employee who works more than 40 hours in a week, unless exempt, must be paid
 * overtime" split carelessly drops the exemption and states something false.
 * That is why the rewrite goes through the model with the protected-terms rule
 * attached, and why a pass is only kept when it measurably improves.
 *
 * WHY IT IS SAFE TO RUN UNATTENDED
 *
 * A candidate replaces the draft only when its readability score is strictly
 * better AND an optional structural guard still passes, so a rewrite that
 * improves prose by dismantling the required section structure is discarded.
 * Anything else — an API error, an empty response, no improvement — leaves the
 * original untouched and stops. The loop can make a draft better or leave it
 * alone; it has no path to making it worse.
 *
 * Lifted verbatim in behaviour from app/api/content/km-draft/route.ts, which
 * has run this loop in production since the rules engine shipped. It lived
 * there and in update-draft only, so the two paths that generate most of the
 * library — app/api/content/draft/route.ts and lib/content-multiformat.ts —
 * never self-corrected at all.
 */

import { CONTENT_LONG_FORM_MODEL, getAnthropic, cachedSystemPrompt } from "./anthropic";
import { stripEmDashes } from "./sanitize-content";
import {
  readabilityForGenerator,
  readabilityPromptBlock,
  type ReadabilityContentType,
} from "./readability-rules";

export type RemediateArgs = {
  body: string;
  contentType: ReadabilityContentType;
  /** Whether the KM rules engine is on (callers pass the flag; this stays pure). */
  useRules: boolean;
  /** System prompt for the rewrite — the tenant's brand voice, normally. */
  system?: string;
  model?: string;
  maxTokens?: number;
  /** Cap on rewrite passes. Two is what the KM wizard has always used. */
  maxPasses?: number;
  /**
   * Optional structural guard. Return false for a candidate that breaks
   * something the prose score cannot see — a missing required section, say.
   * A candidate failing this is discarded even when it reads better.
   */
  accept?: (candidate: string) => boolean;
};

export type RemediateResult = {
  body: string;
  /** Passes actually taken. 0 means the draft already read well enough. */
  passes: number;
  /** Readability score before and after, for logging. */
  scoreBefore: number;
  scoreAfter: number;
};

export async function remediateReadability(args: RemediateArgs): Promise<RemediateResult> {
  const { body, contentType, useRules } = args;
  const maxPasses = args.maxPasses ?? 2;
  let text = body;
  let signal = readabilityForGenerator(text, contentType, useRules);
  const scoreBefore = signal.score;
  let passes = 0;

  if (!text?.trim()) return { body, passes: 0, scoreBefore, scoreAfter: scoreBefore };

  while (signal.needsWork && passes < maxPasses) {
    passes++;
    try {
      const prompt =
        `Rewrite the article below to improve readability WITHOUT changing its meaning, facts, ` +
        `headings, structure, or internal links.\n\n` +
        `${readabilityPromptBlock(contentType, useRules)}\n\n` +
        `Keep every heading (#, ##, ###) exactly as-is, keep all citations, statutes, and figures, ` +
        `and keep the protected legal terms verbatim. Split long sentences and convert passive voice ` +
        `to active.\n\nReturn the COMPLETE rewritten article in Markdown, nothing else.\n\n` +
        `===== ARTICLE =====\n${text}`;
      const res = await getAnthropic().messages.create({
        model: args.model ?? CONTENT_LONG_FORM_MODEL,
        max_tokens: args.maxTokens ?? 8192,
        ...(args.system ? { system: cachedSystemPrompt(args.system) } : {}),
        messages: [{ role: "user", content: prompt }],
      });
      const block = res.content.find((b) => b.type === "text");
      const candidate = block && block.type === "text" ? stripEmDashes(block.text) : "";
      if (!candidate.trim()) break;

      const candidateSignal = readabilityForGenerator(candidate, contentType, useRules);
      // Strictly better, and structurally acceptable if the caller cares.
      if (candidateSignal.score <= signal.score) break;
      if (args.accept && !args.accept(candidate)) break;

      text = candidate;
      signal = candidateSignal;
    } catch {
      // A failed rewrite is not a failed draft. Keep what we have.
      break;
    }
  }

  return { body: text, passes, scoreBefore, scoreAfter: signal.score };
}
