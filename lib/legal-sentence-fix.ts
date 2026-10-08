/**
 * Apply fix on one legal flag (Diana's Oct 6 spec, Task 22).
 *
 * Every legal finding gets one of two actions: Apply fix (a corrected
 * sentence, previewed, then logged in "Changes made") or Send to attorney.
 * This module does the Apply fix half:
 *
 *   locateSentence  find the sentence the finding quotes in the stored body
 *   proposeFix      one model call: rewrite ONLY that sentence per the
 *                   finding's note / fix
 *   guardSentence   the fixer guard: the new sentence must not trip any trap
 *                   (the one being fixed included), fee language, an ad term,
 *                   a dash, or a critical knowledge base check. If anything
 *                   fires, the fix is refused and the finding becomes an
 *                   attorney item instead of being "fixed" into a new error.
 *
 * An attorney's own replacement goes through guardSentence too, but only as a
 * warning: the attorney decides.
 */
import { getAnthropic, CONTENT_LONG_FORM_MODEL } from "./anthropic";
import { findFeeLanguage } from "./fee-language";
import { blockingAdHits, findAdTerms } from "./ad-terms";
import { matchTrap, type KnownTrap, type TrapContext } from "./known-traps";
import { quoteText } from "./finding-currency";
import { runLegalFactChecks } from "./legal-verify";

/** Raw-body sentences with their offsets (links kept, so a replace is exact). */
export function rawSentences(body: string): { text: string; start: number }[] {
  const masked = body.replace(
    /\b(?:v|vs|Inc|Corp|Co|Ltd|No|St|Mr|Ms|Dr|Esq|e\.g|i\.e|etc|Admin|Super|Supp|Cir|App|Div)\.|\b(?:[A-Z]\.){2,}(?:\d+[a-z]{1,2})?|\]\([^)]*\)/g,
    (m) => m.replace(/\./g, "\u0000"),
  );
  const out: { text: string; start: number }[] = [];
  for (const m of masked.matchAll(/[^\n]+?(?:[.!?]+(?=\s|$)|$)/gm)) {
    const raw = body.slice(m.index ?? 0, (m.index ?? 0) + m[0].length);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text) out.push({ text, start: (m.index ?? 0) + lead });
  }
  return out;
}

/**
 * The stored sentence a finding quotes. The excerpt may be a whole sentence
 * (sentence-mode traps, KB checks) or "…60 characters either side…" (older
 * traps), possibly from link-stripped text. The sentence that contains the
 * MIDDLE of the longest excerpt piece is the one the check matched.
 */
export function locateSentence(body: string, excerpt: string): { text: string; start: number } | null {
  const piece = excerpt
    .split("…")
    .map((p) => quoteText(p))
    .sort((a, b) => b.length - a.length)[0];
  if (!piece || piece.length < 12) return null;
  const sentences = rawSentences(body).map((s) => ({ ...s, q: quoteText(s.text) }));
  const strip = (s: { text: string; start: number }) => ({ text: s.text, start: s.start });
  // 1. A sentence that contains the whole excerpt (sentence-mode excerpts).
  const containing = sentences.filter((s) => s.q.includes(piece));
  if (containing.length) return strip(containing[0]);
  // 2. The sentence holding the excerpt's middle: in a "…context MATCH
  //    context…" excerpt the match is at the centre, and a neighbouring
  //    sentence that happens to fit inside the excerpt is not the error.
  const mid = Math.floor(piece.length / 2);
  const core = piece.slice(Math.max(0, mid - 12), mid + 12);
  const central = sentences.filter((s) => s.q.includes(core));
  if (central.length === 1) return strip(central[0]);
  // 3. Otherwise a single sentence that sits inside the excerpt.
  const inside = sentences.filter((s) => s.q.length >= 12 && piece.includes(s.q));
  return inside.length === 1 ? strip(inside[0]) : central[0] ? strip(central[0]) : null;
}

/** One model call: the corrected sentence, or null when the model declines. */
export async function proposeFix(args: {
  sentence: string;
  title: string;
  note: string | null;
  fix: string | null;
}): Promise<string | null> {
  const instruction = [args.fix, args.note].filter(Boolean).join("\n");
  const resp = await getAnthropic().messages.create({
    model: CONTENT_LONG_FORM_MODEL,
    max_tokens: 1200,
    system:
      "You correct one sentence of legal marketing copy for Katz Melinger PLLC, a New York and New Jersey employee-side employment and creditor-side collections firm. " +
      "Rewrite ONLY the given sentence so it is legally correct per the problem and the correct statement. Keep its meaning, tone, markdown and links where they still fit. " +
      "Never add fee language, promises, superlatives, \"expert\" or \"specialize\", dashes, or facts not given. Write \"we\" and \"our firm\", never \"the firm\". " +
      "If the sentence cannot be corrected without inventing a fact, return it unchanged.",
    tools: [
      {
        name: "corrected_sentence",
        description: "Return the corrected sentence.",
        input_schema: {
          type: "object" as const,
          properties: { sentence: { type: "string" } },
          required: ["sentence"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "corrected_sentence" },
    messages: [
      {
        role: "user",
        content: `Problem: ${args.title}\nCorrect statement and instructions: ${instruction || "(see problem)"}\n\nSentence:\n${args.sentence}`,
      },
    ],
  });
  const tool = resp.content.find((c) => c.type === "tool_use");
  const out = tool && "input" in tool ? String((tool.input as { sentence?: unknown }).sentence ?? "").trim() : "";
  if (!out || out === args.sentence.trim()) return null;
  return out;
}

/** Does a hit's excerpt overlap the new sentence? (a 25-character window in common) */
function overlaps(excerpt: string, sentence: string): boolean {
  const s = quoteText(sentence);
  const e = excerpt.split("…").map(quoteText).join(" ");
  if (s.length < 25) return e.includes(s);
  for (let i = 0; i + 25 <= s.length; i += 10) if (e.includes(s.slice(i, i + 25))) return true;
  return false;
}

/**
 * The fixer guard. Returns the reasons the new sentence is unacceptable, or
 * [] when it passes. Traps are run on the WHOLE new body (so "unless" terms
 * elsewhere in the draft count, exactly as the gates will see it) and a hit
 * counts only when it overlaps the new sentence.
 */
export async function guardSentence(args: {
  newSentence: string;
  newBody: string;
  traps: KnownTrap[];
  ctx: TrapContext;
  tenantId: string;
}): Promise<string[]> {
  const reasons: string[] = [];
  for (const t of args.traps) {
    if (!t.enabled || t.matchType === "document_missing") continue;
    if (matchTrap(t, args.newBody, args.ctx).some((h) => overlaps(h.excerpt, args.newSentence))) {
      reasons.push(`Rule: ${t.label}`);
    }
  }
  if (findFeeLanguage(args.newSentence).length) reasons.push("Fee language");
  if (blockingAdHits(findAdTerms(args.newSentence)).length) reasons.push("Advertising term (expert, specialist, best)");
  if (/[–—]/.test(args.newSentence)) reasons.push("Dash");
  try {
    const kb = await runLegalFactChecks(args.newSentence, { tenantId: args.tenantId });
    for (const f of kb) if (f.severity === "critical") reasons.push(`Knowledge base: ${f.title}`);
  } catch {
    reasons.push("The knowledge base check could not run");
  }
  return [...new Set(reasons)];
}
