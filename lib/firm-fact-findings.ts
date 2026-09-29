/**
 * Firm facts as findings (Diana's Sept 28 spec, section 4 and Appendices C, D).
 *
 * Pure, no IO: a regex pass run by analyzeDraft on every draft and so, through
 * the findings table, by every gate that reads open Critical findings. Filed
 * under `compliance` beside the fee rule (lib/fee-language.ts), which already
 * owns "how the firm charges" — firm facts are the same kind of claim.
 *
 *   firm_managing_partner  Critical. Anyone but Kenneth Katz called managing partner.
 *   firm_author            Critical when the byline names the wrong attorney for
 *                          the practice area; important when there is none.
 *   firm_statistic         Critical. A statistic presented as fact with no source.
 *   firm_off_practice      Critical, "Full redraft needed". Written to the side the
 *                          firm does not represent, or a fee-topic article.
 *   firm_name              Critical. "Katz Melinger, PLLC" / "PLLG".
 *
 * Fee language itself is NOT here (content-compliance.ts runs findFeeLanguage),
 * and neither are outcome figures ("six figure", "substantial damages"), which
 * are a known trap — each concern has one owner so nothing is filed twice.
 */
import { fingerprintFinding, type NormalizedFinding } from "./content-findings";
import { checkAudienceAngle, normalizePracticeArea } from "./audience-angle";
import { ADAM_SACKOWITZ, KENNETH_KATZ, NICOLE_GRUNFELD, type Author } from "./authors";

type Ctx = { title?: string | null; topic?: string | null; practiceArea?: string | null };

function finding(
  ruleId: string,
  severity: NormalizedFinding["severity"],
  title: string,
  excerpt: string,
  detail: string,
  fix: string | null,
): NormalizedFinding {
  return {
    fingerprint: fingerprintFinding("compliance", ruleId, excerpt),
    source: "compliance",
    ruleId,
    severity,
    title,
    detail,
    excerpt: excerpt.slice(0, 300),
    fix,
  };
}

function sentences(body: string): string[] {
  return body
    .replace(/\b(?:[A-Z]\.){2,}/g, (m) => m.replace(/\./g, "\u0000"))
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/\u0000/g, ".").trim())
    .filter(Boolean);
}

/** Appendix D: the author is chosen by practice area, never by the generator. */
export function expectedAuthor(ctx: Ctx): Author | null {
  const text = `${ctx.title ?? ""} ${ctx.topic ?? ""}`;
  if (/judgment/i.test(text) && !/employ/i.test(text)) return KENNETH_KATZ;
  const area = normalizePracticeArea(ctx.practiceArea) ?? normalizePracticeArea(text);
  if (area === "employment") return NICOLE_GRUNFELD;
  if (area === "collections") return ADAM_SACKOWITZ;
  // Civil litigation pages that are not collections carry no byline (Diana,
  // Appendix D) — and an unmapped topic has no rule to enforce.
  return null;
}

/** "Nicole D. Grunfeld" and "Nicole Grunfeld" are the same byline. */
function sameName(a: string, b: string): boolean {
  const key = (s: string) =>
    s
      .replace(/,?\s*Esq\.?/i, "")
      .split(/\s+/)
      .filter((w) => !/^[A-Z]\.$/.test(w))
      .map((w) => w.toLowerCase())
      .join(" ");
  return key(a) === key(b);
}

export function bylineFor(author: Author): string {
  const short = author.name.replace(/\s+[A-Z]\.\s+/, " ");
  return `By ${short}, Katz Melinger PLLC`;
}

const BYLINE_RE = /^\s*[*_]*\s*By\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})(?:,\s*Esq\.?)?/m;
const MANAGING_PARTNER_RE = /managing\s+partner/i;
const STATISTIC_RE =
  /\b\d{1,3}(?:\.\d+)?\s*(?:%|percent)\s+of\s+(?:all\s+)?(?:\w+\s+){0,2}(?:employees|workers|cases|clients|claims|people|Americans|New\s+Yorkers|women|men|employers|businesses|companies|respondents|plaintiffs)\b|\b(?:studies|statistics|research|surveys?|data)\s+(?:show|shows|suggest|suggests|indicate|indicates|found|find)\b/i;
