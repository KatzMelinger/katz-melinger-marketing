/**
 * GET /api/seo/rank-history
 *   query: from, to (capture dates, YYYY-MM-DD) — optional; defaults to the
 *          earliest and latest date in the window.
 *
 * The position-history view: a visibility trend line per domain, and a
 * date-over-date comparison table for two chosen capture dates.
 *
 * WHY THIS IS TWO READS RATHER THAN ONE
 *
 * It used to ask for 180 days of raw snapshots in a single unpaginated query.
 * PostgREST answers at most 1,000 rows, and this table takes 1,164 a day
 * (194 tracked keywords for the firm plus the same keywords for each tracked
 * competitor). So the whole response was ONE day's rows — and ordered
 * captured_on ascending, that day was the oldest in the window, 2026-06-13.
 *
 * That is what Diana reported in the September SEO report as "the keyword
 * tracker is still broken... stuck on June 13, and it now shows 0 tracked
 * keywords where August showed 194". Both symptoms came from that one cap:
 * June 13 was the only date in the payload so it was the only option in the
 * From/To selectors, and only 194 of those 1,164 rows are the firm's own
 * domain, so filtering to it left the table empty. It degraded month over month
 * because the window kept growing while the cap did not.
 *
 * The data was never wrong. Verified 2026-09-25: 194 own-domain snapshots every
 * single day with no gaps, 96,832 rows in total.
 *
 * So now:
 *   • the TREND is aggregated in SQL (seo_rank_visibility) — one row per domain
 *     per day, ~1,080 instead of ~210,000, and it carries every date and domain
 *     so the selectors still list the whole history;
 *   • the per-keyword DETAIL is fetched for the two compared dates only, which
 *     is all the comparison table ever shows;
 *   • and both reads page explicitly, so neither can be silently truncated
 *     again.
 */

import { NextRequest, NextResponse } from "next/server";

import { getTenantConfig } from "@/lib/tenant-config";
import { getTenantDb } from "@/lib/tenant-db";
import {
  buildRankHistory,
  loadPaged,
  type RankSnapshotRow,
  type VisibilityRow,
} from "@/lib/rank-history";

export const runtime = "nodejs";

const HISTORY_DAYS = 180;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A caller-supplied date, or null. Rejects anything not YYYY-MM-DD so a bad
 *  query string can never reach the `in` filter as a wildcard. */
function asDate(value: string | null): string | null {
  return value && DATE_RE.test(value) ? value : null;
}

export async function GET(req: NextRequest) {
  try {
    const db = await getTenantDb();
    const { seoDomain } = await getTenantConfig(db.tenantId);

    const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const visibilityRows = await loadPaged<VisibilityRow>(async (lo, hi) => {
      const { data, error } = await db
        .rpc("seo_rank_visibility", { p_since: since })
        .range(lo, hi);
      return { rows: (data ?? []) as VisibilityRow[], error: error?.message ?? null };
    });

    // Every capture date in the window, from the aggregate itself.
    const dates = [...new Set(visibilityRows.map((r) => r.captured_on))].sort();

    // Which two days the comparison table wants. Defaults to the ends of the
    // window, matching what the panel selects on first load.
    const url = new URL(req.url);
    const from = asDate(url.searchParams.get("from")) ?? dates[0] ?? null;
    const to = asDate(url.searchParams.get("to")) ?? dates[dates.length - 1] ?? null;
    const wanted = [from, to].filter((d): d is string => d !== null);

    const keywordRows =
      wanted.length === 0
        ? []
          // lo/hi, not from/to — those are the DATES above, and shadowing them
          // with row offsets here is a rename away from a subtle bug.
        : await loadPaged<RankSnapshotRow>(async (lo, hi) => {
            const { data, error } = await db
              .from("seo_rank_snapshots")
              .select("keyword, domain, rank, captured_on")
              .in("captured_on", wanted)
              .order("keyword", { ascending: true })
              .range(lo, hi);
            return { rows: (data ?? []) as RankSnapshotRow[], error: error?.message ?? null };
          });

    return NextResponse.json(
      buildRankHistory({ visibilityRows, keywordRows, ownDomain: seoDomain }),
    );
  } catch (err) {
    console.error(
      "[seo/rank-history] Failed:",
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json({ error: "Failed to load rank history" }, { status: 500 });
  }
}
