/**
 * The OSHA private-lawsuit trap (attorney review, 2026-09-30).
 *
 *   node scripts/run.mjs scripts/check-osha-trap.ts
 *
 * Reads the pattern straight out of the SQL file so the tested pattern and the
 * loaded one cannot drift, then runs it through the real matcher.
 */
import { readFileSync } from "node:fs";
import { matchTrap, type KnownTrap } from "../lib/known-traps";

const sql = readFileSync("supabase/content_known_traps_osha_and_statutes_2026_09_30.sql", "utf8");
const m = sql.match(/'OSHA retaliation described as a private lawsuit',\s*'regex',\s*'((?:[^']|'')+)'/);
if (!m) throw new Error("pattern not found in the SQL file");
const trap = {
  id: "osha",
  label: "OSHA retaliation described as a private lawsuit",
  matchType: "regex",
  pattern: m[1].replace(/''/g, "'"),
  unless: [],
  severity: "important",
  note: "",
  enabled: true,
} as unknown as KnownTrap;

const FIRE = [
  "You can sue your employer for OSHA retaliation.",
  "If you were fired for an OSHA complaint, you may file a lawsuit in federal court.",
  "Under the OSH Act, workers who face retaliation can take their employer to court and sue for back pay.",
];
const PASS = [
  "You must file a retaliation complaint with OSHA within 30 days.",
  "Only the Secretary of Labor can sue under OSHA section 11(c).",
  "There is no private right to sue under OSHA, but New York Labor Law § 740 allows a lawsuit.",
  "You may pursue an OSHA complaint, and you cannot sue under section 11(c) yourself.",
  "OSHA investigates the complaint. Your employer may face a lawsuit under other laws.",
  "You can sue for wrongful termination under the NYCHRL.",
];

let failed = 0;
for (const s of FIRE) if (matchTrap(trap, s).length === 0) { failed++; console.log(`FAIL should fire: ${s}`); }
for (const s of PASS) if (matchTrap(trap, s).length > 0) { failed++; console.log(`FAIL should pass: ${s}`); }
const total = FIRE.length + PASS.length;
console.log(`${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
