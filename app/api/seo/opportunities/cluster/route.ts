/**
 * POST /api/seo/opportunities/cluster
 *   (UI trigger — "Group into clusters" button on /seo/opportunities)
 *
 * Runs semantic clustering over the tenant's actionable opportunities (status
 * "new", not excluded) and writes the cluster columns back so the Radar can show
 * related keywords as ONE expandable cluster instead of separate competing rows.
 *
 * Idempotent: cluster_id is derived from the primary keyword, so re-running
 * reshuffles cleanly. Only the cluster_* columns are touched — metrics,
 * classification, and lifecycle status are left alone.
 */

import { NextResponse } from "next/server";

import { guardUser } from "@/lib/supabase-route";
import { resolveTenantId } from "@/lib/tenant-context";
import { getTenantJobDb } from "@/lib/tenant-db";
import { clusterKeywords } from "@/lib/keyword-clustering";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Stable cluster id from the primary keyword (keeps re-runs idempotent). */
function clusterIdFor(primary: string): string {
  return (
    "c_" +
    primary
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60)
  );
}

export async function POST() {
  const denied = await guardUser();
  if (denied) return denied;

  const tenantId = await resolveTenantId();
  const db = getTenantJobDb(tenantId);

  // Cluster the actionable list only — keywords the user can act on now.
  const { data, error } = await db
    .select("seo_opportunities", "keyword, search_volume, intent")
    .eq("status", "new")
    .eq("excluded", false);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as Array<{
    keyword: string;
    search_volume: number | null;
    intent: string | null;
  }>;
  if (rows.length === 0) {
    return NextResponse.json({ clustered: 0, clusters: 0, message: "No actionable opportunities to cluster." });
  }

  const clusters = await clusterKeywords(
    rows.map((r) => ({ keyword: r.keyword, searchVolume: r.search_volume, intent: r.intent })),
  );

  const now = new Date().toISOString();
  let clustered = 0;
  let pillars = 0;

  for (const c of clusters) {
    const clusterId = clusterIdFor(c.primaryKeyword);
    if (c.type === "pillar") pillars += 1;

    // Shared fields for every keyword in the cluster (default role = member).
    const { error: memberErr } = await db.raw
      .from("seo_opportunities")
      .update({
        cluster_id: clusterId,
        cluster_type: c.type,
        cluster_primary_keyword: c.primaryKeyword,
        cluster_role: "member",
        clustered_at: now,
      })
      .eq("tenant_id", tenantId)
      .in("keyword", c.keywords);
    if (memberErr) {
      return NextResponse.json({ error: memberErr.message }, { status: 500 });
    }

    // Promote the primary keyword.
    const { error: primaryErr } = await db.raw
      .from("seo_opportunities")
      .update({ cluster_role: "primary" })
      .eq("tenant_id", tenantId)
      .eq("keyword", c.primaryKeyword);
    if (primaryErr) {
      return NextResponse.json({ error: primaryErr.message }, { status: 500 });
    }

    clustered += c.keywords.length;
  }

  return NextResponse.json({
    clustered,
    clusters: clusters.length,
    pillars,
    standalone: clusters.length - pillars,
    message: `Grouped ${clustered} keywords into ${clusters.length} clusters (${pillars} pillar, ${clusters.length - pillars} standalone).`,
  });
}
