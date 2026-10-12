/**
 * Oct 6 spec, Task 8: the data half for the gender draft (43fb024e).
 *
 *   node scripts/run.mjs scripts/apply-task8-data.ts           dry run
 *   node scripts/run.mjs scripts/apply-task8-data.ts --apply   write
 *
 * 1. The NYSHRL administrative deadline entry takes the label Diana's spec
 *    gives (kb_nysdhr_deadline), so every correction it makes reads "NYSHRL
 *    administrative filing deadline (New York State Division of Human
 *    Rights) is 3 years for claims arising on or after February 15, 2024,
 *    not 1 year." Recorded in Rules history.
 * 2. The two deadline entries in 43fb024e's Changes made get that reason
 *    (they cited the lawsuit deadline; lib/legal-value-check.ts now picks the
 *    entry in the figure's own clause).
 * 3. The retired "unclassified" rule's stored findings leave content_findings
 *    on every draft. They are MOVED to content_findings_archive, not
 *    destroyed, so the record survives.
 *
 * Idempotent.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const TENANT = "00000000-0000-0000-0000-000000000001";
const DRAFT = "43fb024e-2cf3-4e9d-a4b0-aaae28a9d2fe";
const CHANGE_IDS = ["cmun2kne89q", "cmun2kne89r"];
const LABEL = "NYSHRL administrative filing deadline (New York State Division of Human Rights)";
const REASON =
  "NYSHRL administrative filing deadline (New York State Division of Human Rights) is 3 years for claims arising on or after February 15, 2024, not 1 year.";
const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // 1. Label.
  const { data: kb } = await sb
    .from("legal_knowledge_base")
    .select("*")
    .eq("tenant_id", TENANT)
    .eq("entry_type", "threshold")
    .eq("key", "nyshrl_admin_complaint_deadline")
    .single();
  console.log(`label: "${kb!.label}" -> "${LABEL}"${kb!.label === LABEL ? " (already)" : ""}`);
  if (APPLY && kb!.label !== LABEL) {
    const { error } = await sb
      .from("legal_knowledge_base")
      .update({ label: LABEL, version: (kb!.version ?? 1) + 1, updated_by: "kenneth-2026-10-12", updated_at: new Date().toISOString() })
      .eq("id", kb!.id);
    if (error) throw new Error(error.message);
    await sb.from("rule_changes").insert({
      tenant_id: TENANT, rule_kind: "kb", rule_ref: "threshold:nyshrl_admin_complaint_deadline", rule_label: LABEL,
      action: "update", old_value: { label: kb!.label }, new_value: { label: LABEL }, status: "applied",
      changed_by_email: "kjkatz@katzmelinger.com", decided_by_email: "kjkatz@katzmelinger.com", decided_at: new Date().toISOString(),
      decision_note: "Oct 6 spec, Task 8 (kb_nysdhr_deadline.reason_label), requested by Kenneth 2026-10-12. Label only; value unchanged.",
    });
  }

  // 2. Reasons on 43fb024e.
  const { data: d } = await sb.from("content_drafts").select("metadata").eq("id", DRAFT).single();
  const meta = (d!.metadata ?? {}) as Record<string, any>;
  const changes = (meta.legal_fix_log?.changes ?? []) as { id: string; reason: string }[];
  const targets = changes.filter((c) => CHANGE_IDS.includes(c.id));
  for (const c of targets) console.log(`reason ${c.id}: "${c.reason}"${c.reason === REASON ? " (already)" : ` -> "${REASON}"`}`);
  if (APPLY && targets.some((c) => c.reason !== REASON)) {
    const next = { ...meta, legal_fix_log: { ...meta.legal_fix_log, changes: changes.map((c) => (CHANGE_IDS.includes(c.id) ? { ...c, reason: REASON } : c)) } };
    const { error } = await sb.from("content_drafts").update({ metadata: next }).eq("id", DRAFT);
    if (error) throw new Error(error.message);
  }

  // 3. Unclassified findings -> archive.
  const { data: rows, error: readErr } = await sb.from("content_findings").select("*").eq("rule_id", "unclassified");
  if (readErr) throw new Error(readErr.message);
  console.log(`unclassified findings to archive: ${rows!.length}`);
  if (APPLY && rows!.length) {
    for (let i = 0; i < rows!.length; i += 200) {
      const batch = rows!.slice(i, i + 200);
      const { error: insErr } = await sb
        .from("content_findings_archive")
        .upsert(batch.map((r) => ({ ...r, archived_at: new Date().toISOString() })), { onConflict: "id" });
      if (insErr) throw new Error(`archive insert: ${insErr.message}`);
      const { error: delErr } = await sb.from("content_findings").delete().in("id", batch.map((r) => r.id));
      if (delErr) throw new Error(`delete after archive: ${delErr.message}`);
    }
    const { count } = await sb.from("content_findings").select("id", { count: "exact", head: true }).eq("rule_id", "unclassified");
    const { count: archived } = await sb.from("content_findings_archive").select("id", { count: "exact", head: true }).eq("rule_id", "unclassified");
    console.log(`left in content_findings: ${count}; in archive: ${archived}`);
  }
  if (!APPLY) console.log("dry run: nothing written (add --apply)");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
