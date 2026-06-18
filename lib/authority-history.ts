/**
 * Authority-history time series — the data behind the competitor authority
 * comparison trend chart (/seo/competitors).
 *
 * Two responsibilities:
 *   • writeAuthoritySnapshots — called by the daily tracked-keyword refresh cron
 *     to append one row per (domain × day) for the firm AND every tracked
 *     competitor. Persisted in authority_snapshots.
 *   • shapeAuthorityHistory — pure transform from raw snapshot rows into the
 *     chart shape the /api/seo/competitors/authority route serves.
 *
 * Authority is DataForSEO's 0-1000 domain rank scaled to 0-100. It's a RELATIVE
 * trend, not an absolute grade — only meaningful watched over time and compared
 * across domains, which is exactly what this series enables.
 */

import { getBacklinkOverview } from "@/lib/seo-intelligence";
import { normalizeDomain } from "@/lib/seo-competitors";
import type { getTenantJobDb } from "@/lib/tenant-db";

/** Raw authority_snapshots row (the columns we read back for the UI). */
export type AuthoritySnapshotRow = {
  domain: string;
  authority_score: number | null;
  backlinks: number | null;
  referring_domains: number | null;
  captured_on: string; // YYYY-MM-DD
};

export type AuthorityHistoryResponse = {
  ownDomain: string;
  /** Firm domain first, then competitors A→Z. */
  domains: string[];
  /** Distinct capture dates, ascending. */
  dates: string[];
  /** domain → date → authority (0–100). */
  authority: Record<string, Record<string, number | null>>;
};

// Bound API spend if the tracked-competitor list grows large. Each competitor is
// one cached backlinks-summary call.
const MAX_COMPETITORS = 8;

/**
 * Append today's authority snapshot for the firm domain and every tracked
 * competitor. Idempotent for the day via upsert on
 * (tenant_id, domain, captured_on). Returns the number of rows written.
 *
 * Best-effort per domain: one failing competitor is skipped, never aborting the
 * rest. Authority moves slowly, so a daily cadence is plenty.
 */
export async function writeAuthoritySnapshots(params: {
  db: ReturnType<typeof getTenantJobDb>;
  capturedOn: string;
  ownDomain: string;
  competitors: string[];
}): Promise<number> {
  const { db, capturedOn, ownDomain, competitors } = params;

  const own = normalizeDomain(ownDomain);
  const domains = [
    own,
    ...competitors
      .map((c) => normalizeDomain(c))
      .filter((d) => d && d !== own)
      .slice(0, MAX_COMPETITORS),
  ];

  const rows: Array<{
    domain: string;
    authority_score: number | null;
    backlinks: number | null;
    referring_domains: number | null;
    captured_on: string;
  }> = [];

  for (const domain of domains) {
    try {
      const o = await getBacklinkOverview(domain);
      rows.push({
        domain,
        authority_score: o.authorityScore,
        backlinks: o.totalBacklinks,
        referring_domains: o.referringDomains,
        captured_on: capturedOn,
      });
    } catch (err) {
      console.error(
        `[authority-history] snapshot failed for ${domain}:`,
        err instanceof Error ? err.message : String(err),
      );
      // one bad domain shouldn't drop the rest
    }
  }

  if (rows.length === 0) return 0;

  const { error } = await db.upsert("authority_snapshots", rows, {
    onConflict: "tenant_id,domain,captured_on",
  });
  if (error) throw new Error(error.message);
  return rows.length;
}

/** Transform raw snapshot rows into the chart shape (domain → date → score). */
export function shapeAuthorityHistory(
  rows: AuthoritySnapshotRow[],
  ownDomain: string,
): AuthorityHistoryResponse {
  const own = normalizeDomain(ownDomain);

  const dateSet = new Set<string>();
  const domainSet = new Set<string>();
  const authority: Record<string, Record<string, number | null>> = {};

  for (const r of rows) {
    dateSet.add(r.captured_on);
    domainSet.add(r.domain);
    (authority[r.domain] ??= {})[r.captured_on] = r.authority_score;
  }

  const dates = Array.from(dateSet).sort();
  const domains = Array.from(domainSet).sort((a, b) => {
    if (a === own) return -1;
    if (b === own) return 1;
    return a.localeCompare(b);
  });

  return { ownDomain: own, domains, dates, authority };
}
