/**
 * The draft frame (Diana's Oct 20 spec, Task A1): the AI writes the article,
 * Huraqan builds everything around it.
 *
 * A website draft is stored twice:
 *   metadata.content   the article only (DraftContent): H1, direct answer,
 *                      intro, sections, FAQ, case result. No label, byline,
 *                      CTA, disclaimer, SEO notes or schema, ever.
 *   body               assembleDraft(content, frame): the article inside the
 *                      locked frame, in this exact order:
 *
 *                        *Attorney Advertising*
 *                        # {h1}
 *                        {byline}                     (Task A2)
 *                        **{direct_answer}**
 *                        {intro}
 *                        ## {section} ...
 *                        ## Frequently Asked Questions
 *                        {case result} + results disclaimer, when a result is described
 *                        **{CTA}**
 *                        *{disclaimer}*
 *
 * assembleDraft is the only code that writes those frame lines. Brand
 * settings (phone, offer phrase, label, disclaimer link, reviewers) feed the
 * frame, so changing one and re-assembling changes every open draft; no draft
 * keeps its own copy of a locked element.
 *
 * splitDraft goes the other way: it reads any Markdown body, throws away
 * every frame element wherever it sits (label, bylines, CTAs, disclaimers,
 * results lines, "Target keywords:" and other SEO notes, schema code, the
 * "About the Author" box) and returns the article. It is how a generator's
 * output, a person's edit and an old draft all become content: the model
 * writes Markdown with headings and this parser, not the model, builds the
 * structure, so a frame element the model writes anyway can never survive.
 *
 * Pure: no IO. The loaders live in lib/draft-frame-server.ts.
 */

import {
  ATTORNEY_ADVERTISING_LABEL,
  GENERAL_LEGAL_DISCLAIMER,
  RESULTS_DISCLAIMER,
  SPANISH_ATTORNEY_ADVERTISING_LABEL,
  SPANISH_RESULTS_DISCLAIMER,
  closingCta,
  isDisclaimerLine,
  looksLikeCaseResult,
  plain,
  spanishClosingCta,
  spanishGeneralDisclaimer,
  stripCtaFromLine,
  telHref,
} from "./legal-disclaimers";

/** The formats that carry the frame: the website generators (Task A1). */
export const FRAMED_FORMATS = ["blog", "km_page_update", "km_practice_page", "km_blog_post"] as const;

export function isFramedFormat(format: string | null | undefined): boolean {
  return !!format && (FRAMED_FORMATS as readonly string[]).includes(format);
}

export type SectionKind = "standard" | "signs_you_may_have_a_case" | "deadlines_table";

export type DraftContent = {
  version: 1;
  h1: string;
  /** 60 words or fewer, answers the H1 question; shown in bold under the byline. */
  direct_answer: string;
  /** Markdown, no headings. */
  intro: string;
  sections: { h2: string; body: string; kind: SectionKind }[];
  faq: { q: string; a: string }[];
  case_result: { present: boolean; text: string };
  /** The FAQ heading as written ("Frequently Asked Questions About Severance"). */
  faq_heading?: string;
  /** The page carried the results disclaimer: it keeps it (never silently dropped). */
  results_disclaimer?: boolean;
};

export type FrameByline =
  | { state: "none" }
  /** Before the attorney clears it: shown in Huraqan only, never publishable. */
  | { state: "pending"; attorney: string | null }
  | { state: "reviewed"; attorney: string; bioUrl: string | null; clearedAt: string };

export type FrameBrand = {
  language: "en" | "es";
  phone: string;
  offerPhrase: string;
  /** Spanish offer phrase, used on Spanish pages. */
  offerPhraseEs: string;
  /** Where the Spanish "Aviso Legal" links (brand setting spanishDisclaimerUrl). */
  spanishDisclaimerUrl?: string | null;
};

export type FrameOptions = {
  format?: string | null;
  byline: FrameByline;
};

/* ------------------------------------------------------------------------- */
/* The frame lines                                                           */
/* ------------------------------------------------------------------------- */

export function frameLabelLine(brand: FrameBrand): string {
  return `*${brand.language === "es" ? SPANISH_ATTORNEY_ADVERTISING_LABEL : ATTORNEY_ADVERTISING_LABEL}*`;
}

/** The CTA, with the number as a tel: link (Oct 20 spec, Part 2 item 10). */
export function frameCtaLine(brand: FrameBrand): string {
  const linked = `[${brand.phone}](${telHref(brand.phone)})`;
  const sentence =
    brand.language === "es"
      ? spanishClosingCta(brand.phone, brand.offerPhraseEs)
      : closingCta(brand.phone, brand.offerPhrase);
  return `**${sentence.replace(brand.phone, linked)}**`;
}

