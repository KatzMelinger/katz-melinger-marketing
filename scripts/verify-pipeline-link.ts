/**
 * Read-only smoke test for the content_pipeline ↔ brief_suggestions ↔
 * content_drafts wiring (Phase 2/3). Confirms the suggestion_id column exists
 * and reports how the current rows are linked. Writes nothing.
 *
 *   node scripts/verify-pipeline-link.ts
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.
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

// Selecting suggestion_id fails loudly if the migration wasn't applied.
const { data, error } = await supabase
  .from("content_pipeline")
  .select("id, title, status, draft_id, suggestion_id");

if (error) {
  console.error(`✗ content_pipeline.suggestion_id NOT found — migration not applied? (${error.message})`);
  process.exit(1);
}

const rows = data ?? [];
const withSuggestion = rows.filter((r) => r.suggestion_id).length;
const withDraft = rows.filter((r) => r.draft_id).length;

console.log("✓ content_pipeline.suggestion_id column exists (migration applied).\n");
console.log(`content_pipeline rows: ${rows.length}`);
console.log(`  linked to a suggestion (suggestion_id set): ${withSuggestion}`);
console.log(`  linked to a draft (draft_id set):           ${withDraft}`);
console.log("\nBy status:");
for (const s of ["idea", "brief", "draft", "review", "published"]) {
  const n = rows.filter((r) => r.status === s).length;
  if (n) console.log(`  ${s.padEnd(10)} ${n}`);
}
console.log("\nWiring OK. Send-to-Production will now stamp suggestion_id; draft");
console.log("generation will set draft_id + status→draft; the board's View-draft");
console.log("link appears once draft_id is populated.");
