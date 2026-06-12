/**
 * Remove duplicate rows from brief_suggestions (Decisions) and content_drafts
 * (Saved drafts). Predates the dedup guard on /api/seo/suggestions; the guard
 * blocks new dupes, this clears the existing ones.
 *
 * For each duplicate group it KEEPS the best row and deletes the rest:
 *   1. a row linked to a Production Board item (pipeline.suggestion_id /
 *      pipeline.draft_id) — never orphan the board
 *   2. then highest status (approved/published > … > initial_review/pending)
 *   3. then a suggestion with approved_draft_id set
 *   4. then most recently created
 *
 * Dry-run by default (prints keep/delete, writes nothing):
 *   node scripts/dedupe-content.ts
 * To actually delete:
 *   node scripts/dedupe-content.ts --apply
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(path)) return out;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
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
const supabase = createClient(url, key, { auth: { persistSession: false } });

const norm = (s: unknown): string => String(s ?? "").trim().toLowerCase();

async function fetchAll(table: string, columns: string): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`load ${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function groupsOf(rows: any[], keyOf: (r: any) => string): any[][] {
  const map = new Map<string, any[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k.trim()) continue;
    (map.get(k) ?? map.set(k, []).get(k)!).push(r);
  }
  return [...map.values()].filter((g) => g.length > 1);
}

async function dedupe(
  table: string,
  columns: string,
  keyOf: (r: any) => string,
  scoreOf: (r: any) => number[],
  labelOf: (r: any) => string,
  describe: (r: any) => string,
): Promise<number> {
  const rows = await fetchAll(table, columns);
  const groups = groupsOf(rows, keyOf);
  let deleted = 0;

  console.log(`\n=== ${table} ===`);
  if (groups.length === 0) {
    console.log("  no duplicates");
    return 0;
  }

  for (const g of groups) {
    // Best (to KEEP) sorts first: compare score vectors descending.
    g.sort((a, b) => {
      const sa = scoreOf(a);
      const sb = scoreOf(b);
      for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i] - sa[i];
      return 0;
    });
    const [keep, ...drop] = g;
    console.log(`  "${labelOf(keep)}" — ${g.length} copies:`);
    console.log(`    keep   ${describe(keep)}`);
    for (const r of drop) {
      console.log(`    delete ${describe(r)}`);
      if (APPLY) {
        const { error } = await supabase.from(table).delete().eq("id", r.id);
        if (error) console.error(`      ! delete failed: ${error.message}`);
        else deleted++;
      } else {
        deleted++;
      }
    }
  }
  console.log(`  → ${groups.length} group(s), ${deleted} row(s) ${APPLY ? "deleted" : "would delete"}`);
  return deleted;
}

// Linkage: which suggestions/drafts are referenced by a Production Board row.
const pipeline = await fetchAll("content_pipeline", "id, draft_id, suggestion_id");
const linkedDraftIds = new Set(pipeline.map((p) => p.draft_id).filter(Boolean));
const linkedSuggestionIds = new Set(pipeline.map((p) => p.suggestion_id).filter(Boolean));

const SUG_STATUS: Record<string, number> = { approved: 3, held: 2, pending: 1, rejected: 0 };
const DRAFT_STATUS: Record<string, number> = {
  published: 6, approved: 5, review: 4, draft: 3, brief: 2, idea: 1, initial_review: 0,
};

console.log(APPLY ? "APPLY mode — deleting duplicates." : "DRY-RUN — no deletes. Re-run with --apply.");

let total = 0;

total += await dedupe(
  "brief_suggestions",
  "id, tenant_id, primary_keyword, status, approved_draft_id, created_at",
  (r) => `${r.tenant_id}::${norm(r.primary_keyword)}`,
  (r) => [
    linkedSuggestionIds.has(r.id) ? 1 : 0,
    SUG_STATUS[r.status] ?? -1,
    r.approved_draft_id ? 1 : 0,
    Date.parse(r.created_at) || 0,
  ],
  (r) => r.primary_keyword,
  (r) =>
    `#${String(r.id).slice(0, 8)}  status=${r.status}  draft=${r.approved_draft_id ? "yes" : "no"}  board=${linkedSuggestionIds.has(r.id) ? "yes" : "no"}  ${String(r.created_at).slice(0, 10)}`,
);

total += await dedupe(
  "content_drafts",
  "id, tenant_id, title, topic, format, status, created_at",
  (r) => `${r.tenant_id}::${norm(r.title || r.topic)}::${norm(r.format)}`,
  (r) => [
    linkedDraftIds.has(r.id) ? 1 : 0,
    DRAFT_STATUS[r.status] ?? -1,
    Date.parse(r.created_at) || 0,
  ],
  (r) => r.title || r.topic,
  (r) =>
    `#${String(r.id).slice(0, 8)}  format=${r.format}  status=${r.status}  board=${linkedDraftIds.has(r.id) ? "yes" : "no"}  ${String(r.created_at).slice(0, 10)}`,
);

console.log(`\nTotal: ${total} row(s) ${APPLY ? "deleted" : "would be deleted"}.`);
console.log("Done.");
