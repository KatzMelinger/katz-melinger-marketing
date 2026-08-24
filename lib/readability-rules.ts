/**
 * KM readability rules — the single source of truth for BOTH the scorer and the
 * generator (Part 2 of the master spec). Replaces Flesch-Kincaid as the basis for
 * flags: the score is the share of applicable rules passed, and every finding
 * names the rule it breaks and gives that rule's specific fix. Grade level is kept
 * only as a display-only readout, never a flag.
 *
 * 15 rules: 10 deterministic (implemented here, exact and no false positives) and
 * 5 AI-assisted judgment rules (08, 11, 12, 13, 14 — evaluated separately and
 * merged by the scorer). This module is pure (no LLM/IO) so it is unit-testable.
 *
 * Block-aware: headings are parsed as their own blocks and are NEVER scored for
 * sentence length/grade nor merged into the paragraph beneath them.
 */

import {
  MAX_PASSIVE_PCT,
  PROTECTED_TERMS,
  readabilityStats,
  READABILITY_TARGET,
  renderReadabilityRules,
} from "./readability";

export type RuleId =
  | "01" | "02" | "03" | "04" | "05" | "06" | "07" | "08"
  | "09" | "10" | "11" | "12" | "13" | "14" | "15";
export type RuleType = "deterministic" | "ai";
export type ReadabilityContentType = "web" | "blog" | "social";

/**
 * What a rule gets measured against — its denominator when deciding whether the
 * rule has actually been broken, as opposed to tripped once.
 *
 * "document" rules are about the piece as a whole (is there an FAQ at all), so
 * one instance IS the failure. The rest fire per sentence or per paragraph, and
 * for those a raw count is not a verdict: a lone passive sentence in a 90-
 * sentence article is not the same defect as forty of them.
 */
export type RuleUnit = "sentence" | "paragraph" | "document";

export type ReadabilityRule = {
  id: RuleId;
  type: RuleType;
  description: string;
  fix: string;
  scope: ReadabilityContentType[];
  unit: RuleUnit;
};

/**
 * How much of a rule a draft may break before the rule counts as failed.
 *
 * Scoring was presence-based: one instance anywhere failed the rule outright
 * and cost a full 1/15 of the score. That made the score a proxy for LENGTH.
 * Measured across the 176 live drafts, documents under 500 words had a median
 * of 75 and 89% cleared the floor of 60, while documents over 1000 words had a
 * median of 40 and 18% cleared it — because a longer piece simply has more
 * chances to trip each rule once. A 2,000-word blog could not pass no matter
 * how well written, and no choice of floor could fix that: raise it and short
 * pages sail through, keep it and long-form is permanently blocked.
 *
 * It also punished trivia at full price. Of the drafts failing Rule 09
 * ("there is" openers) 86% failed on a SINGLE occurrence; Rule 07 (weak
 * qualifiers) 70%; Rules 06 and 15, 67%. Four stray words could cost 27 points.
 *
 * A rule now fails when its instances exceed a share of the opportunities it
 * had to fire. The rate matches MAX_PASSIVE_PCT in lib/readability.ts, the
 * ceiling the generator was already held to for passive voice — this applies
 * that existing standard to the scorer rather than inventing a second one, and
 * keeps the two coherent: content the generator is permitted to write is not
 * then punished by the scorer for containing it.
 *
 * Rates from 2% to 10% were measured across the corpus. Below ~5% the scorer
 * becomes stricter than the generator's own ceiling (so generated drafts fail
 * Rule 04 by construction); at 10% the score is length-invariant up to a floor
 * of 70, which is where READABILITY_FLOOR is now set. See the table in
 * lib/readability.ts.
 *
 * The `max(1, …)` floor means one instance never fails a rule, at any length.
 * That is deliberate: a single occurrence is noise, and treating it as a defect
 * is what taught reviewers the score was not worth reading.
 *
 * NOTE: this changes only WHEN a rule counts as broken. The score is still the
 * share of applicable rules passed, and findings are still emitted per instance
 * so every occurrence remains visible and fixable.
 */
export const RULE_TOLERANCE_RATE = MAX_PASSIVE_PCT / 100;

/** Instances a rule may have before it counts as failed, given its opportunities. */
export function ruleTolerance(unit: RuleUnit, opportunities: number): number {
  if (unit === "document") return 0;
  return Math.max(1, Math.floor(opportunities * RULE_TOLERANCE_RATE));
}

