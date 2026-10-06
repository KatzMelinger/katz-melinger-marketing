/**
 * Automatic rewrite of errors with ONE known correct answer (Diana's Sept 28
 * spec, section 9). Every change is logged (lib/legal-fix-log.ts) so a person
 * can see it, undo it, and mark the log reviewed before approving.
 *
 * WHAT IS REWRITTEN
 *   knowledge base   a legal constant stated wrong (NYSHRL "one year" -> 3 years)
 *   statute table    a real section cited for what it does not cover
 *   firm fact        wrong author / managing partner, fee sentences (deleted,
 *                    never replaced), firm name, old offer phrase
 *   required element label, CTA, closing disclaimer, internal links
 *   brand rule       New York / New Jersey spelled out, no em or en dashes,
 *                    no hashtags, no "expert" / "specialize" about the firm
 *
 * WHAT IS NEVER REWRITTEN
 *   Questions of interpretation (they stay as findings for an attorney),
 *   placeholders and invented quotes (a person fills those), and any draft
 *   written for the wrong audience — that is flagged "Full redraft needed" and
 *   the rewrite stops, because patching a debtor-side blog sentence by sentence
 *   produces a creditor-side blog nobody designed.
 *
 * Deterministic edits need no model. Sentence rewrites (a statute sentence, an
 * all-employers coverage sentence, a managing-partner title, an "expert")
 * go in ONE model call per draft, and each proposed sentence is checked before
 * it is used: it must not add fee language or an ad term, and must stay close
 * to the original's length.
 */
import { getAnthropic, CONTENT_LONG_FORM_MODEL } from "./anthropic";
import { findFeeLanguage } from "./fee-language";
import { blockingAdHits, findAdTerms } from "./ad-terms";
import { normalizeEnding } from "./legal-disclaimers";
import { BAD_SLUGS, internalLinks, MIN_INTERNAL_LINKS } from "./required-elements";
import { linkRowFor } from "./link-map";
import { bylineFor, expectedAuthor, firmFactFindings } from "./firm-fact-findings";
import { statuteFindings } from "./legal-statute-check";
import type { StatuteRow } from "./legal-statute-table";
import type { NormalizedFinding } from "./content-findings";
import { changeId, whereIs, type ChangeSource, type FixChange } from "./legal-fix-log";

export type RewriteInput = {
  body: string;
  title: string | null;
  topic?: string | null;
  practiceArea?: string | null;
  format?: string | null;
  /** metadata.language; "es" leaves the ending alone (no approved Spanish CTA yet). */
  language?: string | null;
  cta: { phone: string; offerPhrase: string };
  /** Knowledge base findings from runLegalFactChecks (constant_mismatch etc.). */
  kbFindings?: NormalizedFinding[];
  /** Attorney-approved statute rows (empty = skip the statute rewrites). */
  statuteRows?: StatuteRow[];
  /** Skip the model call (tests, dry runs that must cost nothing). */
  noModel?: boolean;
};

export type RewriteResult = {
  body: string;
  title: string | null;
  changes: FixChange[];
  /** Findings left for a person: interpretation, placeholders, unverified citations. */
  attorneyReview: string[];
  /** Non-null when the draft must be regenerated, not patched. */
  fullRedraft: string | null;
};

const OLD_OFFER_PHRASES = ["Free Confidential Case Review", "Free Case Evaluation", "free case review", "Schedule a Consultation"];

/** Trap 7's shape: the firm named as the subject of what it does. */
const THIRD_PERSON_RE = /\b(?:The firm|Katz Melinger PLLC|Katz Melinger)\s+(?:represents|handles|offers|helps|works|provides|focuses)\b/gi;

/* ------------------------------------------------------------------------- */

