/**
 * Apply Diana's 2026-06-15 keyword-classification decisions to the rows ALREADY
 * in the database (seo_opportunities + brief_suggestions). The code-level
 * classifier fix (lib/strategy-engine, keyword-filter, keyword-cluster) governs
 * FUTURE syncs; this one-off reconciles the existing backlog to those same rules.
 *
 * It re-runs the (now-fixed) pure classifiers over each live row and:
 *   - DROPS rows that are now excluded (workers' comp, unemployment) —
 *     seo_opportunities → status 'dismissed' + excluded; brief_suggestions →
 *     status 'rejected'. (Reversible — nothing is deleted.)
 *   - RE-PILLARS rows whose practice_area / pillar_id changed (collections
 *     moves, non-compete → severance, sick leave → leave, general → hub,
 *     drug-testing by angle). brief_suggestions also gets its suggested_brief
 *     pillar/link/practice_area patched to match.
 *   - Leaves drug-testing rows with an unclear angle as NEEDS REVIEW (pillar
 *     blanked) rather than guessing.
 *
 * DRY-RUN BY DEFAULT — prints the full change set and writes nothing. Pass
 * --apply to perform the updates. Optional --table=opportunities|suggestions
 * (default: both). Only touches the KM (default) tenant.
 *
 *   npx tsx scripts/reclassify-diana-2026-06-15.ts            # preview
 *   npx tsx scripts/reclassify-diana-2026-06-15.ts --apply    # write
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { scoreKeyword, KM_BRAND_TOKENS } from "@/lib/keyword-filter";
import { inferPracticeArea, inferPillar } from "@/lib/strategy-engine";
import { getPillarById } from "@/lib/km-content-system";
import { DEFAULT_TENANT_ID } from "@/lib/tenant-context";

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(path)) return out;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const env = { ...loadEnv(".env.local"), ...process.env };
const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const tableArg = process.argv.find((a) => a.startsWith("--table="))?.split("=")[1] ?? "both";
const ctx = { brandTokens: KM_BRAND_TOKENS, competitorTokens: [] as string[] };
const db = createClient(url, key, { auth: { persistSession: false } });

console.log(`\nDB: ${url}`);
console.log(`Mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}   Tables: ${tableArg}`);
console.log(`Tenant: ${DEFAULT_TENANT_ID} (KM)\n`);

type Plan = { drop: number; repillar: number; review: number; same: number };

/**
 * Decide the new classification for a keyword from the fixed rules.
 *
 * `currentPillar` lets us apply the safety guard: we NEVER demote a row that
 * already has a specific pillar down into the generic employment hub (that would
 * regress good classifications). The hub is only assigned to rows that currently
 * have no pillar — i.e. Diana's general high-intent terms.
 */
function reclassify(keyword: string, currentPillar: string | null) {
  const q = scoreKeyword(keyword, {}, ctx);
  if (q.excluded) return { action: "drop" as const, reason: q.excludeReason ?? "excluded" };
  const area = inferPracticeArea({ clusterName: keyword, primaryKeyword: keyword });
  const pillarId = inferPillar({ clusterName: keyword, primaryKeyword: keyword }, area);
  if (!pillarId) return { action: "review" as const, area };
  // Guard: don't pull an already-pillared row into the generic hub.
  const cur = currentPillar?.trim() || null;
  if (pillarId === "employment-hub" && cur && cur !== "employment-hub") {
    return { action: "keep" as const };
  }
  return { action: "repillar" as const, area, pillarId };
}

