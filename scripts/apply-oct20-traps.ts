/**
 * Diana's Oct 20 spec, Part 2 items 2, 7 and 9: the trap changes Kenneth
 * approved on 2026-10-20, applied to the live trap table and drafts.
 *
 *   node scripts/run.mjs scripts/apply-oct20-traps.ts            # dry run: writes nothing
 *   node scripts/run.mjs scripts/apply-oct20-traps.ts --apply    # writes
 *
 * Run it AFTER the code from this branch is deployed (the Oct 6 lesson: a
 * pattern the deployed matcher does not understand blocks every draft).
 *
 *   1. Trap 27 and 27es get the patterns in lib/known-traps-oct6.ts ("free
 *      consultation", "consulta gratuita", what lawyers in general offer).
 *   2. The guarantee trap (lib/known-traps-oct20.ts) is added if missing.
 *   3. Trap 8 "Hyphenated compound word" is disabled and its open findings
 *      are dismissed with the reason.
 *   4. eb5d488b: "almost always negotiable" becomes "often negotiable", as
 *      one entry in its Changes made log (undoable, previous version kept,
 *      text-bound sign-offs cleared, log left unreviewed).
 *   5. bf522634 ("New York Employment Lawyer Free Consultation...") is
 *      archived (Kenneth, 2026-10-20); its text and history are kept.
 *
 * Every trap change is recorded in rule_changes, so the Rules page history
 * shows it and Restore works. Also reports how many open website drafts still
 * mention a free consultation; "Rescan all open drafts" on the Rules page
 * deletes those sentences through the normal fixer, with each deletion logged.
 *
 * Never changes a status, never approves, never publishes.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { OCT6_TRAPS } from "../lib/known-traps-oct6";
import { GUARANTEE_TRAP, OCT20_CORRECTIONS, RETIRED_TRAPS } from "../lib/known-traps-oct20";
import { appendRun, changeId, readFixLog, whereIs, type FixChange } from "../lib/legal-fix-log";
import { clearTextCertifications } from "../lib/draft-certifications";
import { findFeeLanguage } from "../lib/fee-language";
import { archiveDrafts } from "../lib/draft-archive";

/** Drafts to archive (Kenneth, 2026-10-20). */
const OCT20_ARCHIVE = [
  {
    draftPrefix: "bf522634",
    reason: 'Off message: the whole draft is built around "free consultation", which is banned since 2026-10-20',
  },
];

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const TENANT = process.env.DEFAULT_TENANT_ID || "00000000-0000-0000-0000-000000000001";
const apply = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const BY = "scripts/apply-oct20-traps.ts (Kenneth, 2026-10-20)";
const WEBSITE_FORMATS = ["blog", "km_page_update", "km_practice_page", "km_blog_post"];
const now = () => new Date().toISOString();

async function ruleChange(action: string, label: string, ref: string, oldValue: unknown, newValue: unknown) {
  const { error } = await sb.from("rule_changes").insert({
    tenant_id: TENANT,
    rule_kind: "trap",
    rule_ref: ref,
    rule_label: label.slice(0, 300),
    action,
    old_value: oldValue ?? null,
    new_value: newValue ?? null,
    status: "applied",
    changed_by_email: BY,
  });
  // rule_changes arrives with supabase/rule_changes_task24.sql; without it the
  // change still applies, it just has no history row.
  if (error) console.log(`   (no history row: ${error.message})`);
}

console.log(apply ? "APPLY: writing changes" : "DRY RUN: nothing is written (add --apply)");
const { data: rows, error: rowsErr } = await sb.from("content_known_traps").select("*").eq("tenant_id", TENANT);
if (rowsErr) throw new Error(rowsErr.message);
const byLabel = (label: string) => (rows ?? []).find((r) => String(r.label).toLowerCase() === label.toLowerCase());

// 1. Trap 27 / 27es.
for (const n of ["27", "27es"]) {
  const t = OCT6_TRAPS.find((x) => x.number === n)!;
  const row = byLabel(t.label);
  if (!row) {
    console.log(`!! trap ${n} "${t.label}" not found`);
    continue;
  }
  if (row.pattern === t.pattern && row.note === t.note) {
    console.log(`=  trap ${n} already current`);
    continue;
  }
  console.log(`~  trap ${n}: pattern and note updated (free consultation banned)`);
  if (apply) {
    const { data, error } = await sb
      .from("content_known_traps")
      .update({ pattern: t.pattern, note: t.note, updated_at: now() })
      .eq("id", row.id)
      .select()
      .maybeSingle();
    if (error) console.log(`!! ${error.message}`);
    else await ruleChange("update", t.label, String(row.id), row, data);
  }
}

// 2. Guarantee trap.
if (byLabel(GUARANTEE_TRAP.label)) {
  console.log("=  guarantee trap already present");
} else {
  console.log(`+  add trap "${GUARANTEE_TRAP.label}" (critical)`);
  if (apply) {
    const { data, error } = await sb
      .from("content_known_traps")
      .insert({
        tenant_id: TENANT,
        label: GUARANTEE_TRAP.label,
        match_type: GUARANTEE_TRAP.matchType,
        pattern: GUARANTEE_TRAP.pattern,
        unless: GUARANTEE_TRAP.unless,
        severity: GUARANTEE_TRAP.severity,
        note: GUARANTEE_TRAP.note,
        match_on: GUARANTEE_TRAP.matchOn ?? null,
        case_sensitive: !!GUARANTEE_TRAP.caseSensitive,
        applies_to: GUARANTEE_TRAP.appliesTo ?? "all",
        enabled: true,
        updated_at: now(),
      })
      .select()
      .maybeSingle();
    if (error) console.log(`!! ${error.message}`);
    else await ruleChange("create", GUARANTEE_TRAP.label, String(data?.id ?? ""), null, data);
  }
}

