/**
 * One-off: remove duplicate content_pipeline (Production Board) rows that share
 * the same title within a tenant. Predates the dedup guard added to
 * /api/content/pipeline, which now blocks new duplicates.
 *
 * For each duplicate group it KEEPS the furthest-along row and deletes the rest:
 *   1. highest status (idea < brief < draft < review < published)
 *   2. then: a row that has a draft_id over one that doesn't
 *   3. then: most recently updated
 *
 * Dry-run by default (prints keep/delete, writes nothing):
 *   node scripts/dedupe-pipeline.ts
 * To actually delete:
 *   node scripts/dedupe-pipeline.ts --apply
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

const STATUS_RANK: Record<string, number> = {
  idea: 0,
  brief: 1,
  draft: 2,
  review: 3,
  published: 4,
};

/** Higher = keep. Sorts so the row to KEEP is first. */
function score(row: any): [number, number, number] {
  return [
    STATUS_RANK[row.status] ?? -1,
    row.draft_id ? 1 : 0,
    Date.parse(row.updated_at ?? row.created_at ?? "") || 0,
  ];
}

function cmp(a: any, b: any): number {
  const sa = score(a);
  const sb = score(b);
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return sb[i] - sa[i]; // descending: best first
  }
  return 0;
}

const { data, error } = await supabase
  .from("content_pipeline")
  .select("id, tenant_id, title, status, draft_id, created_at, updated_at");
if (error) {
  console.error(`load content_pipeline: ${error.message}`);
  process.exit(1);
}

// Group by tenant + normalized title.
const groups = new Map<string, any[]>();
for (const row of data ?? []) {
  const k = `${row.tenant_id}::${String(row.title).trim().toLowerCase()}`;
  const list = groups.get(k) ?? [];
  list.push(row);
  groups.set(k, list);
}

console.log(
  APPLY ? "APPLY mode — deleting duplicate rows.\n" : "DRY-RUN — no deletes. Re-run with --apply.\n",
);

let deleted = 0;
for (const [, list] of groups) {
  if (list.length < 2) continue;
  list.sort(cmp);
  const [keep, ...drop] = list;
  console.log(`"${keep.title}" — ${list.length} copies:`);
  console.log(`  keep   #${keep.id} (status=${keep.status}, draft_id=${keep.draft_id ?? "none"})`);
  for (const d of drop) {
    console.log(`  delete #${d.id} (status=${d.status}, draft_id=${d.draft_id ?? "none"})`);
    if (APPLY) {
      const { error: delErr } = await supabase.from("content_pipeline").delete().eq("id", d.id);
      if (delErr) console.error(`    ! delete failed: ${delErr.message}`);
      else deleted++;
    }
  }
}

if (deleted === 0 && !APPLY) {
  // count what would be deleted for the summary line
  for (const [, list] of groups) if (list.length > 1) deleted += list.length - 1;
  console.log(`\n${deleted} row(s) would be deleted.`);
} else {
  console.log(`\n${deleted} row(s) deleted.`);
}
console.log("Done.");
