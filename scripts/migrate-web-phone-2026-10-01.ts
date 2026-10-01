/**
 * Replace the old blog number 646-849-3352 with 212-460-0047 in existing
 * drafts (Diana, 2026-10-01: 212-460-0047 is the CallRail Website pool's swap
 * target; 646-849-3352 is a rotating pool number and must not be printed).
 *
 *   node scripts/run.mjs scripts/migrate-web-phone-2026-10-01.ts           # dry run
 *   node scripts/run.mjs scripts/migrate-web-phone-2026-10-01.ts --apply
 *
 * Blog and page formats, any status except published (a published page is
 * changed on WordPress, not here). Each replacement is logged in the draft's
 * Changes made (source "required element"), undoable on its own. Also updates
 * the "Closing CTA" row in compliance_disclaimers. Writes the same format the
 * draft used ("(646) 849-3352" becomes "(212) 460-0047").
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { appendRun, changeId, readFixLog, type FixChange } from "../lib/legal-fix-log";
import { PAGE_FORMATS } from "../lib/draft-metadata";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const TENANT = process.env.DEFAULT_TENANT_ID || "00000000-0000-0000-0000-000000000001";
const apply = process.argv.includes("--apply");

const OLD = /(\+?1[\s.-]?)?(\()?646(\))?([\s.-]?)849([\s.-]?)3352/g;
const toNew = (m: string) =>
  m.replace(/646/, "212").replace(/849/, "460").replace(/3352/, "0047");

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const drafts: { id: string; title: string | null; status: string; format: string; body: string | null; metadata: Record<string, unknown> | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("content_drafts")
      .select("id,title,status,format,body,metadata")
      .eq("tenant_id", TENANT)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    drafts.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  let touched = 0, total = 0;
  for (const d of drafts) {
    if (!PAGE_FORMATS.has(d.format) || d.status === "published") continue;
    const body = d.body ?? "";
    const hits = [...body.matchAll(OLD)];
    if (!hits.length) continue;
    touched++;
    total += hits.length;
    console.log(`${d.id.slice(0, 8)}  ${hits.length}x  [${d.status}]  ${(d.title ?? "(no title)").slice(0, 60)}`);
    if (!apply) continue;

    let next = body;
    const at = new Date().toISOString();
    const changes: FixChange[] = [];
    for (let guard = 0; guard < 50; guard++) {
      OLD.lastIndex = 0;
      const m = OLD.exec(next);
      if (!m) break;
      const replacement = toNew(m[0]);
      const anchor = next.slice(Math.max(0, m.index - 40), m.index);
      next = next.slice(0, m.index) + replacement + next.slice(m.index + m[0].length);
      changes.push({
        id: changeId(), where: "Phone number", from: m[0], to: replacement,
        reason: "Blogs and pages print 212-460-0047, the CallRail Website pool's swap target. 646-849-3352 is a rotating pool number (Diana, 2026-10-01).",
        source: "required element", source_ref: "web_phone", anchor_before: anchor, at,
      });
    }
    const meta = d.metadata ?? {};
    const log = appendRun(readFixLog(meta), { previousTitle: d.title, previousBody: body, changes });
    const { error } = await sb
      .from("content_drafts")
      .update({ body: next, metadata: { ...meta, legal_fix_log: log }, updated_at: at })
      .eq("tenant_id", TENANT)
      .eq("id", d.id);
    if (error) console.log(`   failed: ${error.message}`);
  }

  console.log(`\n${touched} draft(s), ${total} occurrence(s).`);
  if (apply) {
    const { error, count } = await sb
      .from("compliance_disclaimers")
      .update({ text: "Call today at 212-460-0047 for a Free Confidential Case Evaluation." }, { count: "exact" })
      .eq("tenant_id", TENANT)
      .eq("label", "Closing CTA");
    console.log(error ? `CTA row failed: ${error.message}` : `compliance_disclaimers Closing CTA updated (${count} row).`);
  } else {
    console.log("Dry run: nothing written. Re-run with --apply.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
