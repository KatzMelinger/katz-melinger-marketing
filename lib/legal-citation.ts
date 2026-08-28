/**
 * Legal citations -> the authority URL that can settle them.
 *
 * This is the front half of Rule 3. Before anything can be verified, a claim's
 * citation has to become a specific address on a source the firm has approved
 * (Diana §1). A citation this module cannot parse is NOT a failure — it is a
 * claim that routes to a human, which is the correct default.
 *
 * SCOPE IS DELIBERATELY NARROW. Only the two corpora with reliable machine
 * access are handled:
 *
 *   NY consolidated laws  — nysenate.gov, clean per-section pages
 *   Federal CFR           — ecfr.gov, a real versioned JSON API
 *
 * Both were tested against live URLs before this was written. New Jersey
 * statutes are deliberately absent: the NJ Legislature address in Diana's list
 * (lis.njleg.state.nj.us/nxt/gateway.dll) is a session-based search portal that
 * returns "<Not initialized yet>" and a search form — no statute text is
 * retrievable from it at all. Pretending otherwise would produce a citation
 * that looks checkable and silently never is.
 *
 * Everything this cannot address goes to an attorney. A checker that verifies
 * two corpora reliably is worth having; one that gestures at fifteen sources of
 * uneven quality is how a green scoreboard gets rebuilt.
 *
 * Pure module — no IO. The fetching lives in lib/legal-retrieval.ts.
 */

export type CitationCorpus =
  /** New York consolidated laws, e.g. Labor Law § 198-c. */
  | "ny_consolidated"
  /** Code of Federal Regulations, e.g. 29 CFR 825.100. */
  | "cfr"
  /** United States Code, e.g. 29 U.S.C. § 2611. */
  | "usc";

export type ParsedCitation = {
  corpus: CitationCorpus;
  /** NY law code (LAB, EXC, GBS…) or CFR/USC title number. */
  book: string;
  /** Section as written, normalised for the URL. */
  section: string;
  /** The authority URL, or null when the corpus has no retrievable address. */
  url: string | null;
  /** How the citation appeared in the draft. */
  raw: string;
};

/**
 * NY consolidated law abbreviations that appear in employment and collections
 * content. nysenate.gov keys sections by these three-letter codes.
 */
const NY_LAW_CODES: Record<string, string> = {
  "labor law": "LAB",
  "labor": "LAB",
  nyll: "LAB",
  "executive law": "EXC",
  exec: "EXC",
  "human rights law": "EXC",
  nyshrl: "EXC",
  "general business law": "GBS",
  gbl: "GBS",
  "civil practice law and rules": "CVP",
  cplr: "CVP",
  "general obligations law": "GOL",
  gol: "GOL",
  "business corporation law": "BSC",
};

/** Section identifiers keep letters and hyphens: 198-c, 2611, 825.100. */
function normaliseSection(raw: string): string {
  return raw.trim().replace(/^§+\s*/, "").replace(/\s+/g, "").replace(/[.,;]+$/, "");
}

function nySenateUrl(book: string, section: string): string {
  // nysenate.gov uppercases the section in the path: /laws/LAB/198-C
  return `https://www.nysenate.gov/legislation/laws/${book}/${section.toUpperCase()}`;
}

function ecfrUrl(title: string, section: string): string {
  // The versioner API needs a part; the reader URL addresses a section directly
  // and is what a human reviewer should be given as the source.
  const part = section.split(".")[0];
  return `https://www.ecfr.gov/current/title-${title}/part-${part}/section-${section}`;
}

/**
 * Parse one citation. Returns null when the string is not a citation this
 * module can address — which routes the claim to a human rather than
 * pretending it was checked.
 */
export function parseCitation(input: string): ParsedCitation | null {
  const raw = input.trim();
  if (!raw) return null;

  // 29 CFR 825.100 / 29 C.F.R. § 825.100
  const cfr = raw.match(/\b(\d{1,2})\s*C\.?\s*F\.?\s*R\.?\s*§?\s*([\d]+\.[\d]+[a-z]?)/i);
  if (cfr) {
    const section = normaliseSection(cfr[2]);
    return { corpus: "cfr", book: cfr[1], section, url: ecfrUrl(cfr[1], section), raw };
  }

  // 29 U.S.C. § 2611 / 29 USC 2611(2)(B)(ii)
  const usc = raw.match(/\b(\d{1,2})\s*U\.?\s*S\.?\s*C\.?\s*§?\s*(\d+[\w()]*)/i);
  if (usc) {
    const section = normaliseSection(usc[2]);
    // The USC is not served by the eCFR API and the House site has no stable
    // per-section JSON. Parsed so the claim is recognised as a citation, but
    // with no URL — which sends it to a human, correctly.
    return { corpus: "usc", book: usc[1], section, url: null, raw };
  }

  // NY: "NY Labor Law § 198-c", "NYLL 198-c", "Executive Law § 296"
  for (const [phrase, code] of Object.entries(NY_LAW_CODES)) {
    const re = new RegExp(
      `(?:N\\.?Y\\.?\\s*)?${phrase.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*§?\\s*(\\d+[\\w-]*)`,
      "i",
    );
    const m = raw.match(re);
    if (m) {
      const section = normaliseSection(m[1]);
      return { corpus: "ny_consolidated", book: code, section, url: nySenateUrl(code, section), raw };
    }
  }

  return null;
}

/** Every citation in a block of text, de-duplicated by URL/corpus+section. */
export function findCitations(body: string): ParsedCitation[] {
  if (!body) return [];
  const out: ParsedCitation[] = [];
  const seen = new Set<string>();
  // Split on sentence-ish boundaries so one citation is not swallowed by a
  // greedy match spanning several.
  for (const chunk of body.split(/(?<=[.;:\n])\s+/)) {
    const c = parseCitation(chunk);
    if (!c) continue;
    const key = `${c.corpus}|${c.book}|${c.section}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * The address the SYSTEM can fetch, which is not always the one a human cites.
 *
 * eCFR's reader pages answer a browser but 302 machine traffic to
 * unblock.federalregister.gov — a bot check. Its versioner API serves the same
 * regulation as XML and does not. So the reader URL is what a reviewer is shown
 * as the source, and this is what actually gets fetched. Conflating the two
 * would have produced a checker that silently failed on every federal
 * regulation while appearing to be configured correctly.
 *
 * `asOf` is passed in rather than read from the clock so this module stays pure
 * and the caller controls the point-in-time being asserted — which matters for
 * a regulation, where "what did this say when we published" is a real question.
 */
export function authorityFetchUrl(c: ParsedCitation, asOf: string): string | null {
  switch (c.corpus) {
    case "ny_consolidated":
      // The public section page serves clean text to machine traffic.
      return c.url;
    case "cfr": {
      const part = c.section.split(".")[0];
      return `https://www.ecfr.gov/api/versioner/v1/full/${asOf}/title-${c.book}.xml?part=${part}&section=${c.section}`;
    }
    case "usc":
      return null;
    default:
      return null;
  }
}

/**
 * Can this citation actually be checked, or must it go to a person?
 *
 * Retrievability is about the FETCH address, not the display one: a citation
 * with a perfectly good human URL and no machine route is unverifiable, and
 * saying otherwise is how a claim gets marked checked when nothing checked it.
 */
export function isRetrievable(c: ParsedCitation, asOf = "2026-01-01"): boolean {
  return authorityFetchUrl(c, asOf) !== null;
}
