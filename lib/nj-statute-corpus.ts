/**
 * Locally held New Jersey statutory text.
 *
 * WHY THIS EXISTS
 *
 * New Jersey has no machine-readable statute source. Every route was tested:
 * njoag.gov returns 403 to Node behind Incapsula; the Civil Service EEO page
 * lists law NAMES and contains no statutory text; law.justia.com and casetext
 * 403 automated clients; and the Legislature's own system,
 * lis.njleg.state.nj.us, is a session-based NXT portal that answers
 * "<Not initialized yet>" and a search form.
 *
 * One page — the Department of Labor's wage-and-hour laws page — does serve
 * full text, and lib/legal-retrieval.ts uses it. It covers the Wage and Hour
 * Law and N.J.A.C. 12:56 and nothing else. NJLAD and CEPA, which are most of
 * this firm's New Jersey practice, are not retrievable anywhere.
 *
 * So they are held locally instead. Statutory text is not copyrightable, it
 * changes rarely, and an amendment is a detectable event rather than a
 * per-request gamble. A stored copy with recorded provenance is a better
 * source than a live fetch that cannot be made.
 *
 * WHAT THIS FILE WILL NOT DO
 *
 * It ships EMPTY. Nothing here was written from memory, and nothing may be.
 * The whole legal layer rests on comparing a claim against the authority's
 * actual words; text that was recalled rather than copied would make every
 * verification downstream a confident fiction, and it would be indistinguishable
 * from the real thing to everyone reading the output.
 *
 * Entries are added with scripts/ingest-nj-statute.ts from a source the firm
 * lawfully has. Until a section is ingested, citations to it route to an
 * attorney — which is what happens today, so an empty corpus changes nothing
 * and a populated one only ever helps.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import type { ParsedCitation } from "./legal-citation";

/** Where ingested statute files live, relative to the repo root. */
export const CORPUS_DIR = join(process.cwd(), "legal-corpus", "nj");

export type CorpusEntry = {
  /** "nj_statute" | "njac" — matches ParsedCitation.corpus. */
  corpus: string;
  /** Title, e.g. "10" for N.J.S.A. 10:5-12. */
  book: string;
  /** Everything after the colon, e.g. "5-12". */
  section: string;
  /** The section's own heading, as printed. */
  heading: string;
  /**
   * The authority's words, verbatim.
   *
   * Never summarised. lib/legal-verify.ts requires a quote to appear in this
   * string character for character, so a paraphrase does not merely degrade
   * the check — it makes true claims fail and invites someone to loosen the
   * guard until they pass.
   */
  text: string;
  /** Where the text was copied from, in words a reviewer can act on. */
  source: string;
  /** A URL for the source, when there is one. */
  sourceUrl?: string;
  /** The date the text was current as of, ISO yyyy-mm-dd. */
  asOf: string;
  /** Who ingested it. */
  ingestedBy: string;
};

const REQUIRED: (keyof CorpusEntry)[] = [
  "corpus", "book", "section", "heading", "text", "source", "asOf", "ingestedBy",
];

/**
 * Validate one entry. Returns the problems; empty means usable.
 *
 * Strict on purpose. A corpus entry becomes the ground truth a claim is judged
 * against, so an entry missing its provenance is worse than no entry: it looks
 * checked.
 */
export function validateEntry(raw: unknown): string[] {
  const problems: string[] = [];
  if (!raw || typeof raw !== "object") return ["not an object"];
  const e = raw as Record<string, unknown>;

  for (const k of REQUIRED) {
    const v = e[k];
    if (typeof v !== "string" || !v.trim()) problems.push(`missing or empty: ${k}`);
  }
  if (typeof e.corpus === "string" && e.corpus !== "nj_statute" && e.corpus !== "njac") {
    problems.push(`corpus must be nj_statute or njac, got "${e.corpus}"`);
  }
  if (typeof e.asOf === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(e.asOf)) {
    problems.push(`asOf must be yyyy-mm-dd, got "${e.asOf}"`);
  }
  // A section of statute is not 40 characters long. This catches a heading
  // pasted where the text belongs, which would otherwise verify against nothing.
  if (typeof e.text === "string" && e.text.trim().length < 200) {
    problems.push(`text is only ${e.text.trim().length} characters — too short to be a section's text`);
  }
  // The section number should appear in its own text, the same check
  // lib/legal-retrieval.ts applies to a fetched authority.
  if (typeof e.text === "string" && typeof e.section === "string" && e.section) {
    if (!e.text.toLowerCase().includes(e.section.toLowerCase())) {
      problems.push(`the section number "${e.section}" does not appear in the text — wrong section pasted?`);
    }
  }
  return problems;
}

/** Filename for an entry: nj_statute-10-5-12.json */
export function entryFilename(corpus: string, book: string, section: string): string {
  return `${corpus}-${book}-${section}`.replace(/[^a-zA-Z0-9_.-]/g, "_") + ".json";
}

let cache: CorpusEntry[] | null = null;

/** Every valid entry on disk. Invalid files are skipped LOUDLY, never silently. */
export function loadCorpus(): CorpusEntry[] {
  if (cache) return cache;
  const out: CorpusEntry[] = [];
  if (!existsSync(CORPUS_DIR)) {
    cache = out;
    return out;
  }
  for (const f of readdirSync(CORPUS_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(CORPUS_DIR, f), "utf8"));
      const problems = validateEntry(parsed);
      if (problems.length) {
        console.warn(`[nj-corpus] ignoring ${f}: ${problems.join("; ")}`);
        continue;
      }
      out.push(parsed as CorpusEntry);
    } catch (e) {
      console.warn(`[nj-corpus] ignoring ${f}: ${(e as Error).message}`);
    }
  }
  cache = out;
  return out;
}

/** For tests and for the ingest script, which writes then re-reads. */
export function clearCorpusCache(): void {
  cache = null;
}

/** The stored text for this citation, or null if it has not been ingested. */
export function lookupCorpus(citation: ParsedCitation): CorpusEntry | null {
  const want = citation.section.toLowerCase();
  return (
    loadCorpus().find(
      (e) =>
        e.corpus === citation.corpus &&
        e.book === citation.book &&
        e.section.toLowerCase() === want,
    ) ?? null
  );
}

/** What is held, for a status report. */
export function corpusSummary(): { corpus: string; citation: string; heading: string; asOf: string }[] {
  return loadCorpus().map((e) => ({
    corpus: e.corpus,
    citation: `${e.corpus === "njac" ? "N.J.A.C." : "N.J.S.A."} ${e.book}:${e.section}`,
    heading: e.heading,
    asOf: e.asOf,
  }));
}