export function frameDisclaimerLine(brand: FrameBrand): string {
  return `*${brand.language === "es" ? spanishGeneralDisclaimer(brand.spanishDisclaimerUrl ?? undefined) : GENERAL_LEGAL_DISCLAIMER}*`;
}

export function frameResultsLine(brand: FrameBrand): string {
  return `*${brand.language === "es" ? SPANISH_RESULTS_DISCLAIMER : RESULTS_DISCLAIMER}*`;
}

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "October 2026", the month of the clearance in New York time. */
export function monthYear(iso: string, language: "en" | "es" = "en"): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric" }).formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = Number(parts.find((p) => p.type === "month")?.value ?? "1") - 1;
  return language === "es" ? `${MONTHS_ES[m]} de ${y}` : `${MONTHS_EN[m]} ${y}`;
}

/**
 * The byline (Task A2). Before clearance: "Pending attorney review: Adam
 * Sackowitz", which blocks publishing. After: "Reviewed by [Adam
 * Sackowitz](bio), Esq. | Last updated October 2026".
 */
export function frameBylineLine(byline: FrameByline, language: "en" | "es" = "en"): string | null {
  if (byline.state === "none") return null;
  if (byline.state === "pending") {
    const who = byline.attorney ?? "practice area not set";
    return language === "es" ? `*Pendiente de revisión por abogado: ${who}*` : `*Pending attorney review: ${who}*`;
  }
  const name = byline.bioUrl ? `[${byline.attorney}](${byline.bioUrl})` : byline.attorney;
  return language === "es"
    ? `Revisado por ${name}, Esq. | Última actualización: ${monthYear(byline.clearedAt, "es")}`
    : `Reviewed by ${name}, Esq. | Last updated ${monthYear(byline.clearedAt, "en")}`;
}

function faqHeading(language: "en" | "es"): string {
  return language === "es" ? "Preguntas frecuentes" : "Frequently Asked Questions";
}

/* ------------------------------------------------------------------------- */
/* Assemble                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * The published body. The only code allowed to write the label, byline, CTA,
 * results line and disclaimer. Practice pages carry the CTA after the first
 * section and mid page as well as at the end, at most three, all from Brand
 * settings (Kenneth, 2026-10-20); every other page carries it once.
 */
export function assembleDraft(content: DraftContent, brand: FrameBrand, opts: FrameOptions): string {
  const cta = frameCtaLine(brand);
  const parts: string[] = [frameLabelLine(brand), `# ${content.h1.trim()}`];
  const byline = frameBylineLine(opts.byline, brand.language);
  if (byline) parts.push(byline);
  if (content.direct_answer.trim()) parts.push(`**${content.direct_answer.trim()}**`);
  if (content.intro.trim()) parts.push(content.intro.trim());

  const midCtas = new Set<number>();
  if (opts.format === "km_practice_page" && content.sections.length >= 2) {
    midCtas.add(0);
    if (content.sections.length >= 4) midCtas.add(Math.floor(content.sections.length / 2));
  }
  content.sections.forEach((s, i) => {
    parts.push(s.body.trim() ? `## ${s.h2.trim()}\n\n${s.body.trim()}` : `## ${s.h2.trim()}`);
    if (midCtas.has(i)) parts.push(cta);
  });

  if (content.faq.length > 0) {
    parts.push(`## ${content.faq_heading?.trim() || faqHeading(brand.language)}`);
    for (const f of content.faq) parts.push(`### ${f.q.trim()}\n\n${f.a.trim()}`);
  }

  const prose = [content.intro, ...content.sections.map((s) => s.body), ...content.faq.map((f) => f.a)].join("\n");
  if (content.case_result.present && content.case_result.text.trim()) parts.push(content.case_result.text.trim());
  if ((content.case_result.present && content.case_result.text.trim()) || content.results_disclaimer || looksLikeCaseResult(prose)) {
    parts.push(frameResultsLine(brand));
  }

  parts.push(cta);
  parts.push(frameDisclaimerLine(brand));
  return parts.join("\n\n") + "\n";
}

/* ------------------------------------------------------------------------- */
/* Split                                                                     */
/* ------------------------------------------------------------------------- */

