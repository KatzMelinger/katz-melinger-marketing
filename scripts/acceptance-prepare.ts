/**
 * Before the acceptance run (Oct 6 spec, Task 14): do what the app does when a
 * draft is opened or "Fix known errors" is pressed, for drafts nobody has
 * opened since the rules changed.
 *
 *   node scripts/run.mjs scripts/acceptance-prepare.ts           dry run
 *   node scripts/run.mjs scripts/acceptance-prepare.ts --apply
 *
 * 1. Close open findings that quote text no longer in their draft (Task 21),
 *    on every open draft, exactly as opening the draft does.
 * 2. Run the Task 23 fixer on 43fb024e (the spec's test draft), as "Fix known
 *    errors" does: each change is logged in Changes made with Undo, and the log
 *    is left unreviewed, which holds approval until someone marks it Reviewed.
 *    Then re-run its analysis.
 */
import { readFileSync } from "node:fs";

for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

import { getSupabaseAdmin } from "../lib/supabase-server";
import { closeStaleFindings, listFindings } from "../lib/content-findings-store";
import { quoteStillPresent } from "../lib/finding-currency";
import { fixDraft } from "../lib/auto-fix-draft";
import { primaryKeyword } from "../lib/draft-metadata";

const T = "00000000-0000-0000-0000-000000000001";
const GENDER = "43fb024e-2cf3-4e9d-a4b0-aaae28a9d2fe";
const APPLY = process.argv.includes("--apply");

async function main() {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("content_drafts")
    .select("id, body, status")
    .eq("tenant_id", T)
    .not("status", "in", "(archived,published)")
    .limit(3000);
  let stale = 0;
  let closed = 0;
  for (const d of data ?? []) {
    const fs = await listFindings(d.id as string);
    const n = fs.filter((f) => (f.status === "open" || f.status === "in_progress") && quoteStillPresent(f, (d.body as string) ?? "") === false).length;
    stale += n;
    if (APPLY && n) closed += (await closeStaleFindings({ draftId: d.id as string, tenantId: T, body: (d.body as string) ?? "", findings: fs })).closed.length;
  }
  console.log(`stale open findings: ${stale}${APPLY ? `, closed ${closed}` : ""}`);

  const dry = await fixDraft({ draftId: GENDER, tenantId: T, dryRun: true });
  console.log(`43fb024e fixer: ${dry.changes} change(s) pending:`);
  for (const c of dry.result?.changes ?? []) console.log(`  - ${c.reason} | "${c.from.slice(0, 70)}" -> "${c.to.slice(0, 70)}"`);
  if (dry.attorneyReview.length) console.log(`  left for a person: ${dry.attorneyReview.join(" | ")}`);
  if (!APPLY) return console.log("dry run: nothing written (add --apply)");

  const out = await fixDraft({ draftId: GENDER, tenantId: T, actor: { id: null, email: "kjkatz@katzmelinger.com" } });
  console.log(`applied ${out.changes} change(s)`);
  const { data: g } = await sb.from("content_drafts").select("*").eq("id", GENDER).single();
  const { analyzeDraft } = await import("../lib/content-analysis");
  await analyzeDraft({
    draftId: GENDER,
    body: g.body,
    title: g.title,
    topic: g.topic,
    format: g.format,
    practiceArea: g.practice_area,
    targetKeywords: [primaryKeyword(g)].filter(Boolean),
    tenantId: T,
    notify: false,
  });
  console.log("43fb024e re-analyzed");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
