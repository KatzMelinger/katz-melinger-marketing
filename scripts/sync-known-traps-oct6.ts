import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { OCT6_TRAPS } from "../lib/known-traps-oct6";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const TENANT = "00000000-0000-0000-0000-000000000001";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { data: rows } = await sb.from("content_known_traps").select("id,label,pattern,match_on").eq("tenant_id", TENANT);
let changed = 0;
for (const t of OCT6_TRAPS) {
  const row = rows!.find((r) => r.label.toLowerCase() === t.label.toLowerCase());
  if (!row) { console.log("MISSING", t.label); continue; }
  const upd = { match_type: t.matchType, pattern: t.pattern, unless: t.unless, severity: t.severity, match_on: t.matchOn ?? null,
    case_sensitive: !!t.caseSensitive, regex_flags: t.regexFlags ?? null, scope: t.scope ?? null, applies_to: t.appliesTo ?? "all", updated_at: new Date().toISOString() };
  if (row.pattern !== t.pattern) { changed++; console.log("pattern updated:", t.label); }
  const { error } = await sb.from("content_known_traps").update(upd).eq("id", row.id);
  if (error) console.log("ERROR", t.label, error.message);
}
const ny = rows!.find((r) => r.label === "NYSDHR sexual harassment deadline stated as 1 year");
const { error } = await sb.from("content_known_traps").update({ match_on: "sentences", updated_at: new Date().toISOString() }).eq("id", ny!.id);
console.log(error ? "ERROR nysdhr " + error.message : "NYSDHR rule: now one sentence");
console.log("oct6 rows synced:", OCT6_TRAPS.length, "patterns changed:", changed);
