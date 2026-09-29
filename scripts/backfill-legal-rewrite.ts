/**
 * The section 9 backfill: run "Fix known errors" over every open website draft
 * and produce the results report Diana asked for.
 *
 *   node scripts/run.mjs scripts/backfill-legal-rewrite.ts                 # dry run, no model calls, writes nothing
 *   node scripts/run.mjs scripts/backfill-legal-rewrite.ts --with-model    # dry run incl. sentence rewrites (costs model calls)
 *   node scripts/run.mjs scripts/backfill-legal-rewrite.ts --apply         # rewrites, logs, re-analyses
 *   ... --only 43fb024e,8743c7a6    limit to these id prefixes
 *   ... --out report.md             also write the report to a file
 *
 * Scope (spec section 9): website formats only (blog, km_blog_post,
 * km_page_update, km_practice_page); never social or email; never archived or
 * published drafts. Never changes a status, never approves or publishes.
 * Run scripts/archive-duplicates-sept28.ts FIRST so duplicates are not rewritten.
 *
 * With --apply each changed draft is re-analysed (notifications off: a
 * backfill is one maintenance action, not a hundred events).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { fixDraft, REWRITE_FORMATS, type FixDraftOutcome } from "../lib/auto-fix-draft";
import { analyzeDraft } from "../lib/content-analysis";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const TENANT = process.env.DEFAULT_TENANT_ID || "00000000-0000-0000-0000-000000000001";
const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const withModel = apply || argv.includes("--with-model");
const only = (() => {
  const i = argv.indexOf("--only");
  return i >= 0 && argv[i + 1] ? argv[i + 1].split(",").map((s) => s.trim()) : null;
})();
const out = (() => {
  const i = argv.indexOf("--out");
  return i >= 0 ? argv[i + 1] : null;
})();

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const drafts: { id: string; title: string | null; format: string | null; status: string; topic: string | null; practice_area: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("content_drafts")
      .select("id, title, format, status, topic, practice_area")
      .eq("tenant_id", TENANT)
      .in("format", [...REWRITE_FORMATS])
      .not("status", "in", "(archived,published)")
      .order("created_at", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    drafts.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const targets = only ? drafts.filter((d) => only.some((p) => d.id.startsWith(p))) : drafts;
  console.log(`${targets.length} website draft(s) in scope. Mode: ${apply ? "APPLY" : withModel ? "dry run with model" : "dry run, deterministic only"}.\n`);

  const rows: FixDraftOutcome[] = [];
  for (const d of targets) {
    try {
      const r = await fixDraft({
        draftId: d.id,
        tenantId: TENANT,
        dryRun: !apply,
        noModel: !withModel,
        websiteFormatsOnly: true,
        actor: { id: null, email: "backfill-2026-09-28" },
      });
      rows.push(r);
      const flag = r.fullRedraft ? "FULL REDRAFT" : r.skipped ? `skipped (${r.skipped})` : `${r.changes} change(s)`;
      console.log(`${d.id.slice(0, 8)}  ${flag.padEnd(22)} ${(d.title ?? "(no title)").slice(0, 70)}`);
      if (apply && r.result && r.changes > 0) {
        await analyzeDraft({
          draftId: d.id,
          body: r.result.body,
          title: r.result.title,
          topic: d.topic,
          format: d.format,
          practiceArea: d.practice_area,
          tenantId: TENANT,
          notify: false,
        }).catch((e) => console.warn(`   analysis failed: ${e instanceof Error ? e.message : e}`));
      }
    } catch (e) {
      console.warn(`${d.id.slice(0, 8)}  ERROR ${e instanceof Error ? e.message : e}`);
    }
  }

  // The results report (spec section 9): each draft, changes made, anything
  // routed to attorney review, and any draft flagged for a full redraft.
  const lines = [
    `# Legal rewrite backfill: ${apply ? "applied" : "dry run"} ${new Date().toISOString().slice(0, 10)}`,
    "",
    `Drafts in scope: ${targets.length}. Changed: ${rows.filter((r) => r.changes > 0).length}. Full redraft: ${rows.filter((r) => r.fullRedraft).length}.`,
    "",
    "| Draft | Title | Changes | By source | Attorney review | Full redraft |",
    "|---|---|---|---|---|---|",
    ...rows.map((r) => {
      const bySource = Object.entries(
        (r.result?.changes ?? []).reduce<Record<string, number>>((a, c) => ((a[c.source] = (a[c.source] ?? 0) + 1), a), {}),
      )
        .map(([k, v]) => `${k} ${v}`)
        .join(", ");
      return `| ${r.draftId.slice(0, 8)} | ${(r.title ?? "(no title)").replace(/\|/g, "/").slice(0, 60)} | ${r.changes} | ${bySource || "-"} | ${
        r.attorneyReview.map((a) => a.replace(/\|/g, "/")).join("; ") || "-"
      } | ${r.fullRedraft ?? "-"} |`;
    }),
  ];
  const report = lines.join("\n");
  console.log(`\n${report}`);
  if (out) {
    writeFileSync(out, report);
    console.log(`\nReport written to ${out}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