export type SplitResult = {
  content: DraftContent;
  /** Frame elements and notes dropped from the body, for the change report. */
  removed: { kind: "label" | "byline" | "cta" | "disclaimer" | "results" | "seo_note" | "schema" | "author_box" | "contact"; text: string }[];
  /** SEO values the body carried as notes ("Meta title: ..."), keyed by field. */
  seoNotes: Partial<Record<"primaryKeyword" | "secondaryKeywords" | "metaTitle" | "metaDescription" | "slug" | "searchIntent", string>>;
};

const LABEL_LINE = /^(?:attorney advertising|publicidad de abogados)\.?$/;
const LABEL_TOKEN = /\*{1,2}\s*(?:Attorney Advertising|Publicidad de abogados)\.?\s*\*{1,2}/gi;
const RESULTS_LINE = /^(?:prior results do not guarantee a similar outcome|los resultados anteriores no garantizan un resultado similar)/;

const SEO_NOTE = /^\s*(?:[-*>]\s*)?[*_]*\s*(target keywords?|primary keywords?|focus keyphrase|secondary keywords?|meta titles?|seo titles?|title tag|meta descriptions?|url slug|slug|search intent)\s*[*_]*\s*:\s*[*_]*\s*(.*)$/i;
const SEO_FIELD: Record<string, keyof SplitResult["seoNotes"]> = {
  "target keyword": "primaryKeyword",
  "target keywords": "primaryKeyword",
  "primary keyword": "primaryKeyword",
  "primary keywords": "primaryKeyword",
  "focus keyphrase": "primaryKeyword",
  "secondary keyword": "secondaryKeywords",
  "secondary keywords": "secondaryKeywords",
  "meta title": "metaTitle",
  "meta titles": "metaTitle",
  "seo title": "metaTitle",
  "seo titles": "metaTitle",
  "title tag": "metaTitle",
  "meta description": "metaDescription",
  "meta descriptions": "metaDescription",
  "url slug": "slug",
  slug: "slug",
  "search intent": "searchIntent",
};

/**
 * A byline line: short, and carrying an author marker. "By filing a
 * complaint, you..." is prose and stays.
 */
function isBylineLine(line: string): boolean {
  const t = line.replace(/[*_]/g, "").trim();
  if (!t || t.length > 200) return false;
  if (/^(?:pending attorney review|pendiente de revisi[oó]n por abogado)\b/i.test(t)) return true;
  if (/^(?:(?:content\s+)?reviewed by|revisado por)\s+\[?[A-Z]/i.test(t)) return true;
  if (/^(?:[Bb]y|[Pp]or)\s+\[?[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}\]?/.test(t)) {
    return /Katz Melinger|katzmelinger\.com\/attorney\/|\bEsq\b|^(?:by|por)\s+\[?[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}\]?(?:\([^)]*\))?\s*$/i.test(t);
  }
  return /^last updated\b/i.test(t) && t.length < 60;
}

const FAQ_HEADING = /^(?:frequently asked questions|faqs?|preguntas frecuentes)\b/i;
const SIGNS_HEADING = /\b(?:signs (?:that )?you (?:may|might) have a case|do i have a case|signs of a (?:strong )?case|se[nñ]ales de que)/i;

function kindFor(h2: string, body: string): SectionKind {
  if (SIGNS_HEADING.test(h2)) return "signs_you_may_have_a_case";
  if (/\bdeadlines?\b|\bstatutes? of limitations?\b|\bplazos?\b/i.test(h2) && /^\s*\|.*\|\s*$/m.test(body)) return "deadlines_table";
  return "standard";
}

