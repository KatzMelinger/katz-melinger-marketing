/**
 * Read-only: scan the content pipeline for duplicate rows across every table
 * where Diana's duplicate bug can occur. Writes nothing — just reports groups.
 *
 *   node scripts/find-duplicates.ts
 *
 * Scans:
 *   - brief_suggestions  — duplicate primary_keyword (the Decisions queue)
 *   - content_pipeline   — duplicate title (the Production Board)
 *   - content_drafts     — duplicate title+format (Saved drafts; same draft
 *                          regenerated leaves older copies behind)
 *
 * Grouping is per-tenant + case-insensitive trimmed key. Reads
 * NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

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

/** Group rows by a key, return only the groups with >1 member. */
function dupeGroups<T>(rows: T[], keyOf: (r: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k.trim()) continue;
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  }
  for (const [k, list] of groups) if (list.length < 2) groups.delete(k);
  return groups;
}

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

let grandTotalExtra = 0;

async function scan(
  table: string,
  columns: string,
  keyOf: (r: any) => string,
  display: string,
  describe: (r: any) => string,
): Promise<void> {
  const rows = await fetchAll(table, columns);
  const groups = dupeGroups(rows, keyOf);
  const extra = [...groups.values()].reduce((n, g) => n + (g.length - 1), 0);
  grandTotalExtra += extra;

  console.log(`\n=== ${table} — by ${display} ===`);
  if (groups.size === 0) {
    console.log("  no duplicates");
    return;
  }
  for (const [, g] of groups) {
    g.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    console.log(`  • "${g[0].title ?? g[0].primary_keyword ?? g[0].topic}" — ${g.length} copies:`);
    for (const r of g) console.log(`      ${describe(r)}`);
  }
  console.log(`  → ${groups.size} duplicate group(s), ${extra} redundant row(s)`);
}

console.log("Scanning for duplicates (read-only)…");

await scan(
  "brief_suggestions",
  "id, tenant_id, primary_keyword, status, created_at",
  (r) => `${r.tenant_id}::${norm(r.primary_keyword)}`,
  "primary_keyword",
  (r) => `#${r.id}  status=${r.status}  created=${String(r.created_at).slice(0, 10)}`,
);

await scan(
  "content_pipeline",
  "id, tenant_id, title, status, draft_id, created_at",
  (r) => `${r.tenant_id}::${norm(r.title)}`,
  "title",
  (r) => `#${r.id}  status=${r.status}  draft=${r.draft_id ? "yes" : "no"}  created=${String(r.created_at).slice(0, 10)}`,
);

await scan(
  "content_drafts",
  "id, tenant_id, title, topic, format, status, created_at",
  (r) => `${r.tenant_id}::${norm(r.title || r.topic)}::${norm(r.format)}`,
  "title+format",
  (r) => `#${String(r.id).slice(0, 8)}  format=${r.format}  status=${r.status}  created=${String(r.created_at).slice(0, 10)}`,
);

console.log(`\nTotal redundant rows across all tables: ${grandTotalExtra}`);
console.log("Done. (nothing was changed)");
