/**
 * One-off: set the default tenant's tenant_settings.firm_name.
 * Usage: node scripts/set-firm-name.mjs "Katz Melinger PLLC"
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Minimal .env.local loader (only the two vars we need).
const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE URL or SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const name = process.argv[2];
if (!name) {
  console.error('Pass the firm name, e.g. node scripts/set-firm-name.mjs "Katz Melinger PLLC"');
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await sb
  .from("tenant_settings")
  .update({ firm_name: name, updated_at: new Date().toISOString() })
  .eq("tenant_id", DEFAULT_TENANT_ID)
  .select("tenant_id, firm_name");

if (error) {
  console.error("Update failed:", error.message);
  process.exit(1);
}
console.log("Updated:", data);