class Editor {
  body: string;
  title: string | null;
  changes: FixChange[] = [];
  constructor(body: string, title: string | null) {
    this.body = body;
    this.title = title;
  }
  private log(c: Omit<FixChange, "id" | "at">) {
    this.changes.push({ ...c, id: changeId(), at: new Date().toISOString() });
  }
  /** Replace the first occurrence of `from` at or after `start`. */
  replace(from: string, to: string, reason: string, source: ChangeSource, ref?: string, start = 0): boolean {
    if (!from || from === to) return false;
    const i = this.body.indexOf(from, start);
    if (i === -1) return false;
    const anchor = this.body.slice(Math.max(0, i - 40), i);
    this.body = this.body.slice(0, i) + to + this.body.slice(i + from.length);
    this.log({ where: whereIs(this.body, i), from, to, reason, source, source_ref: ref, anchor_before: anchor });
    return true;
  }
  /** Delete a span, remembering where it was so undo can put it back. */
  remove(span: string, reason: string, source: ChangeSource, ref?: string): boolean {
    const i = this.body.indexOf(span);
    if (i === -1) return false;
    const anchor = this.body.slice(Math.max(0, i - 40), i);
    this.body = this.body.slice(0, i) + this.body.slice(i + span.length);
    this.log({ where: whereIs(this.body, i), from: span, to: "", reason, source, source_ref: ref, anchor_before: anchor });
    return true;
  }
  insertAt(index: number, text: string, where: string, reason: string, source: ChangeSource, ref?: string) {
    const anchor = this.body.slice(Math.max(0, index - 40), index);
    this.body = this.body.slice(0, index) + text + this.body.slice(index);
    this.log({ where, from: "", to: text, reason, source, source_ref: ref, anchor_before: anchor });
  }
  setTitle(to: string, reason: string, source: ChangeSource) {
    const from = this.title ?? "";
    if (from === to) return;
    this.title = to;
    this.log({ where: "Title", from, to, reason, source });
  }
  record(c: Omit<FixChange, "id" | "at">) {
    this.log(c);
  }
}

/** The sentence around an index (same boundaries the checks use). */
function sentenceAt(body: string, index: number): { text: string; start: number } {
  const stops = /[.!?]\s|\n/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = stops.exec(body)) && m.index < index) start = m.index + m[0].length;
  const tail = body.slice(index).search(/[.!?](\s|$)|\n/);
  const end = tail === -1 ? body.length : index + tail + 1;
  return { text: body.slice(start, end).trim(), start };
}

/**
 * Case and statute citations, which brand rules must never touch (Oct 6 spec,
 * Task 6): a case name through its "(year)" ("Sabetay v. Sterling Drug, Inc.,
 * 69 N.Y.2d 329 (1987)"), a bare reporter cite ("58 N.Y.2d 293") and a
 * code cite ("N.J.S.A. 10:5-12.8", "N.Y.C. Admin. Code § 8-107").
 */
const CITATION_RES = [
  /[A-Z][^\n()]{0,80}?\sv\.\s[^\n()]{0,160}?\([^()\n]*?\d{4}\)/g,
  /\b\d+\s+(?:N\.Y\.(?:2d|3d|S\.(?:2d|3d)?)?|A\.D\.(?:2d|3d)?|N\.J\.(?:\s?Super\.)?|Misc\.\s?(?:2d|3d)?|F\.(?:2d|3d|4th)|F\.\s?Supp\.(?:\s?(?:2d|3d))?)\s*\d+/g,
  /\b(?:N\.J\.S\.A\.|N\.Y\.C\.\s?Admin\.\s?Code|N\.J\.A\.C\.)[^\n,;)]{0,30}/g,
];

function insideCitation(line: string, offset: number): boolean {
  for (const re of CITATION_RES) {
    for (const m of line.matchAll(re)) {
      const start = m.index ?? 0;
      if (offset >= start && offset < start + m[0].length) return true;
    }
  }
  return false;
}

/** Is this index inside a markdown link target, a URL, a citation, or a heading line? */
function protectedAt(body: string, index: number): boolean {
  const lineStart = body.lastIndexOf("\n", index - 1) + 1;
  const line = body.slice(lineStart, body.indexOf("\n", index) === -1 ? body.length : body.indexOf("\n", index));
  if (/^\s*#/.test(line)) return true;
  // Keyword and metadata lines pasted into a body: "NYC"/"NY" are allowed in
  // keywords and titles (Appendix C), and these are not reader-facing prose.
  if (/^\s*[*_]*\s*(?:Target Keywords?|Keywords?|Primary Keyword|Secondary Keywords|Meta (?:Title|Description)|URL|Slug|Title)\s*:/i.test(line)) return true;
  if (insideCitation(line, index - lineStart)) return true;
  const before = body.slice(Math.max(0, index - 200), index);
  if (/\]\([^)]*$/.test(before)) return true; // inside (url)
  if (/https?:\/\/\S*$/.test(before)) return true;
  if (/<[^>]*$/.test(before)) return true; // inside an HTML tag
  return false;
}

