/**
 * Generation grounding (Diana's Sept 28 spec, section 5 and Appendix I):
 * drafts must be BORN clean, not cleaned up afterwards.
 *
 * Two halves:
 *   groundingBlock()  what the generator is told — the knowledge base values,
 *                     the attorney-approved statute table, the author byline,
 *                     the link map row and the Appendix I rules — so it uses
 *                     only those values and cites only those sections.
 *                     It is groundingRules() (the same for every draft of a
 *                     firm, so callers put it in the cached system prefix)
 *                     plus groundingForTopic() (byline and links for this
 *                     topic, which goes after the cache breakpoint).
 *   groundAndFix()    what happens to its output before it is saved — the same
 *                     rewrite the Changes made panel runs (lib/auto-rewrite.ts),
 *                     logged the same way, so a reviewer sees what the checks
 *                     changed in a freshly generated draft too.
 *
 * Kenneth's call (2026-09-29): the cheap deterministic checks run at
 * generation; the expensive statute-verification loop stays at approve.
 */
import { getThresholds, type KbThresholdEntry } from "./legal-knowledge-base";
import { loadStatuteTable } from "./legal-statute-check";
import { linkRowFor } from "./link-map";
import { closingCtaFor } from "./closing-cta";
import { runLegalFactChecks } from "./legal-verify";
import { autoRewrite } from "./auto-rewrite";
import { loadEnabledTraps } from "./trap-gate";
import { appendRun, readFixLog, type FixLog } from "./legal-fix-log";
import { learnedCorrections, loadLearned } from "./legal-learned";
import { isFramedFormat } from "./draft-frame";
import { frameDraft } from "./draft-frame-server";

function formatValue(t: KbThresholdEntry): string {
  switch (t.unit) {
    case "usd_per_hour":
      return `$${t.currentValue.toFixed(2)} an hour`;
    case "usd_per_week":
      return `$${t.currentValue.toFixed(2)} a week`;
    case "usd_per_year":
      return `$${t.currentValue.toLocaleString()} a year`;
    case "employees":
      return t.currentValue <= 1 ? "all employers, regardless of size" : `${t.currentValue} or more employees`;
    case "years":
      return `${t.currentValue} ${t.currentValue === 1 ? "year" : "years"}`;
    default:
      return `${t.currentValue} days`;
  }
}

type TopicArgs = { title?: string | null; topic?: string | null; practiceArea?: string | null };

export async function groundingBlock(args: { tenantId: string } & TopicArgs): Promise<string> {
  return `${await groundingRules(args.tenantId)}\n\n${groundingForTopic(args)}`;
}

/**
 * The link plan for one topic: the per-draft half of the grounding. The
 * byline is the frame's (Oct 20 spec, Task A2), so the model is not given one.
 */
export function groundingForTopic(args: TopicArgs): string {
  const links = linkRowFor(`${args.title ?? ""} ${args.topic ?? ""}`);
  return [
    "THIS DRAFT:",
    links
      ? `- Internal links: include the pillar page ${links.pillar.url} and choose the rest from: ${links.supporting.map((l) => l.url).join(", ")}.`
      : "- Internal links: use katzmelinger.com pages you are given.",
  ].join("\n");
}

/**
 * The firm-wide half of the grounding: identical for every draft of a tenant
 * (knowledge base, statute table, rules, structure, closing CTA), so it can
 * sit in the cached system prefix.
 */
export async function groundingRules(tenantId: string): Promise<string> {
  const [thresholds, statutes] = await Promise.all([
    getThresholds(tenantId).catch(() => [] as KbThresholdEntry[]),
    loadStatuteTable(tenantId),
  ]);

  const kb = thresholds.length
    ? thresholds
        .map((t) => `- ${t.label}: ${formatValue(t)}${t.effectiveDate ? ` (since ${t.effectiveDate})` : ""}`)
        .join("\n")
    : "- (none loaded)";
  const table = statutes.ok && statutes.rows.length
    ? statutes.rows.map((r) => `- ${r.citation}: ${r.covers}${r.notCovers ? ` NOT: ${r.notCovers}` : ""}`).join("\n")
    : "- (the statute table is not loaded yet: cite no section numbers at all)";

  return [
    "LEGAL FACTS (the firm's knowledge base; use ONLY these values for deadlines, thresholds and wage figures):",
    kb,
    "",
    "STATUTE TABLE (cite a section ONLY if it is listed here, and ONLY for what it covers):",
    table,
    "If a fact you need is not listed above, write around it in general terms or leave it out. Never invent a deadline, threshold, dollar amount, statute section, case name, statistic or quote.",
    "",
    "FIRM RULES:",
    "- In employment law the firm represents employees only. In commercial collections and judgment enforcement it represents creditors and businesses only. Write for that reader, never the other side.",
    "- Never say how the firm or lawyers charge or what the reader will pay for representation (contingency, hourly, flat fee, retainers, \"no upfront cost\", \"without paying legal fees out of pocket\"). Never write \"free consultation\" or what lawyers in general offer; the only offer is \"Free Confidential Case Evaluation\", and the system adds it in the closing call to action. Attorney fee recovery as a statutory remedy may be stated.",
    "- Never promise or predict results; never use \"guarantee\", \"best\", \"expert\", \"specialize\", \"aggressive\" or \"maximum compensation\"; no outcome figures. If results are mentioned add \"Prior results do not guarantee a similar outcome.\"",
    "- No placeholders or bracketed notes. No schema code, JSON or scripts in the body.",
    "- Spell out New York and New Jersey (NYC is allowed in titles and keywords). No em dashes or en dashes; hyphens are fine where grammatically correct. Write as \"we\" and \"our firm\".",
    "",
    "STRUCTURE (write the article only):",
    "- One H1 (# ) containing the primary keyword.",
    "- Directly under the H1, one bold paragraph of 60 words or fewer that answers the H1 question in its first sentence.",
    "- A short intro, then H2 (## ) sections that answer real questions, including a practical \"what to do now\" section and, where it fits, a section of at least five concrete signs the reader may have a case.",
    "- An H2 \"Frequently Asked Questions\" with four to six questions, each as an H3 (### ) followed by an answer of 80 words or fewer.",
    "- Short paragraphs of four sentences or fewer.",
    "- At least three internal links, written as full URLs with natural anchor text, from the pages listed under THIS DRAFT. Never make up a URL.",
    "- Do not write a disclaimer, call to action, phone number, byline, author section, contact details or SEO notes (keywords, meta title, meta description, slug, search intent). The system adds them.",
    "Before you finish, check your draft against every rule above and correct it.",
  ].join("\n");
}