// 3. Retired traps.
for (const r of RETIRED_TRAPS) {
  const row = byLabel(r.label);
  if (!row) {
    console.log(`=  "${r.label}" not in the table`);
    continue;
  }
  const { data: open } = await sb
    .from("content_findings")
    .select("id")
    .eq("tenant_id", TENANT)
    .eq("rule_id", `trap:${row.id}`)
    .in("status", ["open", "in_progress"]);
  console.log(`-  disable "${r.label}"${row.enabled ? "" : " (already off)"}; dismiss ${open?.length ?? 0} open finding(s)`);
  if (apply) {
    if (row.enabled) {
      const { data, error } = await sb
        .from("content_known_traps")
        .update({ enabled: false, updated_at: now() })
        .eq("id", row.id)
        .select()
        .maybeSingle();
      if (error) console.log(`!! ${error.message}`);
      else await ruleChange("disable", r.label, String(row.id), row, data);
    }
    if (open?.length) {
      const { error } = await sb
        .from("content_findings")
        .update({ status: "dismissed", resolved_at: now(), resolution_note: r.reason, updated_at: now() })
        .in("id", open.map((f) => f.id));
      if (error) console.log(`!! findings: ${error.message}`);
    }
  }
}

// 4. Hand-verified corrections.
for (const c of OCT20_CORRECTIONS) {
  // ids are uuids, so the 8-character prefix is matched here, not in SQL.
  const { data: drafts } = await sb
    .from("content_drafts")
    .select("id, title, body, metadata, status")
    .eq("tenant_id", TENANT)
    .neq("status", "archived");
  const d = (drafts ?? []).find((x) => String(x.id).startsWith(c.draftPrefix));
  if (!d) {
    console.log(`!! ${c.draftPrefix} not found`);
    continue;
  }
  const body = (d.body as string) ?? "";
  const count = body.split(c.find).length - 1;
  if (count !== 1) {
    console.log(`=  ${c.draftPrefix}: "${c.find}" found ${count} times, skipped`);
    continue;
  }
  const at = body.indexOf(c.find);
  console.log(`~  ${c.draftPrefix} (${d.title}): "${c.find}" -> "${c.replace}"`);
  if (apply) {
    const change: FixChange = {
      id: changeId(),
      where: whereIs(body, at),
      from: c.find,
      to: c.replace,
      reason: c.reason,
      source: "brand rule",
      source_ref: "oct20_guarantee",
      anchor_before: body.slice(Math.max(0, at - 60), at),
      at: now(),
    };
    const meta = (d.metadata as Record<string, unknown> | null) ?? {};
    const log = appendRun(readFixLog(meta), { previousTitle: (d.title as string | null) ?? null, previousBody: body, changes: [change] });
    const nextMeta = clearTextCertifications({ ...meta, legal_fix_log: log }).meta;
    const { error } = await sb
      .from("content_drafts")
      .update({ body: body.replace(c.find, c.replace), metadata: nextMeta, updated_at: now() })
      .eq("tenant_id", TENANT)
      .eq("id", d.id);
    if (error) console.log(`!! ${error.message}`);
  }
}

// 5. Drafts archived on Kenneth's call (2026-10-20). Archiving never deletes.
for (const a of OCT20_ARCHIVE) {
  const { data: live } = await sb
    .from("content_drafts")
    .select("id, title, status")
    .eq("tenant_id", TENANT)
    .neq("status", "archived");
  const d = (live ?? []).find((x) => String(x.id).startsWith(a.draftPrefix));
  if (!d) {
    console.log(`=  ${a.draftPrefix} not live (already archived or not found)`);
    continue;
  }
  console.log(`-  archive ${a.draftPrefix} (${d.title}): ${a.reason}`);
  if (apply) {
    const r = await archiveDrafts({ supabase: sb, tenantId: TENANT, ids: [d.id as string], keeperId: null, reason: a.reason, archivedBy: BY });
    if (r.errors.length) console.log(`!! ${r.errors.join("; ")}`);
  }
}

// Report: open website drafts that still offer a free consultation.
const { data: open } = await sb
  .from("content_drafts")
  .select("id, title, body, status")
  .eq("tenant_id", TENANT)
  .in("format", WEBSITE_FORMATS)
  .not("status", "in", "(archived,published)");
const fee = (open ?? []).filter((d) =>
  findFeeLanguage((d.body as string) ?? "").some((h) => h.rule === "Free consultation" || h.rule === "What lawyers offer or charge"),
);
console.log(`\n${fee.length} open website draft(s) still mention a free consultation or what lawyers offer:`);
for (const d of fee) console.log(`   ${String(d.id).slice(0, 8)}  ${d.title}`);
if (fee.length) console.log('Press "Rescan all open drafts" on the Rules page to delete those sentences (each one logged in Changes made).');