/* ------------------------------------------------------------------------- */

export async function autoRewrite(input: RewriteInput): Promise<RewriteResult> {
  const ed = new Editor(input.body ?? "", input.title ?? null);
  const attorneyReview: string[] = [];
  const ctx = { title: input.title, topic: input.topic ?? null, practiceArea: input.practiceArea ?? null };

  // 0. Wrong audience: stop. Never patched (section 9).
  const firm = firmFactFindings(ed.body, ctx);
  const offPractice = firm.find((f) => f.ruleId === "firm_off_practice");
  if (offPractice) {
    return { body: ed.body, title: ed.title, changes: [], attorneyReview: [], fullRedraft: offPractice.title };
  }

  // Placeholders and schema code are reported, never filled in.
  const ph = ed.body.match(/\[?PLACEHOLDER\b[^\]\n]*\]?|Replace before publishing/i);
  if (ph) attorneyReview.push(`Placeholder to replace by hand: "${ph[0].slice(0, 80)}"`);
  if (/application\/ld\+json|"@context"\s*:/i.test(ed.body)) {
    attorneyReview.push("Schema (JSON LD) code in the body: move it to the page schema field.");
  }

  // 1. Firm name.
  for (const bad of ["Katz Melinger, PLLC", "Katz Melinger PLLG", "Katz-Melinger"]) {
    while (ed.replace(bad, "Katz Melinger PLLC", "Firm name is Katz Melinger PLLC (Appendix C).", "firm fact", "firm_name")) {
      /* every occurrence */
    }
  }

  // 2. Fee language: delete the sentence, or the whole FAQ entry when the
  //    question itself is about fees. Never replaced with another fee statement.
  removeFeeSections(ed);
  const feeClauseEdits: { sentence: string; match: string }[] = [];
  for (let guard = 0; guard < 50; guard++) {
    const hit = findFeeLanguage(ed.body).find((h) => !feeClauseEdits.some((e) => e.sentence.includes(h.match)));
    if (!hit) break;
    const s = sentenceAt(ed.body, hit.index);
    if (!s.text) break;
    // A sentence that is ABOUT fees is deleted. A long sentence that lists
    // several remedies and ends with "and attorneys' fees" keeps its other
    // remedies: only the fee clause goes, which needs a sentence rewrite.
    const rest = s.text.replace(hit.match, "").replace(/[^A-Za-z]+/g, " ").trim();
    const mixed = rest.length > 90 && /,|\band\b/.test(s.text) && !/\bcontingen|\bhourly\b|\bflat\s+fee/i.test(s.text);
    if (mixed) {
      feeClauseEdits.push({ sentence: s.text, match: hit.match });
      continue;
    }
    if (!ed.remove(s.text, `Fee language is never published (Kenneth, 2026-09-29): "${hit.match}".`, "firm fact", "fee_language")) break;
  }

  // 3. Old offer phrases -> the locked one.
  for (const old of OLD_OFFER_PHRASES) {
    let from = 0;
    for (let guard = 0; guard < 20; guard++) {
      const i = ed.body.indexOf(old, from);
      if (i === -1) break;
      if (protectedAt(ed.body, i)) {
        from = i + old.length;
        continue;
      }
      ed.replace(old, input.cta.offerPhrase, "The offer phrase is locked (Kenneth, 2026-09-29).", "firm fact", "offer_phrase", i);
      from = i + input.cta.offerPhrase.length;
    }
  }

  // 4. Author byline.
  const expected = expectedAuthor(ctx);
  if (expected) {
    const byline = bylineFor(expected);
    const m = ed.body.match(/^\s*[*_]*\s*By\s+[A-Z][^\n]*$/m);
    if (m) {
      const line = m[0].trim();
      if (!line.replace(/[*_]/g, "").startsWith(byline) && !new RegExp(expected.name.split(" ").pop() ?? "", "i").test(line)) {
        ed.replace(line, byline, `Author follows the practice area (Appendix D): ${expected.name}.`, "firm fact", "firm_author");
      }
    } else {
      const h1 = ed.body.match(/^#\s+.+$/m);
      const at = h1 ? (h1.index ?? 0) + h1[0].length : 0;
      ed.insertAt(at, `\n\n${byline}`, "Top", `Every blog carries the practice area's author byline (Appendix D).`, "firm fact", "firm_author");
    }
  }

  // 5. Knowledge base constants with a literal replacement.
  const modelEdits: { sentence: string; instruction: string; source: ChangeSource; ref: string; reason: string }[] = [];
  for (const e of feeClauseEdits) {
    modelEdits.push({
      sentence: e.sentence,
      instruction: `Remove only the part about attorney fees or fees ("${e.match}") and keep every other point in the sentence. Do not mention fees in any other way. Change nothing else.`,
      source: "firm fact",
      ref: "fee_language",
      reason: `Fee language is never published (Kenneth, 2026-09-29): "${e.match}".`,
    });
  }
  for (const f of input.kbFindings ?? []) {
    if (!f.excerpt || !f.fix) continue;
    if (f.ruleId === "constant_mismatch") {
      const lit = f.fix.match(/^Replace "([^"]+)" with "([^"]+)"/);
      const i = ed.body.indexOf(f.excerpt);
      if (lit && i !== -1) {
        const j = ed.body.indexOf(lit[1], i);
        if (j !== -1 && j < i + f.excerpt.length) {
          ed.replace(lit[1], lit[2], f.title, "knowledge base", f.ruleId, j);
          continue;
        }
      }
      modelEdits.push({ sentence: f.excerpt, instruction: f.fix, source: "knowledge base", ref: f.ruleId, reason: f.title });
    } else if (f.ruleId === "value_date_mismatch") {
      modelEdits.push({ sentence: f.excerpt, instruction: f.fix, source: "knowledge base", ref: f.ruleId, reason: f.title });
    }
  }

  // 6. Statute table.
  for (const f of statuteFindings(ed.body, input.statuteRows ?? [])) {
    if (f.ruleId === "statute_subject_mismatch" && f.excerpt && f.fix) {
      modelEdits.push({ sentence: f.excerpt, instruction: f.fix, source: "statute table", ref: f.ruleId, reason: f.title });
    } else if (f.ruleId === "statute_unverified_citation") {
      attorneyReview.push(f.title);
    }
  }

  // 7. Managing partner and firm "expert" / "specialize" claims: sentence rewrites.
  for (const f of firmFactFindings(ed.body, ctx)) {
    if (f.ruleId === "firm_managing_partner" && f.excerpt) {
      modelEdits.push({ sentence: f.excerpt, instruction: f.fix ?? "", source: "firm fact", ref: "firm_managing_partner", reason: f.title });
    } else if (f.ruleId === "firm_statistic" && f.excerpt) {
      attorneyReview.push(`Unsourced statistic: "${f.excerpt.slice(0, 100)}"`);
    }
  }
  // The firm in the third person (Oct 6 spec, trap 7): blogs and service
  // pages say "we" and "our firm" (Diana, 2026-10-06).
  for (const m of ed.body.matchAll(THIRD_PERSON_RE)) {
    if (protectedAt(ed.body, m.index ?? 0)) continue;
    const s = sentenceAt(ed.body, m.index ?? 0);
    if (s.text && !modelEdits.some((e) => e.sentence === s.text)) {
      modelEdits.push({
        sentence: s.text,
        instruction:
          'Rewrite in the first person plural: "we" or "our firm" instead of naming Katz Melinger or "the firm" as the subject (for example "We represent" instead of "The firm represents"). Change nothing else.',
        source: "brand rule",
        ref: "first_person",
        reason: 'Blogs and service pages say "we" and "our firm" (Diana, 2026-10-06).',
      });
    }
  }
  for (const h of blockingAdHits(findAdTerms(ed.body))) {
    const s = sentenceAt(ed.body, h.index);
    if (s.text && !modelEdits.some((e) => e.sentence === s.text)) {
      modelEdits.push({
        sentence: s.text,
        instruction: `Remove "${h.match}" as a claim about the firm (the firm holds no specialist certification). Say "experienced" or name the practice area instead. Change nothing else.`,
        source: "brand rule",
        ref: "ad_terms",
        reason: `"${h.match}" about the firm is not allowed (RPC 7.4).`,
      });
    }
  }

  if (modelEdits.length > 0 && !input.noModel) {
    await applyModelEdits(ed, modelEdits, attorneyReview);
  } else {
    for (const e of modelEdits) attorneyReview.push(`Needs a rewrite: ${e.reason}`);
  }

  // 8. Brand rules (deterministic).
  brandRules(ed);

  // 9a. Made-up short slugs -> the real page (Appendix E).
  for (const m of [...ed.body.matchAll(/https?:\/\/(?:www\.)?katzmelinger\.com(\/[a-z0-9-]+\/?)(?=[)\s"'>\]]|$)/gi)]) {
    const path = m[1].toLowerCase().replace(/\/?$/, "/");
    const real = BAD_SLUGS[path];
    if (real) {
      ed.replace(m[0], real, `${path} is not a page on the site; the link now points to the real page (Appendix E).`, "required element", "internal_links");
    }
  }

  // 9. Internal links: top up to three from the link map.
  if (internalLinks(ed.body).length < MIN_INTERNAL_LINKS) {
    const row = linkRowFor(`${input.title ?? ""} ${input.topic ?? ""}`);
    if (row) {
      const have = new Set(internalLinks(ed.body));
      const want = [row.pillar, ...row.supporting].filter(
        (l) => !have.has(new URL(l.url).pathname.toLowerCase().replace(/\/?$/, "/")),
      );
      const need = Math.max(0, MIN_INTERNAL_LINKS - have.size);
      const add = want.slice(0, Math.max(need, have.has(new URL(row.pillar.url).pathname) ? 0 : 1));
      if (add.length > 0) {
        const section = `\n\n## Related Resources\n\n${add.map((l) => `- [${capitalize(l.anchor)}](${l.url})`).join("\n")}`;
        const end = ed.body.search(/\n+\**Call today at|\n+\*This article is for general informational/);
        const at = end === -1 ? ed.body.trimEnd().length : end;
        ed.insertAt(at, section, "End", `At least three internal links, including the pillar page (Appendix E: ${row.label}).`, "required element", "internal_links");
      }
    }
  }

  // 10. The ending last, so the CTA and disclaimer close the page. The
  //     normalizer removes every CTA, disclaimer and label wherever it sits
  //     and adds back exactly one of each (Oct 6 spec, Task 2).
  const ending = normalizeEnding(ed.body, { cta: input.cta, language: input.language });
  if (ending.changes.length > 0) {
    ed.body = ending.body;
    for (const c of ending.changes) {
      const at = c.to ? ed.body.indexOf(c.to) : -1;
      ed.record({
        where: c.where,
        from: c.from,
        to: c.to,
        reason: c.reason,
        source: "required element",
        source_ref: c.ref,
        anchor_before: c.anchor ?? (at > 0 ? ed.body.slice(Math.max(0, at - 40), at) : ""),
      });
    }
  }

  return { body: ed.body, title: ed.title, changes: ed.changes, attorneyReview, fullRedraft: null };
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Delete FAQ entries / sections whose heading is a question about fees. */
function removeFeeSections(ed: Editor) {
  // "charge" alone is NOT a fee word here: "file a charge with the EEOC" is
  // the commonest FAQ in the library. Only the billing senses count.
  // Nor is "how much" ("How Much Money Can You Recover?" is about damages) or
  // "pay lawyer" ("Overtime Pay Lawyer" is a keyword). The heading must be
  // about what representation costs.
  const re =
    /^(#{2,4})\s+([^\n]*(?:\b(?:legal|attorney['’]?s?|lawyer['’]?s?)\s+fees?\b|\bfee\s+(?:structures?|arrangements?)\b|\bcontingen\w*|\bhourly\s+(?:rate|fee|billing)s?\b|\bhow\s+much\s+(?:does|do|will|would)\s+(?:it|a|an|the|your)?\s*(?:\w+\s+){0,3}(?:lawyer|attorney|law firm)s?\s+cost\b|\bcost\s+(?:of|to)\s+(?:hire|hiring|retain)\b|\b(?:do|does|will|would)\s+(?:you|we|the firm|a lawyer|an attorney|lawyers|attorneys)\s+charge\b|\bcharge\s+for\b|\bto\s+pay\s+(?:for\s+)?(?:a|an|your)\s+(?:lawyer|attorney))[^\n]*)$/gim;
  for (let guard = 0; guard < 10; guard++) {
    // Recovering attorney fees is a remedy, not a fee arrangement (Kenneth,
    // 2026-09-29): a heading like "Can I recover attorney fees?" stays.
    const m = [...ed.body.matchAll(re)].find(
      (x) => /\b(lawyer|attorney|firm|you|we|legal)\b/i.test(x[2]) && !/\brecover|\baward|\bshift/i.test(x[2]),
    );
    if (!m || m.index === undefined) break;
    const level = m[1].length;
    const start = m.index;
    const rest = ed.body.slice(start + m[0].length);
    const next = rest.search(new RegExp(`^#{1,${level}}\\s`, "m"));
    const end = next === -1 ? ed.body.length : start + m[0].length + next;
    const span = ed.body.slice(start, end);
    if (!ed.remove(span, `A section about fees is removed, never rewritten ("${m[2].trim()}").`, "firm fact", "fee_language")) break;
  }
}

/** New York / New Jersey spelled out, no em or en dashes, no hashtags. */
function brandRules(ed: Editor) {
  const abbrev: [RegExp, string][] = [
    // Never inside a citation (Oct 6 spec, Task 6): "N.Y.C. Admin. Code" had
    // become "New YorkC. Admin. Code". Reporters and codes keep their
    // abbreviations; insideCitation() below covers the rest of a case cite.
    [/\bN\.Y\.(?!\s?(?:\d|S\.|C\.|C\b|App|Misc|Civ|Crim|Jud|Gen|Lab|Exec|Comp))/g, "New York"],
    [/\bN\.J\.(?!\s?(?:S\.A|A\.C|R\.|Super|\d|Admin|Ct))/g, "New Jersey"],
    // Not in a postal address ("New York, NY 10017" is the office address).
    [/\bNY\b(?!C)(?!\s+\d{5})/g, "New York"],
    [/\bNJ\b(?!\s+\d{5})/g, "New Jersey"],
  ];
  for (const [re, full] of abbrev) {
    for (let guard = 0; guard < 200; guard++) {
      re.lastIndex = 0;
      let hit: RegExpExecArray | null = null;
      let m: RegExpExecArray | null;
      while ((m = re.exec(ed.body))) {
        if (!protectedAt(ed.body, m.index)) {
          hit = m;
          break;
        }
      }
      if (!hit) break;
      const s = sentenceAt(ed.body, hit.index);
      const fixed = s.text.replace(re, (x, off: number) => (protectedAt(s.text, off) ? x : full));
      if (fixed === s.text || !ed.replace(s.text, fixed, "New York and New Jersey are spelled out in body text.", "brand rule", "state_names", s.start)) break;
    }
  }
  // Em and en dashes. A range ("2019–2021") becomes "2019 to 2021"; anything
  // else becomes a comma.
  for (let guard = 0; guard < 200; guard++) {
    const m = /[–—]/.exec(ed.body);
    if (!m || protectedAt(ed.body, m.index)) break;
    const s = sentenceAt(ed.body, m.index);
    const fixed = s.text
      .replace(/(\d)\s*[–—]\s*(\d)/g, "$1 to $2")
      .replace(/\s*[–—]\s*/g, ", ")
      .replace(/,\s*,/g, ",");
    if (fixed === s.text || !ed.replace(s.text, fixed, "No dashes (brand rule).", "brand rule", "dash", s.start)) break;
  }
  // Hyphenated compounds (Oct 6 spec, trap 8): "at-will" becomes "at will".
  // Lowercase words only, so statute numbers ("5-336"), phone numbers and
  // official names ("Sarbanes-Oxley") are untouched; URLs, link targets,
  // citations and headings are protected.
  const CLOSED: Record<string, string> = { "e-mail": "email", "co-worker": "coworker", "co-workers": "coworkers" };
  for (let guard = 0; guard < 300; guard++) {
    const re = /(?<![\w@/.-])[a-z]+(?:-[a-z]+)+(?![\w-]|\.[a-z])/g;
    let hit: RegExpExecArray | null = null;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ed.body))) {
      if (!protectedAt(ed.body, m.index)) {
        hit = m;
        break;
      }
    }
    if (!hit) break;
    const s = sentenceAt(ed.body, hit.index);
    const fixed = s.text.replace(re, (x, off: number) =>
      protectedAt(s.text, off) ? x : (CLOSED[x] ?? x.replace(/-/g, " ")),
    );
    if (fixed === s.text || !ed.replace(s.text, fixed, "No hyphens (brand rule).", "brand rule", "hyphen", s.start)) break;
  }
  // Hashtags in blog body text (not headings, not URLs).
  for (let guard = 0; guard < 50; guard++) {
    const re = /(^|[\s(])#[A-Za-z][\w]*/gm;
    let hit: RegExpExecArray | null = null;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ed.body))) {
      const at = m.index + m[1].length;
      if (!protectedAt(ed.body, at) && !/^#{1,6}\s/.test(ed.body.slice(at))) {
        hit = m;
        break;
      }
    }
    if (!hit) break;
    const tag = hit[0].slice(hit[1].length);
    if (!ed.remove(tag, "No hashtags in blogs (brand rule).", "brand rule", "hashtag")) break;
  }
}

