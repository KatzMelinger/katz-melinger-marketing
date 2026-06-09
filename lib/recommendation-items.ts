/**
 * Persistent action list for the Recommendations dashboard.
 *
 * Each AI-generated recommendation becomes a row in `recommendation_items`
 * with a workflow status — active, done, hold, disregard. The UI groups by
 * status and lets the user move items between buckets. On the next Generate,
 * Claude is told to avoid re-suggesting anything already marked done or
 * disregarded (hold items will reappear naturally).
 *
 * Why per-row instead of stuffing into recommendations_history JSON:
 *   - status changes need to be atomic per recommendation, not per batch
 *   - dedup against done titles needs a queryable index
 *   - lets the action list outlive the batch it was generated in
 */

import { getSupabaseAdmin } from "./supabase-server";
import { resolveTenantId } from "./tenant-context";

export type RecStatus = "active" | "done" | "hold" | "disregard";

export type RecCategory =
  | "seo"
  | "aeo"
  | "content"
  | "technical"
  | "local"
  | "social";

export type RecEffort = "low" | "medium" | "high";
export type RecImpact = "low" | "medium" | "high";

export type RecommendationItem = {
  id: string;
  title: string;
  rationale: string;
  category: RecCategory;
  effort: RecEffort;
  impact: RecImpact;
  evidence: string;
  status: RecStatus;
  sourceGenerationId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type ItemRow = {
  id: string;
  title: string;
  rationale: string;
  category: RecCategory;
  effort: RecEffort;
  impact: RecImpact;
  evidence: string;
  status: RecStatus;
  source_generation_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function rowToItem(r: ItemRow): RecommendationItem {
  return {
    id: r.id,
    title: r.title,
    rationale: r.rationale,
    category: r.category,
    effort: r.effort,
    impact: r.impact,
    evidence: r.evidence,
    status: r.status,
    sourceGenerationId: r.source_generation_id,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listRecommendationItems(
  status?: RecStatus,
): Promise<RecommendationItem[]> {
  const supabase = getSupabaseAdmin();
  let q = supabase
    .from("recommendation_items")
    .select("*")
    .eq("tenant_id", await resolveTenantId())
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error || !data) return [];
  return (data as ItemRow[]).map(rowToItem);
}

export async function listSuppressedTitles(): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("recommendation_items")
    .select("title")
    .eq("tenant_id", await resolveTenantId())
    .in("status", ["done", "disregard"]);
  if (error || !data) return [];
  return (data as { title: string }[]).map((r) => r.title);
}

export async function updateItemStatus(
  id: string,
  status: RecStatus,
  notes?: string | null,
): Promise<RecommendationItem | null> {
  const supabase = getSupabaseAdmin();
  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (notes !== undefined) patch.notes = notes;
  const { data, error } = await supabase
    .from("recommendation_items")
    .update(patch)
    .eq("tenant_id", await resolveTenantId())
    .eq("id", id)
    .select()
    .single();
  if (error || !data) return null;
  return rowToItem(data as ItemRow);
}

export async function deleteItem(id: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("recommendation_items")
    .delete()
    .eq("tenant_id", await resolveTenantId())
    .eq("id", id);
  return !error;
}

/**
 * Persist newly generated recommendations as active items, skipping any whose
 * title (case-insensitive) already exists in the table — so user-curated
 * status (done/hold/disregard) isn't overwritten and identical recs from
 * earlier batches aren't duplicated.
 */
export async function persistGeneratedRecommendations(
  recs: {
    title: string;
    rationale: string;
    category: RecCategory;
    effort: RecEffort;
    impact: RecImpact;
    evidence: string;
  }[],
  sourceGenerationId: string | null,
): Promise<{ inserted: number; skipped: number }> {
  if (recs.length === 0) return { inserted: 0, skipped: 0 };

  const supabase = getSupabaseAdmin();
  const tid = await resolveTenantId();

  // Pull existing titles once for dedup. Cheap — typical action list is <200 rows.
  const { data: existing } = await supabase
    .from("recommendation_items")
    .select("title")
    .eq("tenant_id", tid);
  const existingTitles = new Set(
    (existing ?? []).map((r) => (r as { title: string }).title.toLowerCase().trim()),
  );

  let inserted = 0;
  let skipped = 0;

  for (const r of recs) {
    const normalized = r.title.toLowerCase().trim();
    if (existingTitles.has(normalized)) {
      skipped++;
      continue;
    }
    const { error } = await supabase.from("recommendation_items").insert({
      title: r.title,
      rationale: r.rationale,
      category: r.category,
      effort: r.effort,
      impact: r.impact,
      evidence: r.evidence,
      status: "active",
      source_generation_id: sourceGenerationId,
      tenant_id: tid,
    });
    if (!error) {
      inserted++;
      existingTitles.add(normalized);
    }
  }

  return { inserted, skipped };
}
