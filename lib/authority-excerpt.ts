/**
 * The passage of an authority a claim should be judged against.
 *
 * askOnce used to send `authorityText.slice(0, 12_000)`. That was harmless while
 * every authority was a fetched section of a few thousand characters. It stopped
 * being harmless the moment full statutes entered the local corpus: N.J.S.A.
 * 10:5-12 is 43,815 characters, so a flat prefix showed the model 27% of the law
 * and hid every later subsection.
 *
 * The failure mode is the worst kind. A claim about a subsection past the cutoff
 * is not reported as unverifiable — it is judged against text that does not
 * contain it, and comes back "the authority does not address this". Confident,
 * wrong, and indistinguishable from a real answer.
 *
 * So the excerpt is chosen rather than truncated. The text is split at
 * subsection boundaries, each block is scored on how many of the claim's
 * distinctive words it contains, and the best blocks are sent in their original
 * order up to the budget.
 *
 * The opening block is always included. It carries the section number and the
 * operative framing ("It shall be an unlawful employment practice..."), which
 * every subsection hangs off and without which a lettered paragraph reads as a
 * fragment.
 */

/** Words too common to indicate relevance. */
const STOP = new Set([
  "the", "and", "for", "any", "that", "this", "with", "from", "not", "under",
  "shall", "such", "which", "have", "has", "been", "are", "was", "were", "its",
  "may", "must", "can", "does", "did", "who", "whom", "than", "then", "when",
  "where", "what", "only", "also", "into", "upon", "other", "their", "there",
  "would", "could", "should", "employee", "employer", "employees", "employers",
]);

/** Distinctive words in a claim, lowercased. */
export function claimTerms(claim: string): string[] {
  const seen = new Set<string>();
  for (const w of claim.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []) {
    if (!STOP.has(w)) seen.add(w);
  }
  return [...seen];
}

/**
 * Split an authority into blocks at subsection boundaries.
 *
 * Statutes here arrive with blank lines between lettered and numbered
 * paragraphs, so a blank line is the natural seam. Blocks are then merged up to
 * a floor so a one-line paragraph does not become its own scored unit and
 * outrank the substantive text around it.
 */
export function splitBlocks(text: string, floor = 600): string[] {
  const raw = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const part of raw) {
    if (out.length && out[out.length - 1].length < floor) {
      out[out.length - 1] += "\n\n" + part;
    } else {
      out.push(part);
    }
  }
  return out;
}

export function focusedExcerpt(authorityText: string, claim: string, budget = 12_000): string {
  if (authorityText.length <= budget) return authorityText;

  const blocks = splitBlocks(authorityText);
  if (blocks.length <= 1) return authorityText.slice(0, budget);

  const terms = claimTerms(claim);
  const scored = blocks.map((block, i) => {
    const lower = block.toLowerCase();
    // Count distinct matching terms, not occurrences: a block repeating one word
    // twenty times is not more relevant than one covering five of the claim's.
    let score = 0;
    for (const t of terms) if (lower.includes(t)) score++;
    return { i, block, score };
  });

  const chosen = new Set<number>([0]); // the opening always travels
  let used = blocks[0].length;

  for (const s of [...scored].sort((a, b) => b.score - a.score || a.i - b.i)) {
    if (chosen.has(s.i) || s.score === 0) continue;
    if (used + s.block.length + 20 > budget) continue;
    chosen.add(s.i);
    used += s.block.length + 20;
  }

  // Original order, so subsections still read in sequence, with an explicit
  // marker where something was left out. A reader — and the model — should be
  // able to tell a gap from a statute that simply says nothing more.
  const idx = [...chosen].sort((a, b) => a - b);
  const parts: string[] = [];
  let prev = -1;
  for (const i of idx) {
    if (prev !== -1 && i !== prev + 1) parts.push("[...]");
    parts.push(blocks[i]);
    prev = i;
  }
  if (prev !== blocks.length - 1) parts.push("[...]");
  return parts.join("\n\n");
}

/**
 * Does this quote plausibly belong to this claim?
 *
 * The existing check proves a quote EXISTS in the source, which stops a
 * fabricated passage. It does not stop a real passage about something else:
 * a contradiction of "sexual orientation is not protected" came back quoting a
 * proviso about private secondary school admissions criteria. The verdict was
 * right and the evidence was unrelated, which is what a reviewer would actually
 * read.
 *
 * Sharing one distinctive word with the claim is a low bar deliberately —
 * enough to catch a quote from an unrelated part of a long statute, loose
 * enough not to reject a paraphrased-but-relevant passage.
 */
export function quoteRelatesToClaim(quote: string, claim: string): boolean {
  const terms = claimTerms(claim);
  if (terms.length === 0) return true;
  const lower = quote.toLowerCase();
  return terms.some((t) => lower.includes(t));
}
