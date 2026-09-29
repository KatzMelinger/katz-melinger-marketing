/**
 * The statute-subject check, wired to the database (Sept 28 spec, section 3).
 *
 * The table and the matcher live in lib/legal-statute-table.ts. This reads the
 * attorney-approved rows from `legal_statute_table` (loaded by
 * supabase/legal_statute_table.sql once the table has been initialled) and
 * turns hits into findings under source `legal`, beside the traps and the
 * knowledge base.
 *
 *   statute_subject_mismatch   Critical. A real section cited for something it
 *                              does not cover. Carries the correct description,
 *                              so Apply fix can rewrite the sentence.
 *   statute_unverified_citation  Important. A cited section the table does not
 *                              know. Attorney review; never passed silently.
 *
 * An empty or missing table means the check has not been switched on yet, and
 * it produces nothing — deliberately not "every citation is unverified".
 */
import { getSupabaseAdmin } from "./supabase-server";
import { fingerprintFinding, type NormalizedFinding } from "./content-findings";
import { checkStatutes, type StatuteCode, type StatuteRow } from "./legal-statute-table";

/* eslint-disable @typescript-eslint/no-explicit-any */

function isMissingTable(message: string | undefined): boolean {
  return !!message && /legal_statute_table|does not exist|schema cache/i.test(message);
}

export async function loadStatuteTable(tenantId: string): Promise<{ ok: boolean; rows: StatuteRow[] }> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("legal_statute_table")
      .select("key, code, citation, aliases, covers, not_covers, mismatch_terms, unless_terms, source_url")
      .eq("tenant_id", tenantId)
      .eq("enabled", true);
    if (error) {
      if (isMissingTable(error.message)) return { ok: true, rows: [] };
      console.warn("[statute-check] could not load the statute table:", error.message);
      return { ok: false, rows: [] };
    }
    return {
      ok: true,
      rows: (data ?? []).map((r: any) => ({
        key: r.key,
        code: r.code as StatuteCode,
        citation: r.citation,
        aliases: Array.isArray(r.aliases) ? r.aliases : [],
        covers: r.covers,
        notCovers: r.not_covers ?? null,
        mismatch: Array.isArray(r.mismatch_terms) ? r.mismatch_terms : [],
        unless: Array.isArray(r.unless_terms) ? r.unless_terms : [],
        sourceUrl: r.source_url,
      })),
    };
  } catch (e) {
    console.warn("[statute-check] could not load the statute table:", e);
    return { ok: false, rows: [] };
  }
}

/** Pure half, for scripts and tests. */
export function statuteFindings(body: string, rows: readonly StatuteRow[]): NormalizedFinding[] {
  const findings: NormalizedFinding[] = [];
  const seen = new Set<string>();
  for (const hit of checkStatutes(body, rows)) {
    if (hit.kind === "mismatch") {
      const fp = fingerprintFinding("legal", `statute_subject_mismatch:${hit.row.key}`, hit.sentence);
      if (seen.has(fp)) continue;
      seen.add(fp);
      findings.push({
        fingerprint: fp,
        source: "legal",
        ruleId: "statute_subject_mismatch",
        severity: "critical",
        title: `${hit.row.citation} is cited for something it does not cover ("${hit.term}")`,
        detail:
          `${hit.row.citation} covers: ${hit.row.covers}` +
          (hit.row.notCovers ? ` It does not cover: ${hit.row.notCovers}` : ""),
        excerpt: hit.sentence,
        fix:
          `Rewrite this sentence so ${hit.matched} is cited only for what it covers: ${hit.row.covers} ` +
          `If the sentence is really about "${hit.term}", cite the correct authority instead or remove the citation. Change nothing else.`,
        sourceChecked: hit.row.sourceUrl,
        jurisdiction: null,
      });
    } else {
      const fp = fingerprintFinding("legal", "statute_unverified_citation", `${hit.citation}|${hit.sentence}`);
      if (seen.has(fp)) continue;
      seen.add(fp);
      findings.push({
        fingerprint: fp,
        source: "legal",
        ruleId: "statute_unverified_citation",
        severity: "important",
        title: `Unverified citation: ${hit.citation} is not in the statute table`,
        detail:
          "The firm's statute table does not list this section, so nothing confirms it says what this sentence claims. An attorney should confirm it, or it should be added to the table.",
        excerpt: hit.sentence,
        fix: null,
        sourceChecked: null,
        jurisdiction: null,
      });
    }
  }
  return findings;
}

export async function runStatuteCheck(
  body: string,
  opts: { tenantId: string },
): Promise<{ findings: NormalizedFinding[]; failed: boolean }> {
  const { ok, rows } = await loadStatuteTable(opts.tenantId);
  if (!ok) return { findings: [], failed: true };
  return { findings: statuteFindings(body, rows), failed: false };
}