/** "### Question" blocks, or "**Question?**" lines followed by the answer. */
function parseFaq(body: string): { q: string; a: string }[] | null {
  const lines = body.split("\n");
  const out: { q: string; a: string }[] = [];
  let cur: { q: string; a: string[] } | null = null;
  let sawQuestion = false;
  for (const raw of lines) {
    const h3 = raw.match(/^#{3,4}\s+(.+?)\s*$/);
    const bold = raw.match(/^\s*(?:\*\*|__)(?:Q:\s*)?(.+?\?)\s*(?:\*\*|__)\s*(.*)$/);
    if (h3 || bold) {
      if (cur) out.push({ q: cur.q, a: cur.a.join("\n").trim() });
      sawQuestion = true;
      cur = { q: (h3 ? h3[1] : bold![1]).replace(/^Q:\s*/i, "").trim(), a: bold && bold[2] ? [bold[2]] : [] };
      continue;
    }
    if (!cur) {
      if (raw.trim()) return null; // prose before the first question: not a parseable FAQ
      continue;
    }
    cur.a.push(raw.replace(/^\s*A:\s*/i, ""));
  }
  if (cur) out.push({ q: cur.q, a: cur.a.join("\n").trim() });
  if (!sawQuestion || out.some((f) => !f.q || !f.a)) return null;
  return out;
}

/** Remove schema code (JSON-LD in a code fence or a script tag). */
function stripSchema(body: string, removed: SplitResult["removed"]): string {
  return body
    .replace(/```[a-z]*\n[\s\S]*?```/gi, (m) => {
      if (!/@context|"@type"/.test(m)) return m;
      removed.push({ kind: "schema", text: m.slice(0, 200) });
      return "";
    })
    .replace(/<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi, (m) => {
      removed.push({ kind: "schema", text: m.slice(0, 200) });
      return "";
    });
}

/**
 * Any body to content. Lossless for the article: every paragraph that is not a
 * frame element or note lands in the intro, a section or the FAQ.
 */
export function splitDraft(body: string, opts: { title?: string | null } = {}): SplitResult {
  const removed: SplitResult["removed"] = [];
  const seoNotes: SplitResult["seoNotes"] = {};
  const text = stripSchema((body ?? "").replace(/\r\n?/g, "\n"), removed);

  // 1. Drop the frame line by line.
  const kept: string[] = [];
  let inAuthorBox = false;
  for (const raw of text.split("\n")) {
    let line = raw;
    if (/^##\s+(?:about the author|sobre el autor)\b/i.test(line.trim())) {
      inAuthorBox = true;
      removed.push({ kind: "author_box", text: line.trim() });
      continue;
    }
    if (inAuthorBox) {
      if (/^#{1,2}\s+/.test(line.trim())) inAuthorBox = false;
      else continue;
    }
    const p = plain(line);
    if (LABEL_LINE.test(p)) {
      removed.push({ kind: "label", text: raw });
      continue;
    }
    if (new RegExp(LABEL_TOKEN.source, "i").test(line)) {
      line = line.replace(LABEL_TOKEN, "").trimEnd();
      removed.push({ kind: "label", text: raw });
      if (!plain(line)) continue;
    }
    // A byline run into the first sentence ("Katz Melinger PLLCClients worked
    // for four months", Oct 20 spec, Task A1): the byline goes, the sentence stays.
    const glued = line.match(/^(\s*[*_]*\s*(?:By|Por)\s+\S[^\n]*?Katz Melinger PLLC[*_]*)\s*([A-Z][^\n]*)$/);
    if (glued && isBylineLine(glued[1])) {
      removed.push({ kind: "byline", text: glued[1] });
      line = glued[2];
    } else if (isBylineLine(line)) {
      removed.push({ kind: "byline", text: raw });
      continue;
    }
    const seo = line.match(SEO_NOTE);
    if (seo) {
      const field = SEO_FIELD[seo[1].toLowerCase()];
      const value = seo[2].replace(/[*_]+$/g, "").trim();
      if (field && value && !seoNotes[field]) seoNotes[field] = value;
      removed.push({ kind: "seo_note", text: raw });
      continue;
    }
    if (isDisclaimerLine(plain(line))) {
      removed.push({ kind: "disclaimer", text: raw });
      continue;
    }
    if (RESULTS_LINE.test(plain(line))) {
      removed.push({ kind: "results", text: raw });
      continue;
    }
    const noCta = stripCtaFromLine(line);
    if (noCta !== line) {
      removed.push({ kind: "cta", text: raw });
      if (!plain(noCta)) continue;
      line = noCta;
    }
    kept.push(line);
  }

  // A pasted contact block (address, phone, email): the AI is told not to
  // write contact details, and the CTA carries the number (Task A1).
  // Only the contact lines and sentences go: a paragraph that also says
  // something keeps it, and a sentence that merely names a street in passing
  // ("the EEOC's office at 33 Whitehall Street") is prose.
  const CONTACT_MARKS = [
    /Lexington Avenue|Suite 1512|NY 10017/i,
    // The firm's own numbers only; an agency's number in a sentence is prose.
    /\(?212\)?\D{0,2}460\D?0047|\(?646\)?\D{0,2}(?:692\D?0511|466\D?6267|849\D?3352|907\D?6246|798\D?4717)/,
    /info@katzmelinger\.com/i,
    /\bwww\.katzmelinger\.com\b/i,
  ];
  const marksIn = (t: string) => CONTACT_MARKS.filter((re) => re.test(t)).length;
  const isContact = (t: string) => {
    const m = marksIn(t);
    return m >= 2 || (m >= 1 && plain(t).length < 90) || /^\W*Katz Melinger PLLC\W*$/i.test(t.trim());
  };
  const paragraphs = kept
    .join("\n")
    .split(/\n\s*\n/)
    .map((para) => {
      if (/^\s*(?:#|\||```)/.test(para) || marksIn(para) === 0) return para;
      const lines = para.split("\n").filter((l) => {
        // Whole lines only when short (an address block); a long line is
        // filtered sentence by sentence below.
        if (/^\s*(?:#|\|)/.test(l) || plain(l).length >= 120 || !isContact(l)) return true;
        removed.push({ kind: "contact", text: l.trim() });
        return false;
      });
      return lines
        .map((l) =>
          marksIn(l) === 0
            ? l
            : l
                .split(/(?<=[.!?])\s+/)
                .filter((sentence) => {
                  if (!isContact(sentence)) return true;
                  removed.push({ kind: "contact", text: sentence.trim() });
                  return false;
                })
                .join(" "),
        )
        .filter((l) => plain(l))
        .join("\n");
    })
    .filter((para) => plain(para));

  // 2. Headings: one H1, H2 sections, the FAQ.
  const lines = paragraphs.join("\n\n").replace(/\n{3,}/g, "\n\n").split("\n");
  let h1 = "";
  const pre: string[] = [];
  const sections: { h2: string; lines: string[] }[] = [];
  for (const line of lines) {
    const m1 = line.match(/^#\s+(.+?)\s*#*\s*$/);
    const m2 = line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (/^#{1,6}\s*$/.test(line)) continue; // an empty heading
    if (m1 && !h1 && sections.length === 0) {
      h1 = m1[1].trim();
      continue;
    }
    if (m1 || m2) {
      sections.push({ h2: (m1 ?? m2)![1].trim(), lines: [] });
      continue;
    }
    if (sections.length) sections[sections.length - 1].lines.push(line);
    else pre.push(line);
  }

  // 3. The direct answer: a paragraph that is bold all the way through, first after the H1.
  const prePara = pre.join("\n").trim().split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  // A bold paragraph among the first two (a byline glued to a sentence can
  // leave that sentence ahead of it).
  let directAnswer = "";
  const allBold = (p: string) => /^(\*\*|__)(?!\s)[\s\S]+?\1$/.test(p) && !/^(\*\*|__)[\s\S]*\1[\s\S]*\1[\s\S]*\1$/.test(p);
  const da = prePara.slice(0, 2).findIndex(allBold);
  if (da !== -1) {
    directAnswer = prePara.splice(da, 1)[0].replace(/^(\*\*|__)|(\*\*|__)$/g, "").trim();
  }

  const content: DraftContent = {
    version: 1,
    h1: h1 || (opts.title ?? "").trim(),
    direct_answer: directAnswer,
    intro: prePara.join("\n\n"),
    sections: [],
    faq: [],
    case_result: { present: false, text: "" },
    ...(removed.some((r) => r.kind === "results") ? { results_disclaimer: true } : {}),
  };
  for (const s of sections) {
    const body = s.lines.join("\n").trim();
    if (FAQ_HEADING.test(s.h2) && content.faq.length === 0) {
      const faq = parseFaq(body);
      if (faq) {
        content.faq = faq;
        content.faq_heading = s.h2;
        continue;
      }
    }
    if (!body && !s.h2) continue;
    content.sections.push({ h2: s.h2, body, kind: kindFor(s.h2, body) });
  }
  return { content, removed, seoNotes };
}

export function readContent(meta: Record<string, unknown> | null | undefined): DraftContent | null {
  const c = meta?.content as DraftContent | undefined;
  return c && typeof c === "object" && c.version === 1 && typeof c.h1 === "string" && Array.isArray(c.sections) ? c : null;
}

/** split then assemble: any body into the frame. Idempotent. */
export function reframeBody(
  body: string,
  brand: FrameBrand,
  opts: FrameOptions & { title?: string | null },
): { body: string; split: SplitResult } {
  const split = splitDraft(body, { title: opts.title });
  return { body: assembleDraft(split.content, brand, opts), split };
}

/** Lines that are frame (label, byline, CTA, results, disclaimer) in an assembled body. */
export function frameLines(brand: FrameBrand, opts: FrameOptions): string[] {
  return [
    frameLabelLine(brand),
    frameBylineLine(opts.byline, brand.language),
    frameCtaLine(brand),
    frameResultsLine(brand),
    frameDisclaimerLine(brand),
  ].filter((l): l is string => !!l);
}
