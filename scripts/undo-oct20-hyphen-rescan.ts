/**
 * Put back the hyphens the Oct 20 rescan removed.
 *
 *   node scripts/run.mjs scripts/undo-oct20-hyphen-rescan.ts            # dry run
 *   node scripts/run.mjs scripts/undo-oct20-hyphen-rescan.ts --apply    # writes
 *
 * "Rescan all open drafts" was pressed at 22:02:14 UTC on 2026-10-20, while
 * the deploy that retires the hyphen rule (PR #51) was still going out
 * (production deployment created 22:02:28). The batches before the switch ran
 * the old fixer and de-hyphenated 112 sentences ("write-ups" -> "write ups",
 * "three-year" -> "three year"). Hyphens are allowed (Kenneth, 2026-10-20),
 * so each of those changes is undone here, as if "Undo" were pressed on it.
 *
 * When a later change in the same run rewrote the same sentence (first
 * person, say), the exact undo cannot find the text; the hyphenated words
 * are then put back inside the sentence as it reads now, and nothing else in
 * it changes. Anything that still cannot be placed is listed, not guessed.
 *
 * The run's three knowledge base "constant_mismatch" changes are undone too:
 * each applied Title VII's 15-employee threshold to a sentence about another
 * law (NJLAD "any size" became "15 or more employees", which is false) or
 * garbled the sentence. They are printed for a person to check.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { readFixLog, undoChange, type FixChange } from "../lib/legal-fix-log";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const TENANT = process.env.DEFAULT_TENANT_ID || "00000000-0000-0000-0000-000000000001";
const apply = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const RUN_FROM = Date.parse("2026-10-20T22:00:00Z");
const RUN_TO = Date.parse("2026-10-20T22:10:00Z");
const BY = "scripts/undo-oct20-hyphen-rescan.ts (Kenneth, 2026-10-20)";
const inRun = (c: FixChange) => {
  const t = Date.parse(c.at);
  return t >= RUN_FROM && t <= RUN_TO;
};
const HYPHENATED = /[A-Za-z]+(?:-[A-Za-z]+)+/g;

/** Re-hyphenate, inside `sentence`, the words that were hyphenated in `original`. */
function rehyphenate(sentence: string, original: string): string {
  let out = sentence;
  for (const word of new Set(original.match(HYPHENATED) ?? [])) {
    const spaced = word.replace(/-/g, " ");
    const closed: Record<string, string> = { "e-mail": "email", "co-worker": "coworker", "co-workers": "coworkers" };
    const target = closed[word.toLowerCase()] ?? spaced;
    out = out.split(target).join(word);
  }
  return out;
}

console.log(apply ? "APPLY" : "DRY RUN (add --apply to write)");
const { data: drafts, error } = await sb
  .from("content_drafts")
  .select("id, title, body, metadata")
  .eq("tenant_id", TENANT)
  .neq("status", "archived");
if (error) throw new Error(error.message);

let undone = 0;
let rewoven = 0;
const failed: string[] = [];
const kb: string[] = [];
let draftsWritten = 0;

for (const d of drafts ?? []) {
  const meta = (d.metadata as Record<string, unknown> | null) ?? {};
  const log = readFixLog(meta);
  for (const c of log.changes) {
    if (inRun(c) && c.source_ref === "constant_mismatch") {
      kb.push(`${String(d.id).slice(0, 8)} [${c.where}] ${c.reason}\n      from: ${c.from}\n      to:   ${c.to}`);
    }
  }
  const hyphen = log.changes.filter(
    (c) => inRun(c) && (c.source_ref === "hyphen" || c.source_ref === "constant_mismatch") && !c.undone_at,
  );
  if (!hyphen.length) continue;

  let body = (d.body as string) ?? "";
  const title = (d.title as string | null) ?? null;
  const now = new Date().toISOString();
  const done = new Set<string>();
  // Newest first, so an earlier change is undone after anything layered on it.
  for (const c of [...hyphen].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
    const res = undoChange(body, title, c);
    if (res.ok) {
      body = res.body;
      done.add(c.id);
      undone++;
      continue;
    }
    // A later change rewrote the sentence: follow it to the text that is there now.
    let current = c.to;
    for (const later of log.changes) {
      if (later.id !== c.id && !later.undone_at && Date.parse(later.at) >= Date.parse(c.at) && later.from === current) current = later.to;
    }
    if (current && current !== c.to && body.includes(current)) {
      const fixed = rehyphenate(current, c.from);
      if (fixed !== current) {
        body = body.replace(current, fixed);
        done.add(c.id);
        rewoven++;
        continue;
      }
    }
    failed.push(`${String(d.id).slice(0, 8)}: ${res.error} | ${c.from.slice(0, 100)}`);
  }
  if (!done.size) continue;
  draftsWritten++;
  if (apply) {
    const changes = log.changes.map((c) => (done.has(c.id) ? { ...c, undone_at: now, undone_by: BY } : c));
    const { error: upd } = await sb
      .from("content_drafts")
      .update({ body, metadata: { ...meta, legal_fix_log: { ...log, changes } }, updated_at: now })
      .eq("tenant_id", TENANT)
      .eq("id", d.id);
    if (upd) failed.push(`${String(d.id).slice(0, 8)}: write failed: ${upd.message}`);
  }
}

console.log(`changes undone exactly: ${undone}; hyphens put back in a later-edited sentence: ${rewoven}; drafts: ${draftsWritten}`);
if (failed.length) {
  console.log(`\ncould not place (${failed.length}):`);
  for (const f of failed) console.log("  " + f);
}
console.log(`\nknowledge base changes in the run (${kb.length}), for a person to check:`);
for (const k of kb) console.log("  " + k);
