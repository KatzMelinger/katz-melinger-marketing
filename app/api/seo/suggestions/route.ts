/**
 * /api/seo/suggestions
 *   GET  — list suggestions (optional ?status=, ?practiceArea=, ?priority=)
 *   POST — create a suggestion by running the strategy engine on a cluster
 *
 * Suggestion = the Strategy Engine's recommendation for what a keyword
 * cluster should become, plus a pre-filled Per-Page Brief. Diana approves /
 * rejects / holds suggestions on /seo/suggestions.
 *
 * Requires the supabase/brief_suggestions_schema.sql migration.
 */

import { NextRequest, NextResponse } from "next/server";

import { suggestForCluster, type ClusterInput } from "@/lib/strategy-engine";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const practiceArea = searchParams.get("practiceArea");
    const priority = searchParams.get("priority");

    const supabase = getSupabaseAdmin();
    let q = supabase
      .from("brief_suggestions")
      .select("*")
      .eq("tenant_id", await resolveTenantId())
      .order("created_at", { ascending: false })
      .limit(200);

    if (status) q = q.eq("status", status);
    if (practiceArea) q = q.eq("practice_area", practiceArea);
    if (priority) q = q.eq("priority", priority);

    const { data, error } = await q;
    if (error) {
      console.error("[suggestions GET] Supabase error:", error.message);
      return NextResponse.json({ error: "Failed to load suggestions" }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  } catch (err: any) {
    console.error("[suggestions GET] Failed:", err?.message);
    return NextResponse.json({ error: "Failed to load suggestions" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

    const primaryKeyword = typeof o.primaryKeyword === "string" ? o.primaryKeyword.trim() : "";
    if (!primaryKeyword) {
      return NextResponse.json({ error: "primaryKeyword is required" }, { status: 400 });
    }

    const cluster: ClusterInput = {
      clusterName: (typeof o.clusterName === "string" ? o.clusterName.trim() : "") || primaryKeyword,
      primaryKeyword,
      secondaryKeywords: Array.isArray(o.secondaryKeywords)
        ? (o.secondaryKeywords as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
      volume: typeof o.volume === "number" ? o.volume : null,
      kd: typeof o.kd === "number" ? o.kd : null,
      intent:
        o.intent === "informational" || o.intent === "commercial" || o.intent === "proof"
          ? o.intent
          : null,
      currentRank: typeof o.currentRank === "number" ? o.currentRank : null,
      existingUrl: typeof o.existingUrl === "string" ? o.existingUrl : null,
      cpc: typeof o.cpc === "number" ? o.cpc : null,
      practiceAreaHint:
        o.practiceAreaHint === "employment" || o.practiceAreaHint === "collections"
          ? o.practiceAreaHint
          : null,
    };

    const decision = await suggestForCluster(cluster);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("brief_suggestions")
      .insert({
        cluster_name: cluster.clusterName,
        primary_keyword: cluster.primaryKeyword,
        secondary_keywords: cluster.secondaryKeywords ?? [],
        content_type: decision.contentType,
        practice_area: decision.practiceArea,
        pillar_id: decision.pillarId,
        search_intent: decision.searchIntent,
        recommended_action: decision.recommendedAction,
        priority: decision.priority,
        reasoning: decision.reasoning,
        decision_source: decision.decisionSource,
        suggested_brief: decision.brief,
        metrics: {
          volume: cluster.volume,
          kd: cluster.kd,
          currentRank: cluster.currentRank,
          cpc: cluster.cpc,
        },
        cannibalization_risk: decision.cannibalizationRisk,
        existing_url: cluster.existingUrl ?? null,
        source: typeof o.source === "string" ? o.source : "manual",
        source_ref: typeof o.sourceRef === "string" ? o.sourceRef : null,
        tenant_id: await resolveTenantId(),
      })
      .select()
      .single();

    if (error) {
      console.error("[suggestions POST] Supabase error:", error.message);
      return NextResponse.json({ error: "Failed to save suggestion" }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err: any) {
    console.error("[suggestions POST] Failed:", err?.message);
    return NextResponse.json({ error: err?.message ?? "Failed" }, { status: 500 });
  }
}
