/**
 * Generation grounding (Diana's Sept 28 spec, section 5 and Appendix I):
 * drafts must be BORN clean, not cleaned up afterwards.
 *
 * Two halves:
 *   groundingBlock()  what the generator is told — the knowledge base values,
 *                     the attorney-approved statute table, the author byline,
 *                     the link map row and the Appendix I rules — so it uses
 *                     only those values and cites only those sections.
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
import { expectedAuthor, bylineFor } from "./firm-fact-findings";
import { linkRowFor } from "./link-map";
import { closingCtaFor } from "./closing-cta";
import { runLegalFactChecks } from "./legal-verify";
import { autoRewrite } from "./auto-rewrite";
import { appendRun, readFixLog, type FixLog } from "./legal-fix-log";
import { GENERAL_LEGAL_DISCLAIMER_TEXT, DISCLAIMER_URL } from "./legal-disclaimers";

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

export async function groundingBlock(args: {
  tenantId: string;
  title?: string | null;
  topic?: string | null;
  practiceArea?: string | null;
}): Promise<string> {
  const [thresholds, statutes, cta] = await Promise.all([
    getThresholds(args.tenantId).catch(() => [] as KbThresholdEntry[]),
    loadStatuteTable(args.tenantId),
    closingCtaFor(args.tenantId),
  ]);
  const text = `${args.title ?? ""} ${args.topic ?? ""}`;
  const author = expectedAuthor({ title: args.title, topic: args.topic, practiceArea: args.practiceArea });
  const links = linkRowFor(text);

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
    "- Never say how the firm or lawyers charge or what the reader will pay for representation (contingency, hourly, flat fee, retainers, \"no upfront cost\", \"without paying legal fees out of pocket\"). The only permitted cost statement is the free consultation offer. Attorney fee recovery as a statutory remedy may be stated.",
    "- Never promise or predict results; never use \"guarantee\", \"best\", \"expert\", \"specialize\", \"aggressive\" or \"maximum compensation\"; no outcome figures. If results are mentioned add \"Prior results do not guarantee a similar outcome.\"",
    "- No placeholders or bracketed notes. No schema code, JSON or scripts in the body.",
    "- Spell out New York and New Jersey (NYC is allowed in titles and keywords). No dashes of any kind. \"We\" and \"our firm\" are allowed.",
    "",
    "STRUCTURE:",
    "- Start with the line \"Attorney Advertising\", then one H1 containing the primary keyword" + (author ? `, then the byline "${bylineFor(author)}"` : "") + ".",
    "- Short paragraphs of four sentences or fewer, H2 headings that answer real questions, a practical \"what to do now\" section, and an FAQ of four to six questions.",
    links
      ? `- At least three internal links, written as full URLs with natural anchor text, including the pillar page ${links.pillar.url} and chosen from: ${links.supporting.map((l) => l.url).join(", ")}. Never make up a URL.`
      : "- At least three internal links to katzmelinger.com pages you are given. Never make up a URL.",
    `- End with "Call today at ${cta.phone} for a ${cta.offerPhrase}." and then exactly: "${GENERAL_LEGAL_DISCLAIMER_TEXT}" with "Disclaimer" linked to ${DISCLAIMER_URL}.`,
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
}): Promise<{ body: string; title: string | null; fixLog: FixLog | null; fullRedraft: string | null }> {
  try {
    const [kbFindings, statutes, cta] = await Promise.all([
      runLegalFactChecks(args.body, { tenantId: args.tenantId }).catch(() => []),
      loadStatuteTable(args.tenantId),
      closingCtaFor(args.tenantId),
    ]);
    const r = await autoRewrite({
      body: args.body,
      title: args.title,
      topic: args.topic ?? null,
      practiceArea: args.practiceArea ?? null,
      format: args.format ?? null,
      cta,
      kbFindings,
      statuteRows: statutes.ok ? statutes.rows : [],
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
    return { body: r.body, title: r.title, fixLog, fullRedraft: r.fullRedraft };
  } catch (e) {
    // The draft is still saved; the same checks run again on analysis and at
    // approve, so a failure here costs a clean first pass, not safety.
    console.warn("[generation-grounding] rewrite at generation failed:", e);
    return { body: args.body, title: args.title, fixLog: null, fullRedraft: null };
  }
}