/**
 * Run the rewrite on freshly generated text. Returns the corrected text and
 * the change log to store as metadata.legal_fix_log.
 */
export async function groundAndFix(args: {
  tenantId: string;
  body: string;
  title: string | null;
  topic?: string | null;
  practiceArea?: string | null;
  format?: string | null;
  /** "es" puts the page in the Spanish frame. */
  language?: string | null;
  /** The pillar, for the reviewing attorney in the byline (Task A2). */
  pillarId?: string | null;
}): Promise<{
  body: string;
  title: string | null;
  fixLog: FixLog | null;
  fullRedraft: string | null;
  /** metadata.content and metadata.frame for a website draft (Task A1); merge into the saved metadata. */
  frameMeta: Record<string, unknown> | null;
}> {
  const framedFormat = isFramedFormat(args.format);
  // Oct 20 spec, Task A1: a website draft is saved in its frame. The article
  // is read out of the generated text and the label, byline, CTA and
  // disclaimer are built from Brand settings, whatever the model wrote.
  const frame = async (body: string, title: string | null) => {
    if (!framedFormat) return { body, frameMeta: null };
    const framed = await frameDraft(args.tenantId, {
      body,
      title,
      topic: args.topic ?? null,
      format: args.format ?? null,
      practice_area: args.practiceArea ?? null,
      metadata: { ...(args.language ? { language: args.language } : {}), ...(args.pillarId ? { pillar_id: args.pillarId } : {}) },
    });
    return framed
      ? { body: framed.body, frameMeta: { content: framed.metadata.content, frame: framed.metadata.frame, schema_jsonld: framed.metadata.schema_jsonld } }
      : { body, frameMeta: null };
  };
  try {
    const [kbFindings, statutes, cta, traps, learned] = await Promise.all([
      runLegalFactChecks(args.body, { tenantId: args.tenantId }).catch(() => []),
      loadStatuteTable(args.tenantId),
      closingCtaFor(args.tenantId),
      loadEnabledTraps(args.tenantId),
      loadLearned(args.tenantId),
    ]);
    const r = await autoRewrite({
      body: args.body,
      title: args.title,
      topic: args.topic ?? null,
      practiceArea: args.practiceArea ?? null,
      format: args.format ?? null,
      language: args.language ?? null,
      cta,
      kbFindings,
      statuteRows: statutes.ok ? statutes.rows : [],
      traps: traps.traps,
      trapCtx: { title: args.title, topic: args.topic ?? null, isWebPage: true },
      learnedCorrections: learnedCorrections(learned),
      framed: framedFormat,
    });
    const fixLog =
      r.changes.length || r.fullRedraft
        ? appendRun(readFixLog(null), {
            previousTitle: args.title,
            previousBody: args.body,
            changes: r.changes,
            fullRedraft: r.fullRedraft,
          })
        : null;
    const f = await frame(r.body, r.title);
    return { body: f.body, title: r.title, fixLog, fullRedraft: r.fullRedraft, frameMeta: f.frameMeta };
  } catch (e) {
    // The draft is still saved; the same checks run again on analysis and at
    // approve, so a failure here costs a clean first pass, not safety.
    console.warn("[generation-grounding] rewrite at generation failed:", e);
    const f = await frame(args.body, args.title).catch(() => ({ body: args.body, frameMeta: null }));
    return { body: f.body, title: args.title, fixLog: null, fullRedraft: null, frameMeta: f.frameMeta };
  }
}