const SOURCE_RE = /https?:\/\/|\baccording\s+to\b|\bsource:|\breport(?:ed|s)?\s+by\b|\bBureau\s+of\b|\bDepartment\s+of\s+Labor\b|\bEEOC\s+(?:data|reports?)\b/i;
const FEE_TOPIC_RE = /\b(how\s+much\s+(?:does|do|will)|cost\s+of|costs?\b|fee\s+structures?|attorney['’]?s?\s+fees|contingency|hourly\s+rate)/i;

export function firmFactFindings(body: string, ctx: Ctx = {}): NormalizedFinding[] {
  if (!body?.trim()) return [];
  const out: NormalizedFinding[] = [];

  // Managing partner: Kenneth Katz only.
  for (const s of sentences(body)) {
    if (MANAGING_PARTNER_RE.test(s) && !/Kenneth\s+(?:J\.\s+)?Katz/i.test(s)) {
      out.push(
        finding(
          "firm_managing_partner",
          "critical",
          "Only Kenneth Katz is the managing partner",
          s,
          "Appendix C: the managing partner is Kenneth Katz. No other person may carry that title.",
          "Remove the managing partner title from this person, or name Kenneth Katz. Change nothing else.",
        ),
      );
    }
  }

  // Author byline by practice area.
  const expected = expectedAuthor(ctx);
  if (expected) {
    const m = body.match(BYLINE_RE);
    if (m) {
      const named = m[1].trim();
      if (!sameName(named, expected.name)) {
        out.push(
          finding(
            "firm_author",
            "critical",
            `Wrong author: this is ${expected.name.replace(/\s+[A-Z]\.\s+/, " ")}'s practice area`,
            m[0].trim(),
            `Appendix D: bylines follow the practice area. The byline names ${named}.`,
            `Replace the byline with "${bylineFor(expected)}". Change nothing else.`,
          ),
        );
      }
    } else {
      out.push(
        finding(
          "firm_author",
          "important",
          "No author byline",
          "",
          `Appendix D: every blog and web page carries the practice area's author byline.`,
          `Add "${bylineFor(expected)}" under the H1.`,
        ),
      );
    }
  }

  // Unsourced statistics.
  for (const s of sentences(body)) {
    if (STATISTIC_RE.test(s) && !SOURCE_RE.test(s)) {
      out.push(
        finding(
          "firm_statistic",
          "critical",
          "Statistic presented as fact with no source",
          s,
          "Sept 28 spec 10.3: a percentage or figure presented as fact must cite a primary source in the same sentence.",
          null,
        ),
      );
    }
  }

  // Off practice: the wrong audience, or a fee-topic article.
  const area = normalizePracticeArea(ctx.practiceArea) ?? normalizePracticeArea(`${ctx.title ?? ""} ${ctx.topic ?? ""}`);
  const angle = checkAudienceAngle(`${ctx.title ?? ""}\n${body}`, area);
  if (angle) {
    out.push(
      finding(
        "firm_off_practice",
        "critical",
        area === "collections"
          ? "Full redraft needed: written to debtors (the firm represents creditors)"
          : "Full redraft needed: written to employers (the firm represents employees)",
        angle.matched,
        "Sept 28 spec section 4: employment content is employee side only; collections content is creditor side only. A draft for the wrong audience is regenerated, not patched sentence by sentence.",
        null,
      ),
    );
  }
  const title = ctx.title ?? ctx.topic ?? "";
  if (FEE_TOPIC_RE.test(title) && /\b(lawyer|attorney|law firm)s?\b/i.test(title)) {
    out.push(
      finding(
        "firm_off_practice",
        "critical",
        "Off practice: the whole topic is fees, which the firm never publishes",
        title,
        "Sept 28 spec 10.5: archive this draft (reason: Off practice).",
        null,
      ),
    );
  }

  // Firm name.
  const badName = body.match(/Katz\s+Melinger,\s+PLLC|Katz\s+Melinger\s+PLLG|Katz-Melinger|KatzMelinger(?!\.com)/);
  if (badName) {
    out.push(
      finding(
        "firm_name",
        "critical",
        'Firm name must read "Katz Melinger PLLC"',
        badName[0],
        "Appendix C: the firm name is Katz Melinger PLLC, no comma, no hyphen.",
        `Replace "${badName[0]}" with "Katz Melinger PLLC". Change nothing else.`,
      ),
    );
  }

  return out;
}
