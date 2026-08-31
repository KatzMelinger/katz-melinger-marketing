/**
 * Backfill SEO metadata onto drafts that predate D1.
 *
 *   node scripts/run.mjs scripts/backfill-draft-metadata.ts            # dry run
 *   node scripts/run.mjs scripts/backfill-draft-metadata.ts --apply
 *
 * `ensureDraftMetadata` now runs from analysis, so every draft picks metadata
 * up the next time it is analyzed. This exists because most of the library will
 * not be analyzed again on its own, and a fix that only reaches new work leaves
 * the old work looking fixed without being fixed.
 *
 * It calls the SAME function the app calls. A backfill that reimplements the
 * thing it is backfilling will drift from it, and the drift shows up as drafts
 * whose metadata does not match what the app would have written.
 *
 * Costs one model call per draft actually generated. Dry run makes none.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Loaded before any lib/ import, because the Supabase and Anthropic clients
// read process.env when first constructed.
for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  const key = line.slice(0, i).trim();
  if (!process.env[key]) process.env[key] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const APPLY = process.argv.includes("--apply");

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { bodyH1, primaryKeyword, ensureDraftMetadata } = await import("@/lib/draft-metadata");

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await sb
    .from("content_drafts")
    .select("id, tenant_id, title, topic, body, metadata, seo_brief, status")
    .neq("status", "archived")
    .order("created_at", { ascending: true });
  if (error) throw error;

  type Row = {
    id: string; tenant_id: string; title: string | null; topic: string | null;
    body: string; metadata: Record<string, unknown> | null;
    seo_brief: Record<string, unknown> | null; status: string;
  };
  const rows = (data ?? []) as Row[];

  // Same "already has it" test the function uses, so the dry run's count is the
  // count that will actually be attempted rather than an estimate.
  const eligible = rows.filter((d) => {
    const meta = (d.metadata ?? {}) as Record<string, unknown>;
    const km = (meta.km_brief ?? {}) as Record<string, unknown>;
    const seo = (d.seo_brief ?? {}) as Record<string, unknown>;
    const has = (...k: string[]) =>
      [km, seo, meta].some((s) => k.some((n) => typeof (s as Record<string, unknown>)[n] === "string" && String((s as Record<string, unknown>)[n]).trim()));
    if (has("metaTitle", "meta_title") && has("metaDescription", "meta_description")) return false;
    return Boolean(primaryKeyword(d)) && Boolean(bodyH1(d.body ?? ""));
  });

  console.log(`${rows.length} live drafts, ${eligible.length} eligible for backfill.\n`);

  if (!APPLY) {
    for (const d of eligible) console.log(`  ${d.status.padEnd(12)} ${(d.title ?? d.topic ?? d.id).slice(0, 70)}`);
    console.log(`\nDry run. Re-run with --apply to generate (${eligible.length} model calls).`);
    return;
  }

  const tally = { generated: 0, already_present: 0, skipped: 0 };
  for (const [i, d] of eligible.entries()) {
    const label = (d.title ?? d.topic ?? d.id).slice(0, 60);
    try {
      const out = await ensureDraftMetadata(d.id, d.tenant_id);
      tally[out.status]++;
      if (out.status === "generated") {
        console.log(`  [${i + 1}/${eligible.length}] OK    ${label}`);
        console.log(`               ${out.metaTitle}`);
      } else if (out.status === "skipped") {
        console.log(`  [${i + 1}/${eligible.length}] SKIP  ${label} — ${out.reason}`);
      } else {
        console.log(`  [${i + 1}/${eligible.length}] HAD   ${label}`);
      }
    } catch (e) {
      // One draft failing must not abandon the other twenty-two.
      tally.skipped++;
      console.log(`  [${i + 1}/${eligible.length}] FAIL  ${label} — ${(e as Error).message}`);
    }
  }
  console.log(`\ngenerated ${tally.generated} · already had ${tally.already_present} · skipped ${tally.skipped}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
