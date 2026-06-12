/**
 * GET /api/seo/page-decisions
 *
 * The grouped read model for the Opportunities hub / Keyword Tracker. Reads the
 * `page_decisions` VIEW (one row per pillar × content-type group over the
 * keyword-centric seo_opportunities table) and attaches each group's member
 * keywords with an on-page role (h1 / h2 / body) assigned by search volume.
 *
 * Tenant scoping: a plain Postgres view does NOT inherit the caller's RLS, so
 * we resolve the tenant from the session and filter explicitly via the
 * service-role helper (the app's documented isolation model — see
 * lib/tenant-context.ts).
 */

import { NextResponse } from "next/server";

import { resolveTenantId } from "@/lib/tenant-context";
import { getTenantJobDb } from "@/lib/tenant-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DecisionRow = {
  tenant_id: string;
  pillar_id: string;
  content_type: string;
  practice_area: string | null;
  primary_keyword: string | null;
  keyword_count: number;
  combined_volume: number;
  action_label: string | null;
  opportunity_score: number | null;
  priority_label: string | null;
  needs_review: boolean;
  opportunity_ids: string[];
  last_synced_at: string | null;
};

type MemberRow = {
  keyword: string;
  search_volume: number | null;
  pillar_id: string | null;
  recommended_content_type: string | null;
  excluded: boolean | null;
  status: string | null;
};

type KeywordRole = "h1" | "h2" | "body";

/** Primary (highest volume) → H1, next two → H2, the rest → body. */
function roleForRank(rank: number): KeywordRole {
  if (rank === 0) return "h1";
  if (rank <= 2) return "h2";
  return "body";
}

/** Must mirror the view's grouping: coalesce(pillar_id,'(unassigned)') ×
 *  coalesce(recommended_content_type,'blog_post'). */
function groupKey(pillar: string | null, contentType: string | null): string {
  return `${pillar ?? "(unassigned)"}::${contentType ?? "blog_post"}`;
}

export async function GET() {
  const tenantId = await resolveTenantId();
  const db = getTenantJobDb(tenantId);

  const { data: decisions, error } = await db
    .select("page_decisions", "*")
    .order("opportunity_score", { ascending: false, nullsFirst: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // One pass over the member keywords to assign on-page roles by volume rank.
  const { data: members } = await db.select(
    "seo_opportunities",
    "keyword, search_volume, pillar_id, recommended_content_type, excluded, status",
  );

  const byGroup = new Map<string, Array<{ keyword: string; volume: number }>>();
  for (const m of (members ?? []) as unknown as MemberRow[]) {
    if (m.excluded || m.status === "dismissed") continue;
    const key = groupKey(m.pillar_id, m.recommended_content_type);
    const arr = byGroup.get(key) ?? [];
    arr.push({ keyword: m.keyword, volume: m.search_volume ?? 0 });
    byGroup.set(key, arr);
  }
  for (const arr of byGroup.values()) arr.sort((a, b) => b.volume - a.volume);

  const out = ((decisions ?? []) as unknown as DecisionRow[]).map((d) => {
    const groupMembers = byGroup.get(groupKey(d.pillar_id, d.content_type)) ?? [];
    return {
      pillarId: d.pillar_id,
      contentType: d.content_type,
      practiceArea: d.practice_area,
      primaryKeyword: d.primary_keyword,
      keywordCount: d.keyword_count,
      combinedVolume: d.combined_volume,
      action: d.action_label,
      opportunityScore: d.opportunity_score,
      priority: d.priority_label,
      needsReview: d.needs_review,
      lastSyncedAt: d.last_synced_at,
      keywords: groupMembers.map((m, i) => ({
        keyword: m.keyword,
        searchVolume: m.volume,
        role: roleForRank(i),
      })),
    };
  });

  return NextResponse.json({ decisions: out, total: out.length });
}
