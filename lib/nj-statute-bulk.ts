/**
 * The NJ Legislature's own bulk statute export — a genuine, official,
 * machine-readable NJ source that legal-corpus/nj/README.md's route survey
 * (2026-08-31) didn't test: https://pub.njleg.state.nj.us/statutes/. It
 * publishes the entire state code as a single plain-text file, updated
 * weekdays at 2am, with no bot-blocking — confirmed live: a plain fetch
 * succeeds where njoag.gov, justia, and the Legislature's own NXT search
 * portal all fail or block automated clients (see that same README).
 *
 * DELIBERATELY A FALLBACK, NOT A REPLACEMENT for legal-corpus/nj/. The
 * curated corpus is Westlaw-sourced, human-reviewed, and KeyCite-aware (see
 * its README's note on 10:5-12); this is an unreviewed extraction from a
 * flat government text file. It exists for the long tail of NJ statute
 * citations the five priority sections don't cover — better than always
 * routing to an attorney, but lower trust than a curated entry, which is
 * why lib/legal-retrieval.ts only reaches for this after the corpus and the
 * wage-and-hour page both come up empty, and why the returned text is
 * labeled with its actual provenance rather than presented as equivalent to
 * a Westlaw export.
 *
 * NJAC (regulations) are NOT in this file — confirmed by inspection, it is
 * Title-and-chapter statutory text only. Only nj_statute citations use this.
 */

import { unzipSync, strFromU8 } from "fflate";
import type { ParsedCitation } from "./legal-citation";

const BULK_ZIP_URL = "https://pub.njleg.state.nj.us/statutes/STATUTES-TEXT.zip";
const BULK_SOURCE_LABEL =
  "NJ Legislature official bulk statute text (https://pub.njleg.state.nj.us/statutes/), automated extraction — not attorney-reviewed";

const USER_AGENT =
  "Mozilla/5.0 (compatible; KatzMelinger-LegalCheck/1.0; +https://katzmelinger.com)";
// The archive is ~40MB — give it real time rather than the 20s used for a
// single small statute page elsewhere in this layer.
const FETCH_TIMEOUT_MS = 60_000;

// One download per process lifetime, not per citation — a single analysis
// or approve-gate run can check several NJ citations, and re-downloading
// ~40MB for each would be wasteful. This does NOT replace legal_facts_cache:
// that's what makes a repeat check across SEPARATE invocations (a cold
// serverless start, a different request) cheap; this only avoids repeat
// downloads within the same warm process.
let cachedText: string | null = null;
let cachedAt = 0;
const IN_MEMORY_TTL_MS = 5 * 60 * 1000;

async function downloadBulkText(): Promise<string | null> {
  if (cachedText && Date.now() - cachedAt < IN_MEMORY_TTL_MS) return cachedText;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(BULK_ZIP_URL, {
        headers: { "User-Agent": USER_AGENT },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const files = unzipSync(buf, { filter: (f) => f.name === "STATUTES.TXT" });
    const entry = files["STATUTES.TXT"];
    if (!entry) return null;
    cachedText = strFromU8(entry);
    cachedAt = Date.now();
    return cachedText;
  } catch (e) {
    console.warn("[nj-statute-bulk] download failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Finds one section's text inside the bulk file. Sections are printed as
 * their own line — "10:5-12  Unlawful employment practices..." — running
 * until the next such header line, which is what makes this reliably
 * extractable without a real statute parser. Confirmed against real section
 * boundaries in the live file (10:5-12 → 10:5-12.1, 34:19-3 → 34:19-4, etc.)
 * before this was written.
 */
function extractSection(bulkText: string, book: string, section: string): string | null {
  const escBook = book.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escSection = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headerRe = new RegExp(`^${escBook}:${escSection}\\.?\\s{2,}\\S`, "m");
  // Any section-header-shaped line, used to find where the NEXT section
  // starts so extraction stops there rather than running to end of file.
  const anyHeaderRe = /^\d+[A-Za-z]?:\d[\w.-]*\.?\s{2,}\S/gm;

  const startMatch = headerRe.exec(bulkText);
  if (!startMatch) return null;
  const start = startMatch.index;

  anyHeaderRe.lastIndex = start + 1;
  const next = anyHeaderRe.exec(bulkText);
  const end = next ? next.index : bulkText.length;
  return bulkText.slice(start, end).trim();
}

export type NjBulkResult = { text: string; sourceUrl: string };

/**
 * Look up one nj_statute citation in the bulk file. Returns null on any
 * failure — download error, section not found, text too short to be real —
 * which routes the claim to an attorney exactly like every other failure in
 * this layer. Never throws.
 */
export async function lookupNjBulkStatute(citation: ParsedCitation): Promise<NjBulkResult | null> {
  if (citation.corpus !== "nj_statute") return null;
  const bulkText = await downloadBulkText();
  if (!bulkText) return null;
  const section = extractSection(bulkText, citation.book, citation.section);
  if (!section || section.length < 100) return null;
  return { text: section.slice(0, 20_000), sourceUrl: BULK_SOURCE_LABEL };
}
