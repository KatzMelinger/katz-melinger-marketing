/**
 * Open drafts that share a primary keyword or a target URL (Oct 20 spec,
 * Task A3: "no two open drafts share a primary keyword or
 * update_target_url"). Read-only: lists each group for a person to decide
 * which draft to keep and archive the others as duplicates (Archive... on the
 * draft, naming the keeper).
 *
 *   node scripts/run.mjs scripts/report-live-draft-duplicates.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { semanticKey } from "../lib/content-dedup";
import { draftPrimaryKeyword, draftTargetUrl, normalizeTargetUrl } from "../lib/draft-uniqueness";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const TENANT = process.env.DEFAULT_TENANT_ID || "00000000-0000-0000-0000-000000000001";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { data, error } = await sb
  .from("content_drafts")
  .select("id, title, status, format, metadata, updated_at")
  .eq("tenant_id", TENANT)
  .not("status", "in", "(archived,published)");
if (error) throw new Error(error.message);

const groups = new Map<string, { id: string; title: string; status: string; updated: string }[]>();
for (const d of data ?? []) {
  const meta = (d.metadata as Record<string, unknown> | null) ?? {};
  const row = { id: String(d.id).slice(0, 8), title: (d.title as string) ?? "(untitled)", status: d.status as string, updated: String(d.updated_at).slice(0, 10) };
  const kw = draftPrimaryKeyword(meta);
  if (kw) {
    const k = `keyword: ${semanticKey(kw)}`;
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  const url = draftTargetUrl(meta);
  if (url) {
    const k = `url: ${normalizeTargetUrl(url)}`;
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
}
const dupes = [...groups].filter(([, rows]) => rows.length > 1);
console.log(`${data?.length ?? 0} open drafts; ${dupes.length} shared keyword/URL group(s)\n`);
for (const [k, rows] of dupes) {
  console.log(k);
  for (const r of rows) console.log(`   ${r.id}  ${r.status.padEnd(12)} ${r.updated}  ${r.title}`);
}
