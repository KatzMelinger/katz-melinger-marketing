/**
 * One-off cleanup: strip non-NY/NJ ("other_state") keywords from EXISTING
 * content rows. The forward fix lives in /api/seo/suggestions (it filters new
 * suggestions); this script cleans the rows that were created before that fix —
 * e.g. the "Wrongful Termination Lawyer" brief that carried
 * "wrongful termination california".
 *
 * Cleans two places:
 *   - brief_suggestions.secondary_keywords (jsonb array)
 *   - brief_suggestions.suggested_brief.secondaryKeywords (nested jsonb)
 *   - content_pipeline.keywords (comma-joined string shown on the board)
 *
 * Reuses the LIVE classifier (lib/keyword-geo.ts) so it stays in lockstep with
 * the forward filter — no duplicated state list. Runs under Node's native TS
 * type-stripping (Node >= 22.18 / 23.6; verified on v26), so plain `node` works.
 *
 * Usage (DRY-RUN by default — prints what it would change, writes nothing):
 *   node scripts/clean-existing-geo-keywords.ts
 * To actually write the changes:
 *   node scripts/clean-existing-geo-keywords.ts --apply
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.
 * The service-role key bypasses RLS, so it cleans every tenant in one pass.
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { classifyKeywordGeo } from "../lib/keyword-geo.ts";

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

const isOutOfState = (kw: unknown): boolean =>
  typeof kw === "string" && classifyKeywordGeo(kw).state === "other_state";

function splitKept(arr: unknown): { kept: string[]; removed: string[] } {
  const kept: string[] = [];
  const removed: string[] = [];
  if (Array.isArray(arr)) {
    for (const k of arr) {
      if (typeof k !== "string") continue;
      (isOutOfState(k) ? removed : kept).push(k);
    }
  }
  return { kept, removed };
}

/** Page through a table so we don't silently cap at Supabase's 1000-row default. */
async function fetchAll(table: string, columns: string): Promise<any[]> {
  const rows: any[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(`load ${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function cleanBriefSuggestions(): Promise<void> {
  console.log("brief_suggestions:");
  const rows = await fetchAll("brief_suggestions", "id, primary_keyword, secondary_keywords, suggested_brief");
  let changed = 0;

  for (const row of rows) {
    const sec = splitKept(row.secondary_keywords);

    const brief =
      row.suggested_brief && typeof row.suggested_brief === "object"
        ? { ...row.suggested_brief }
        : null;
    let briefRemoved: string[] = [];
    if (brief && Array.isArray(brief.secondaryKeywords)) {
      const r = splitKept(brief.secondaryKeywords);
      brief.secondaryKeywords = r.kept;
      briefRemoved = r.removed;
    }

    const removed = [...new Set([...sec.removed, ...briefRemoved])];
    if (removed.length === 0) continue;

    changed++;
    console.log(`  • [${row.primary_keyword}] drop: ${removed.join(" | ")}`);

    if (APPLY) {
      const update: Record<string, unknown> = { secondary_keywords: sec.kept };
      if (brief) update.suggested_brief = brief;
      const { error } = await supabase.from("brief_suggestions").update(update).eq("id", row.id);
      if (error) console.error(`    ! update failed: ${error.message}`);
    }
  }

  console.log(`  → ${changed} row(s) ${APPLY ? "updated" : "would change"}\n`);
}

async function cleanPipelineKeywords(): Promise<void> {
  console.log("content_pipeline:");
  const rows = await fetchAll("content_pipeline", "id, title, keywords");
  let changed = 0;

  for (const row of rows) {
    if (typeof row.keywords !== "string" || !row.keywords.trim()) continue;
    const parts = row.keywords.split(",").map((s: string) => s.trim()).filter(Boolean);
    const removed = [...new Set(parts.filter(isOutOfState))];
    if (removed.length === 0) continue;

    const kept = parts.filter((k: string) => !isOutOfState(k)).join(", ");
    changed++;
    console.log(`  • [${row.title}] drop: ${removed.join(" | ")}`);

    if (APPLY) {
      const { error } = await supabase
        .from("content_pipeline")
        .update({ keywords: kept || null })
        .eq("id", row.id);
      if (error) console.error(`    ! update failed: ${error.message}`);
    }
  }

  console.log(`  → ${changed} row(s) ${APPLY ? "updated" : "would change"}\n`);
}

console.log(
  APPLY
    ? "APPLY mode — writing changes to Supabase.\n"
    : "DRY-RUN — no writes. Re-run with --apply to commit.\n",
);
await cleanBriefSuggestions();
await cleanPipelineKeywords();
console.log("Done.");
