/**
 * One-off: retroactively confirm the cannibalization gate on ALREADY-approved
 * brief_suggestions, so existing approved briefs are one-click-generatable on
 * the Production Board (matching the forward behavior added to the suggestions
 * PATCH route, which flips this on new approvals).
 *
 * Sets suggested_brief.cannibalizationConfirmed = true on every row with
 * status='approved' that isn't already confirmed. Approval was the human
 * sign-off; generation still runs the live content-overlap check server-side,
 * so this only relaxes the UI gate.
 *
 * Dry-run by default:
 *   node scripts/confirm-approved-cannibalization.ts
 * To write:
 *   node scripts/confirm-approved-cannibalization.ts --apply
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

const { data, error } = await supabase
  .from("brief_suggestions")
  .select("id, primary_keyword, suggested_brief")
  .eq("status", "approved");
if (error) {
  console.error(`load brief_suggestions: ${error.message}`);
  process.exit(1);
}

console.log(
  APPLY ? "APPLY mode — writing changes.\n" : "DRY-RUN — no writes. Re-run with --apply.\n",
);

let changed = 0;
for (const row of data ?? []) {
  const brief =
    row.suggested_brief && typeof row.suggested_brief === "object"
      ? { ...(row.suggested_brief as Record<string, unknown>) }
      : {};
  if (brief.cannibalizationConfirmed === true) continue;

  changed++;
  console.log(`  • confirm [${row.primary_keyword}]`);
  if (APPLY) {
    brief.cannibalizationConfirmed = true;
    const { error: uErr } = await supabase
      .from("brief_suggestions")
      .update({ suggested_brief: brief })
      .eq("id", row.id);
    if (uErr) console.error(`    ! update failed: ${uErr.message}`);
  }
}

console.log(`\n${changed} approved brief(s) ${APPLY ? "confirmed" : "would be confirmed"}.`);
console.log("Done.");