/** One model call for every sentence rewrite, each result checked before use. */
async function applyModelEdits(
  ed: Editor,
  edits: { sentence: string; instruction: string; source: ChangeSource; ref: string; reason: string }[],
  attorneyReview: string[],
) {
  const items = edits.map((e, i) => ({ id: i, sentence: e.sentence, instruction: e.instruction }));
  let results: { id: number; new_sentence: string }[] = [];
  try {
    const resp = await getAnthropic().messages.create({
      model: CONTENT_LONG_FORM_MODEL,
      max_tokens: 4000,
      system:
        "You correct individual sentences in legal marketing copy for Katz Melinger PLLC. For each item, apply ONLY the instruction to the sentence and return the corrected sentence. " +
        "Keep everything else identical: wording, tone, links, markdown. Never add fee language, promises, superlatives, \"expert\" or \"specialize\", dashes, or new facts. " +
        "If the instruction cannot be followed without inventing a fact, return the sentence unchanged.",
      tools: [
        {
          name: "corrected_sentences",
          description: "Return one corrected sentence per item.",
          input_schema: {
            type: "object" as const,
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: { id: { type: "number" }, new_sentence: { type: "string" } },
                  required: ["id", "new_sentence"],
                },
              },
            },
            required: ["items"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "corrected_sentences" },
      messages: [{ role: "user", content: JSON.stringify(items, null, 2) }],
    });
    const tool = resp.content.find((c) => c.type === "tool_use");
    const input = (tool && "input" in tool ? (tool.input as { items?: unknown }) : {}) ?? {};
    results = Array.isArray(input.items) ? (input.items as typeof results) : [];
  } catch (e) {
    console.warn("[auto-rewrite] model call failed:", e);
    for (const e2 of edits) attorneyReview.push(`Needs a rewrite (automatic rewrite unavailable): ${e2.reason}`);
    return;
  }

  for (const r of results) {
    const e = edits[r.id];
    if (!e || typeof r.new_sentence !== "string") continue;
    const next = r.new_sentence.trim();
    const ratio = next.length / Math.max(1, e.sentence.length);
    const safe =
      next &&
      next !== e.sentence &&
      ratio > 0.4 &&
      ratio < 2.2 &&
      findFeeLanguage(next).length === 0 &&
      blockingAdHits(findAdTerms(next)).length === 0 &&
      !/[–—]/.test(next);
    if (!safe || !ed.replace(e.sentence, next, e.reason, e.source, e.ref)) {
      attorneyReview.push(`Needs a rewrite (automatic attempt rejected): ${e.reason}`);
    }
  }
}