const WEB_BLOG: ReadabilityContentType[] = ["web", "blog"];
const ALL: ReadabilityContentType[] = ["web", "blog", "social"];

/** One source of truth read by the scorer (to flag) and the generator (to instruct). */
export const READABILITY_RULES: ReadabilityRule[] = [
  { id: "01", type: "deterministic", description: "Sentence over 25 words", fix: "Split into shorter sentences.", scope: ALL , unit: "sentence" },
  { id: "02", type: "deterministic", description: "Paragraph over 4 sentences", fix: "Break into smaller paragraphs.", scope: ALL , unit: "paragraph" },
  { id: "03", type: "deterministic", description: "Three or more consecutive similar-length sentences", fix: "Vary the rhythm — combine or expand some.", scope: ALL , unit: "paragraph" },
  { id: "04", type: "deterministic", description: "Passive voice (a form of 'to be' + past participle)", fix: "Rewrite in active voice.", scope: ALL , unit: "sentence" },
  { id: "05", type: "deterministic", description: "Contraction on a web or blog page", fix: "Expand the contraction.", scope: WEB_BLOG , unit: "sentence" },
  { id: "06", type: "deterministic", description: "Two or more hedges in one sentence", fix: "State it directly.", scope: ALL , unit: "sentence" },
  { id: "07", type: "deterministic", description: "Weak qualifier (very, really, quite, somewhat…)", fix: "Remove it or replace with a specific term.", scope: ALL , unit: "sentence" },
  { id: "08", type: "ai", description: "Vague instead of specific ('significant', 'many')", fix: "Name the specific fact or number.", scope: ALL , unit: "sentence" },
  { id: "09", type: "deterministic", description: "'There is' / 'There are' opener", fix: "Rewrite the sentence directly.", scope: ALL , unit: "sentence" },
  { id: "10", type: "deterministic", description: "First person (we/our/us) on a web or blog page", fix: "Replace with 'Katz Melinger' or 'the firm'.", scope: WEB_BLOG , unit: "sentence" },
  { id: "11", type: "ai", description: "An H2's first sentence isn't a factual, extractable answer", fix: "Lead the section with a direct answer.", scope: ALL , unit: "paragraph" },
  { id: "12", type: "ai", description: "A legal claim without a specific law or authority", fix: "Name the statute or source.", scope: ALL , unit: "sentence" },
  { id: "13", type: "ai", description: "An H2 that isn't a question with a direct answer", fix: "Convert the heading to a question and answer it.", scope: ALL , unit: "paragraph" },
  { id: "14", type: "ai", description: "No FAQ, lists, or one-sentence definitions", fix: "Add structured, extractable elements.", scope: ALL , unit: "document" },
  { id: "15", type: "deterministic", description: "Complex word with a plain synonym", fix: "Swap to the plain word (unless it is a legal term of art).", scope: ALL , unit: "sentence" },
];

export function rule(id: RuleId): ReadabilityRule {
  return READABILITY_RULES.find((r) => r.id === id)!;
}

// ---------------------------------------------------------------------------
// Block parsing — headings are isolated from paragraphs and never merged.
// ---------------------------------------------------------------------------

export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string; sentences: string[] };

