/**
 * HARO (Help a Reporter Out) digest parser.
 *
 * Splits a pasted HARO email body into individual journalist queries.
 * HARO sends 3 emails per business day (5am/12:30pm/5:30pm ET); each
 * contains 30-50 numbered queries in a consistent format:
 *
 *   1) [BIZ] Summary line
 *   Summary: Looking for HR experts to discuss workplace conflict
 *   Category: Business and Finance
 *   Email: query-12345@helpareporter.com
 *   Media Outlet: Anonymous
 *   Deadline: 7:00 PM EST - 14 May
 *   Query:
 *       Need quotes from HR experts on...
 *   Requirements:
 *       - HR professional with 5+ years
 *
 * The parser is intentionally lenient — HARO's format has drifted slightly
 * since the 2025 Featured.com relaunch, so we use labeled-field matching
 * rather than strict positional parsing.
 */

export type HaroQuery = {
  number: number;
  summary: string;
  category: string;
  email: string;
  outlet: string;
  deadline: string;
  query: string;
  requirements: string;
};

function extractField(block: string, label: string): string {
  // Match "Label: value" or "Label:\n value" — value continues until the
  // next labeled field or a blank line followed by another label.
  const re = new RegExp(
    `${label}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:Summary|Category|Email|Media\\s*Outlet|Deadline|Query|Requirements)\\s*:|$)`,
    "i",
  );
  const m = block.match(re);
  return m ? m[1].trim().replace(/\s+/g, " ") : "";
}

/**
 * Parse a full HARO digest into individual queries.
 *
 * Handles both the legacy table-of-contents-then-detail layout and the
 * newer "inline numbered blocks" layout. We anchor on lines that start
 * with `N)` or `N.` followed by a category bracket.
 */
export function parseHaroDigest(text: string): HaroQuery[] {
  if (!text || text.trim().length < 100) return [];

  // Strip HARO's table-of-contents header — everything before the first
  // long horizontal rule is just the summary index.
  const lines = text.split(/\r?\n/);
  const ruleIdx = lines.findIndex((l) => /^[-_=]{20,}$/.test(l.trim()));
  const body = ruleIdx >= 0 ? lines.slice(ruleIdx + 1).join("\n") : text;

  // Split on lines that look like the start of a numbered query block.
  // Examples: "1)", "1.", "Query 1)", "1 - "
  const blocks: string[] = [];
  const blockSplitRe = /(?:^|\n)\s*(?:Query\s*)?(\d{1,3})\s*[.)]\s*/g;
  const matches: Array<{ number: number; idx: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = blockSplitRe.exec(body)) !== null) {
    matches.push({ number: parseInt(m[1], 10), idx: m.index + m[0].length });
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].idx;
    const end = i + 1 < matches.length ? matches[i + 1].idx - matches[i + 1].number.toString().length - 3 : body.length;
    blocks.push(body.slice(start, end));
  }

  const queries: HaroQuery[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const summary = extractField(block, "Summary") || block.split("\n")[0]?.trim() || "";
    const category = extractField(block, "Category");
    const email = extractField(block, "Email");
    const outlet = extractField(block, "Media\\s*Outlet") || extractField(block, "Outlet");
    const deadline = extractField(block, "Deadline");
    const query = extractField(block, "Query");
    const requirements = extractField(block, "Requirements");

    // Skip if we couldn't even extract a query or a summary — likely a
    // false-positive numbered match (footer, table of contents, etc.).
    if (!query && !summary) continue;
    if (!query && summary.length < 20) continue;

    queries.push({
      number: matches[i]?.number ?? i + 1,
      summary,
      category,
      email,
      outlet,
      deadline,
      query: query || summary,
      requirements,
    });
  }
  return queries;
}