async function doOpportunities(): Promise<Plan> {
  const plan: Plan = { drop: 0, repillar: 0, review: 0, same: 0 };
  // Only the live working set. Rows with excluded=true are already cleared
  // (e.g. the "wage-theft cleanup" junk pass) — never touch them.
  const { data, error } = await db
    .from("seo_opportunities")
    .select("id, keyword, practice_area, pillar_id, status, excluded")
    .eq("tenant_id", DEFAULT_TENANT_ID)
    .eq("excluded", false)
    .limit(5000);
  if (error) {
    console.error("  seo_opportunities read failed:", error.message);
    return plan;
  }
  console.log(`seo_opportunities: ${data?.length ?? 0} live (non-excluded) rows\n`);
  for (const row of data ?? []) {
    const r = reclassify(row.keyword, row.pillar_id);
    if (r.action === "keep") { plan.same++; continue; }
    if (r.action === "drop") {
      if (row.excluded && row.status === "dismissed") { plan.same++; continue; }
      plan.drop++;
      console.log(`  DROP      "${row.keyword}"  (${r.reason})`);
      if (APPLY) {
        await db.from("seo_opportunities").update({
          excluded: true, exclude_reason: r.reason, status: "dismissed",
          decision_notes: "Diana 2026-06-15: not a practice area",
        }).eq("id", row.id);
      }
    } else if (r.action === "review") {
      if (row.pillar_id === null && row.practice_area === r.area) { plan.same++; continue; }
      plan.review++;
      console.log(`  REVIEW    "${row.keyword}"  (${row.practice_area}/${row.pillar_id ?? "—"} → ${r.area}/needs review)`);
      if (APPLY) {
        await db.from("seo_opportunities").update({
          practice_area: r.area, pillar_id: null,
          decision_notes: "Diana 2026-06-15: needs human review (ambiguous angle)",
        }).eq("id", row.id);
      }
    } else {
      if (row.practice_area === r.area && row.pillar_id === r.pillarId) { plan.same++; continue; }
      plan.repillar++;
      console.log(`  REPILLAR  "${row.keyword}"  (${row.practice_area}/${row.pillar_id ?? "—"} → ${r.area}/${r.pillarId})`);
      if (APPLY) {
        await db.from("seo_opportunities").update({
          practice_area: r.area, pillar_id: r.pillarId,
        }).eq("id", row.id);
      }
    }
  }
  return plan;
}

async function doSuggestions(): Promise<Plan> {
  const plan: Plan = { drop: 0, repillar: 0, review: 0, same: 0 };
  const { data, error } = await db
    .from("brief_suggestions")
    .select("id, primary_keyword, practice_area, pillar_id, status, suggested_brief")
    .eq("tenant_id", DEFAULT_TENANT_ID)
    .neq("status", "rejected")
    .limit(5000);
  if (error) {
    console.error("  brief_suggestions read failed:", error.message);
    return plan;
  }
  console.log(`\nbrief_suggestions: ${data?.length ?? 0} rows (excl. already-rejected)\n`);
  for (const row of data ?? []) {
    const r = reclassify(row.primary_keyword, row.pillar_id);
    if (r.action === "keep") { plan.same++; continue; }
    if (r.action === "drop") {
      plan.drop++;
      console.log(`  DROP      "${row.primary_keyword}"  (${r.reason})`);
      if (APPLY) {
        await db.from("brief_suggestions").update({
          status: "rejected", decision_notes: `Diana 2026-06-15: ${r.reason}`,
        }).eq("id", row.id);
      }
      continue;
    }
    const newPillar = r.action === "review" ? null : r.pillarId;
    if (row.practice_area === r.area && (row.pillar_id ?? null) === newPillar) { plan.same++; continue; }
    const brief = (row.suggested_brief ?? {}) as Record<string, unknown>;
    const patched = {
      ...brief,
      practiceArea: r.area,
      pillarId: newPillar ?? "",
      internalPillarLink: newPillar ? getPillarById(newPillar)?.url ?? "" : "",
    };
    if (r.action === "review") {
      plan.review++;
      console.log(`  REVIEW    "${row.primary_keyword}"  (${row.practice_area}/${row.pillar_id ?? "—"} → ${r.area}/needs review)`);
      if (APPLY) {
        await db.from("brief_suggestions").update({
          practice_area: r.area, pillar_id: null, suggested_brief: patched,
          decision_notes: "Diana 2026-06-15: needs human review (ambiguous angle)",
        }).eq("id", row.id);
      }
    } else {
      plan.repillar++;
      console.log(`  REPILLAR  "${row.primary_keyword}"  (${row.practice_area}/${row.pillar_id ?? "—"} → ${r.area}/${newPillar})`);
      if (APPLY) {
        await db.from("brief_suggestions").update({
          practice_area: r.area, pillar_id: newPillar, suggested_brief: patched,
        }).eq("id", row.id);
      }
    }
  }
  return plan;
}

(async () => {
  const totals: Plan = { drop: 0, repillar: 0, review: 0, same: 0 };
  const add = (p: Plan) => { totals.drop += p.drop; totals.repillar += p.repillar; totals.review += p.review; totals.same += p.same; };
  if (tableArg === "both" || tableArg === "opportunities") add(await doOpportunities());
  if (tableArg === "both" || tableArg === "suggestions") add(await doSuggestions());
  console.log(`\n──────────────────────────────────────────`);
  console.log(`  drop: ${totals.drop}   repillar: ${totals.repillar}   review: ${totals.review}   unchanged: ${totals.same}`);
  console.log(APPLY ? "  ✔ Applied." : "  Dry-run only — re-run with --apply to write.");
  console.log(`──────────────────────────────────────────\n`);
})();