function renderInline(s: string): string {
  return (s ?? "")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Parse Markdown/HTML into heading and paragraph blocks (headings isolated). */
export function parseBlocks(body: string): Block[] {
  const normalized = (body ?? "")
    .replace(/```[\s\S]*?```/g, "\n\n")
    // HTML headings → markdown headings on their own line
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, l, t) => `\n\n${"#".repeat(Number(l))} ${renderInline(String(t))}\n\n`)
    // block-level closers → paragraph breaks; <br> → newline
    .replace(/<\/(p|div|li|ul|ol|section|article|blockquote)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // isolate markdown headings even without a blank line around them
    .replace(/^(#{1,6}\s+.*)$/gm, "\n\n$1\n\n");

  const blocks: Block[] = [];
  for (const raw of normalized.split(/\n\s*\n+/)) {
    const b = raw.trim();
    if (!b) continue;
    const hm = b.match(/^(#{1,6})\s+([\s\S]*)$/);
    if (hm) {
      blocks.push({ type: "heading", level: hm[1].length, text: renderInline(hm[2].replace(/\n/g, " ")) });
      continue;
    }
    const text = renderInline(b.replace(/\n/g, " "));
    if (!text) continue;
    blocks.push({ type: "paragraph", text, sentences: splitIntoSentences(text) });
  }
  return blocks;
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

// ---------------------------------------------------------------------------
// Passive voice (Rule 04) — a form of "to be" (NOT "get") + a real past
// participle. Excludes predicate adjectives ("you are entitled", "is located")
// and get-constructions ("Do you get paid…") that the old detector false-flagged.
// ---------------------------------------------------------------------------

const BE = "(?:is|are|was|were|be|been|being|am)";
const IRREGULAR_PARTICIPLES = [
  "given", "taken", "made", "paid", "held", "brought", "sought", "found",
  "shown", "written", "done", "seen", "built", "kept", "sent", "told",
  "awarded", "filed", "served", "denied", "granted", "withheld", "overpaid",
  "underpaid", "terminated", "retaliated", "owed", "charged", "fired", "hired",
  "classified", "misclassified", "dismissed", "sued", "assessed", "garnished",
];
// -ed/-en words that follow "to be" but read as adjectives, not passive verbs.
const ADJECTIVAL = new Set([
  "entitled", "located", "concerned", "interested", "dedicated", "committed",
  "involved", "qualified", "experienced", "based", "satisfied", "related",
  "limited", "prepared", "supposed", "required", "married", "tired", "worried",
  "excited", "pleased", "advanced", "skilled", "detailed", "complicated",
]);
const PASSIVE_RE = new RegExp(
  `\\b${BE}\\b(?:\\s+(?:not|never|being|been|already|also|only|\\w+ly)){0,3}\\s+(\\w+(?:ed|en)|${IRREGULAR_PARTICIPLES.join("|")})\\b(?:\\s+([A-Za-z']+))?`,
  "i",
);
// Words after a participle that confirm a verbal (passive) reading rather than an
// adjectival one: prepositions, conjunctions, and clause markers.
const PASSIVE_NEXT = new Set([
  "by", "to", "for", "from", "under", "with", "at", "in", "on", "against",
  "as", "into", "upon", "over", "after", "before", "and", "or", "but",
  "because", "when", "while", "that", "which", "who", "until", "unless",
]);

export function isPassive(sentence: string): boolean {
  const m = PASSIVE_RE.exec(sentence);
  if (!m) return false;
  const participle = m[1].toLowerCase();
  if (ADJECTIVAL.has(participle)) return false;
  // Irregular participles ("withheld", "terminated") are reliably verbal here.
  if (IRREGULAR_PARTICIPLES.includes(participle)) return true;
  // A regular -ed/-en word is passive only if nothing (clause end), an adverb, or
  // a preposition/conjunction follows — NOT a noun ("is deferred compensation" is
  // adjectival, "were reduced by the court" is passive).
  const next = (m[2] ?? "").toLowerCase();
  if (!next) return true;
  if (next.endsWith("ly")) return true;
  return PASSIVE_NEXT.has(next);
}

// ---------------------------------------------------------------------------
// Word lists for the lexical rules.
// ---------------------------------------------------------------------------

const HEDGES = [
  "may", "might", "could", "perhaps", "possibly", "generally", "typically",
  "usually", "often", "sometimes", "likely", "probably", "arguably",
  "presumably", "seemingly", "apparently",
  "in some cases", "in most cases", "to some extent", "for the most part",
];
const WEAK_QUALIFIERS = [
  "very", "really", "quite", "rather", "somewhat", "basically", "essentially",
  "actually", "fairly", "pretty", "totally", "literally", "extremely",
  "incredibly", "absolutely", "virtually", "somehow",
];
// Explicit contraction list — avoids flagging possessives ("employer's pay").
const CONTRACTIONS = [
  "can't", "won't", "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't",
  "weren't", "hasn't", "haven't", "hadn't", "wouldn't", "shouldn't", "couldn't",
  "mustn't", "it's", "that's", "there's", "here's", "what's", "who's", "let's",
  "he's", "she's", "you're", "we're", "they're", "i'm", "you've", "we've",
  "they've", "i've", "you'll", "we'll", "they'll", "it'll", "i'll", "you'd",
  "we'd", "they'd", "i'd",
];

/**
 * Complex → plain word pairs (Rule 15). Kept high-precision — only unambiguous
 * formalisms whose plain synonym is always safe. Legal terms of art are excluded
 * via the allowlist below (e.g. "compensation" is left alone — it's a practice
 * area, not a word to simplify).
 */
export const PLAINWORD_DICTIONARY: Record<string, string> = {
  utilize: "use", utilise: "use", utilizing: "using",
  commence: "start", endeavor: "try", endeavour: "try", ascertain: "find out",
  facilitate: "help", aforementioned: "this", heretofore: "until now",
  remuneration: "pay", subsequent: "later", numerous: "many",
  demonstrate: "show", sufficient: "enough",
};
/** Legal terms of art that must never be simplified (Rule 15 allowlist). */
export const LEGAL_ALLOWLIST: string[] = PROTECTED_TERMS;

/**
 * The parts of the rules engine the firm can edit without a deploy (slice 5).
 * The tables in supabase/readability_config_schema.sql override these per tenant;
 * lib/readability-config-store.ts loads them and falls back to the values above,
 * so the engine behaves identically whether or not the tables are populated.
 *
 * Rule logic itself is deliberately NOT configurable — only which rules run, the
 * plain-word pairs, and the legal terms Rule 15 must leave alone.
 */
export type ReadabilityConfig = {
  plainwords: Record<string, string>;
  allowlist: string[];
  /** Rules the firm has switched off. Excluded from the score's denominator. */
  disabledRuleIds: RuleId[];
};

export const DEFAULT_READABILITY_CONFIG: ReadabilityConfig = {
  plainwords: PLAINWORD_DICTIONARY,
  allowlist: LEGAL_ALLOWLIST,
  disabledRuleIds: [],
};

// ---------------------------------------------------------------------------
// Findings + deterministic checkers.
// ---------------------------------------------------------------------------

export type ReadabilityFinding = {
  ruleId: RuleId;
  rule: string;
  fix: string;
  /** The offending text, for the Apply-findings UI. */
  excerpt: string;
  /** Optional extra context, e.g. "(31 words)" or the suggested plain word. */
  detail?: string;
};

const excerptOf = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n).trim()}…` : s);
const countMatches = (hay: string, needle: string): number =>
  (hay.toLowerCase().match(new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g")) ?? []).length;

function inAllowlist(word: string, allowlist: string[]): boolean {
  const w = word.toLowerCase();
  return allowlist.some((t) => t.toLowerCase().includes(w));
}

/** Run every deterministic rule applicable to the content type. */
export function runDeterministicRules(
  body: string,
  contentType: ReadabilityContentType = "blog",
  config: ReadabilityConfig = DEFAULT_READABILITY_CONFIG,
): ReadabilityFinding[] {
  const blocks = parseBlocks(body);
  const paragraphs = blocks.filter((b): b is Extract<Block, { type: "paragraph" }> => b.type === "paragraph");
  const applies = (id: RuleId) =>
    rule(id).scope.includes(contentType) && !config.disabledRuleIds.includes(id);
  const out: ReadabilityFinding[] = [];
  const push = (id: RuleId, excerpt: string, detail?: string) => {
    if (!applies(id)) return;
    out.push({ ruleId: id, rule: rule(id).description, fix: rule(id).fix, excerpt, detail });
  };

  for (const p of paragraphs) {
    // Rule 02 — paragraph over 4 sentences
    if (p.sentences.length > 4) push("02", excerptOf(p.text, 90), `(${p.sentences.length} sentences)`);

    // Rule 03 — 3+ consecutive similar-length sentences (spread ≤ 2 words)
    const lens = p.sentences.map(wordCount);
    for (let i = 0; i + 2 < lens.length; i++) {
      const win = lens.slice(i, i + 3);
      if (Math.max(...win) - Math.min(...win) <= 2 && Math.min(...win) >= 5) {
        push("03", excerptOf(p.sentences[i]), `(${win.join(", ")} words)`);
        break; // one finding per paragraph is enough
      }
    }

    for (const s of p.sentences) {
      const lower = ` ${s.toLowerCase()} `;
      // Rule 01 — sentence over 25 words
      const wc = wordCount(s);
      if (wc > 25) push("01", excerptOf(s), `(${wc} words)`);
      // Rule 04 — passive voice
      if (isPassive(s)) push("04", excerptOf(s));
      // Rule 05 — contraction (explicit list, so possessives aren't flagged)
      const contraction = CONTRACTIONS.find((c) =>
        new RegExp(`\\b${c.replace(/'/g, "['’]")}\\b`, "i").test(s),
      );
      if (contraction) push("05", excerptOf(s), `"${contraction}"`);
      // Rule 06 — 2+ hedges in one sentence
      const hedgeHits = HEDGES.reduce((n, h) => n + (h.includes(" ") ? (lower.includes(` ${h} `) ? 1 : 0) : countMatches(s, h)), 0);
      if (hedgeHits >= 2) push("06", excerptOf(s), `(${hedgeHits} hedges)`);
      // Rule 07 — weak qualifier
      const weak = WEAK_QUALIFIERS.find((q) => countMatches(s, q) > 0);
      if (weak) push("07", excerptOf(s), `"${weak}"`);
      // Rule 09 — "There is/There are" opener
      if (/^\s*there\s+(is|are)\b/i.test(s)) push("09", excerptOf(s));
      // Rule 10 — first person we/our/us
      if (/\b(we|our|ours|we're|we've|we'll)\b/i.test(s) || /\bus\b/.test(s)) push("10", excerptOf(s));
      // Rule 15 — complex word with a plain synonym (skip legal terms of art)
      for (const [complex, plain] of Object.entries(config.plainwords)) {
        if (countMatches(s, complex) > 0 && !inAllowlist(complex, config.allowlist)) {
          push("15", excerptOf(s), `"${complex}" → "${plain}"`);
          break; // one per sentence keeps the panel readable
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scoring — share of applicable, evaluated rules passed.
// ---------------------------------------------------------------------------

export type ReadabilityRuleResult = {
  /** 0–100: share of applicable, evaluated rules with no finding. */
  score: number;
  rulesApplicable: number;
  rulesPassed: number;
  failedRuleIds: RuleId[];
  findings: ReadabilityFinding[];
  /** Display-only Flesch-Kincaid grade (target ≈ 8). Never a flag. */
  gradeReadout: number;
};

/**
 * Score `body` against the KM rules. `aiFindings` and `evaluatedAiRuleIds` let the
 * caller fold in the AI-assisted rules (08/11/12/13/14); omit them to score the
 * deterministic rules alone. A rule counts as applicable only if it is in scope
 * for the content type AND was actually evaluated.
 */
export function scoreReadabilityRules(
  body: string,
  opts: {
    contentType?: ReadabilityContentType;
    aiFindings?: ReadabilityFinding[];
    evaluatedAiRuleIds?: RuleId[];
    /** Firm-edited rule config; omit for the code-seeded defaults. */
    config?: ReadabilityConfig;
  } = {},
): ReadabilityRuleResult {
  const contentType = opts.contentType ?? "blog";
  const config = opts.config ?? DEFAULT_READABILITY_CONFIG;
  const detFindings = runDeterministicRules(body, contentType, config);
  const findings = [...detFindings, ...(opts.aiFindings ?? [])];

  const evaluated = new Set<RuleId>();
  for (const r of READABILITY_RULES) {
    if (r.type === "deterministic") evaluated.add(r.id);
  }
  for (const id of opts.evaluatedAiRuleIds ?? []) evaluated.add(id);

  // A disabled rule leaves the denominator too, not just the findings. Counting
  // it as applicable would mark it passed and inflate the score for every draft.
  const applicable = READABILITY_RULES.filter(
    (r) =>
      r.scope.includes(contentType) &&
      evaluated.has(r.id) &&
      !config.disabledRuleIds.includes(r.id),
  );

  // A rule fails on DENSITY, not presence. Counting one instance as a full
  // failure made the score track document length rather than readability (see
  // RULE_TOLERANCE_RATE). Opportunities come from the same block parse the
  // findings did, so the denominator matches what was actually measured.
  const blocks = parseBlocks(body);
  const paragraphs = blocks.filter((b) => b.type === "paragraph");
  const opportunities: Record<RuleUnit, number> = {
    sentence: paragraphs.reduce(
      (n, p) => n + (p as Extract<Block, { type: "paragraph" }>).sentences.length,
      0,
    ),
    paragraph: paragraphs.length,
    document: 1,
  };

  const instanceCount = new Map<RuleId, number>();
  for (const f of findings) {
    instanceCount.set(f.ruleId, (instanceCount.get(f.ruleId) ?? 0) + 1);
  }

  const failedRuleIds = applicable
    .filter((r) => (instanceCount.get(r.id) ?? 0) > ruleTolerance(r.unit, opportunities[r.unit]))
    .map((r) => r.id);
  const failed = new Set(failedRuleIds);
  const rulesPassed = applicable.length - failed.size;
  const score = applicable.length ? Math.round((rulesPassed / applicable.length) * 100) : 100;

  return {
    score,
    rulesApplicable: applicable.length,
    rulesPassed,
    failedRuleIds,
    findings,
    gradeReadout: readabilityStats(body).grade,
  };
}

/** Map a content format/template to the readability content type. */
export function readabilityContentType(format?: string | null): ReadabilityContentType {
  const f = (format ?? "").toLowerCase();
  if (/social|instagram|linkedin|facebook|tiktok|twitter|threads/.test(f)) return "social";
  if (f.includes("blog")) return "blog";
  return "web";
}

/**
 * Render findings as unique instruction strings for the analyzer's string[]
 * contract and the Apply-findings UI. Each names its rule and gives that rule's
 * specific fix — no single canned fix.
 */
/**
 * Findings as display strings, capped PER RULE rather than across the list.
 *
 * The cap used to be 25 across everything, which quietly broke the only action
 * that can move the score. A rule counts as passed once every instance is gone,
 * so a draft with 40 long sentences showed 25 of them, and fixing all 25 still
 * left the rule failing — the reviewer did the work and the number sat still.
 * A per-rule cap keeps each rule individually clearable, and the total stays
 * bounded because there are only 15 rules.
 *
 * `perRuleCap` is generous rather than unlimited: a single rule with hundreds of
 * hits is a draft that needs rewriting, not a longer list.
 */
export function formatReadabilityFindings(
  findings: ReadabilityFinding[],
  perRuleCap = 40,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const perRule = new Map<RuleId, number>();
  for (const f of findings) {
    const used = perRule.get(f.ruleId) ?? 0;
    if (used >= perRuleCap) continue;
    const head = [f.rule, f.detail].filter(Boolean).join(" ");
    const s = `Rule ${f.ruleId}: ${head}. ${f.fix} "${f.excerpt}"`.replace(/\s+/g, " ").trim();
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    perRule.set(f.ruleId, used + 1);
  }
  return out;
}

/**
 * Generator constraint block — the same rules the scorer enforces, so the
 * generator writes to spec (one source of truth). Deterministic rules only; the
 * AI rules are guidance the generator already follows via its prompt.
 */
export function renderReadabilityRulesForGenerator(
  contentType: ReadabilityContentType = "blog",
): string {
  const lines = READABILITY_RULES.filter((r) => r.scope.includes(contentType)).map(
    (r) => `- Rule ${r.id}: avoid — ${r.description}. ${r.fix}`,
  );
  return [
    "KM READABILITY RULES (hard constraints — write to all of these):",
    ...lines,
    "Keep legal terms of art verbatim (e.g. \"liquidated damages\", \"Fair Labor Standards Act\"); do not simplify them.",
    "Target reading level: grade 8 or lower.",
  ].join("\n");
}

/**
 * The readability constraint block to inject into a generator prompt — the KM
 * rules when the engine flag is on, the legacy block otherwise. Callers pass the
 * flag so this module stays pure/testable.
 */
export function readabilityPromptBlock(
  contentType: ReadabilityContentType,
  useRules: boolean,
): string {
  return useRules ? renderReadabilityRulesForGenerator(contentType) : renderReadabilityRules();
}

/**
 * Readability signal for a generator's rewrite loop, unified across engines:
 * `score` is higher-is-better in both (rules → share passed; Flesch → ease), so
 * a rewrite is kept when its score beats the current one. `needsWork` says whether
 * another pass is worthwhile.
 */
export function readabilityForGenerator(
  body: string,
  contentType: ReadabilityContentType,
  useRules: boolean,
): { score: number; needsWork: boolean } {
  if (useRules) {
    const r = scoreReadabilityRules(body, { contentType });
    return { score: r.score, needsWork: r.findings.length > 0 };
  }
  const s = readabilityStats(body);
  return {
    score: s.flesch,
    needsWork: s.flesch < READABILITY_TARGET && s.overThresholdCount > 0,
  };
}
