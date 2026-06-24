/**
 * GET /api/seo/competitors/authority
 *
 * Serves the competitor authority-comparison view: our domain vs. tracked
 * competitors, both as a current side-by-side and as a trend over time.
 *
 * Backed by authority_snapshots, which the daily tracked-keyword refresh cron
 * appends to (read-only here — no DataForSEO spend on the historical path).
 *
 * Day-one behaviour: until the cron has written any snapshots, the trend is
 * empty, so we fall back to a single LIVE point-in-time fetch (firm +
 * competitors) so the comparison isn't blank before history accrues.
 */

import { NextResponse } from "next/server";
import { getTenantDb } from "@/lib/tenant-db";
import { getTenantConfig } from "@/lib/tenant-config";
import { guardUser } from "@/lib/supabase-route";
import { listCompetitors, normalizeDomain } from "@/lib/seo-competitors";
import { getBacklinkOverview } from "@/lib/seo-intelligence";
import {
  shapeAuthorityHistory,
  type AuthoritySnapshotRow,
} from "@/lib/authority-history";

export const runtime = "nodejs";

// Bound the payload as history accumulates.
const HISTORY_DAYS = 180;
// Cap the live day-one fallback so it can't fan out to a huge competitor list.
const MAX_LIVE_COMPETITORS = 5;

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;
  try {
    const db = await getTenantDb();
    const { seoDomain } = await getTenantConfig(db.tenantId);
    const own = normalizeDomain(seoDomain);

    const cutoff = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const { data, error } = await db
      .from("authority_snapshots")
      .select("domain, authority_score, backlinks, referring_domains, captured_on")
      .gte("captured_on", cutoff)
      .order("captured_on", { ascending: true });

    if (error) {
      console.error("[seo/competitors/authority] Supabase error:", error.message);
      return NextResponse.json(
        { error: "Failed to load authority history" },
        { status: 500 },
      );
    }

    const rows = (data ?? []) as AuthoritySnapshotRow[];
    const history = shapeAuthorityHistory(rows, seoDomain);

    // Current = latest snapshot value per domain.
    const current: Record<string, number | null> = {};
    for (const domain of history.domains) {
      const dates = history.authority[domain] ?? {};
      const lastDate = history.dates.filter((d) => dates[d] != null).pop();
      current[domain] = lastDate ? dates[lastDate] ?? null : null;
    }

    // Day-one fallback: no snapshots yet → one live fetch so the page isn't blank.
    if (rows.length === 0) {
      const competitors = (await listCompetitors(db.tenantId))
        .map((c) => normalizeDomain(c))
        .filter((d) => d && d !== own)
        .slice(0, MAX_LIVE_COMPETITORS);
      const domains = [own, ...competitors];
      const live = await Promise.all(
        domains.map(async (domain) => {
          try {
            const o = await getBacklinkOverview(domain);
            return [domain, o.authorityScore] as const;
          } catch {
            return [domain, null] as const;
          }
        }),
      );
      return NextResponse.json({
        ownDomain: own,
        domains,
        dates: [],
        authority: {},
        current: Object.fromEntries(live),
        live: true,
        note: "Live snapshot — trend history begins accruing from the next daily refresh.",
      });
    }

    return NextResponse.json({ ...history, current, live: false });
  } catch (err) {
    console.error(
      "[seo/competitors/authority] Failed:",
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json(
      { error: "Failed to load authority comparison" },
      { status: 500 },
    );
  }
}
