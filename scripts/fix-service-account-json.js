#!/usr/bin/env node
/**
 * Cleans markdown-link corruption from GOOGLE_SERVICE_ACCOUNT_JSON in
 * .env.local. Whoever moved the credential from Replit → Vercel pasted
 * it through a markdown-aware tool that auto-linkified email + URL
 * values, breaking the JSON. This restores the original strings.
 *
 *   "[foo@bar.com](mailto:foo@bar.com)" → "foo@bar.com"
 *   "[googleapis.com](http://googleapis.com)" → "googleapis.com"
 *
 * After running:
 *   1. Restart `npm run dev`
 *   2. Validate: visit /analytics — should NOT show "Setup Required"
 *   3. Update Vercel env var so production matches (otherwise next
 *      `vercel env pull` will re-corrupt it)
 */
const fs = require("fs");
const path = require("path");

const ENV_PATH = path.resolve(process.cwd(), ".env.local");
if (!fs.existsSync(ENV_PATH)) {
  console.error("ERROR: .env.local not found in current directory");
  process.exit(1);
}

const original = fs.readFileSync(ENV_PATH, "utf8");

// Find the GOOGLE_SERVICE_ACCOUNT_JSON line. It may be wrapped in single or
// double quotes, or unwrapped, and may span just a single line.
const lines = original.split(/\r?\n/);
let touchedLine = -1;
for (let i = 0; i < lines.length; i++) {
  if (!lines[i].startsWith("GOOGLE_SERVICE_ACCOUNT_JSON=")) continue;

  const eq = lines[i].indexOf("=");
  let raw = lines[i].slice(eq + 1).trim();
  // Strip outer quotes if present
  let outerQuote = "";
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    outerQuote = raw[0];
    raw = raw.slice(1, -1);
  }

  // Cleanup: replace `[anything](url)` → `anything`
  // Be careful: only inside string values where this is clearly a corruption.
  const before = raw;
  raw = raw.replace(/\[([^\]]+)\]\(mailto:[^)]+\)/g, "$1");
  raw = raw.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1");

  // Sanity check the result is valid JSON
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error("missing client_email or private_key after cleanup");
    }
    console.log("✓ Cleaned JSON parses successfully");
    console.log("  client_email:", parsed.client_email);
    console.log("  project_id:", parsed.project_id);
    console.log("  universe_domain:", parsed.universe_domain);
  } catch (e) {
    console.error("✗ Cleanup did not produce valid JSON:", e.message);
    console.error("  Original first 200 chars:", before.slice(0, 200));
    console.error("  Cleaned first 200 chars:", raw.slice(0, 200));
    process.exit(1);
  }

  // Re-quote for env file. Use single quotes to safely contain the JSON.
  lines[i] = `GOOGLE_SERVICE_ACCOUNT_JSON='${raw}'`;
  void outerQuote;
  touchedLine = i;
  break;
}

if (touchedLine < 0) {
  console.error("ERROR: GOOGLE_SERVICE_ACCOUNT_JSON line not found in .env.local");
  process.exit(1);
}

// Backup original
const backup = ENV_PATH + ".bak";
fs.writeFileSync(backup, original, "utf8");
fs.writeFileSync(ENV_PATH, lines.join("\n"), "utf8");
console.log(`\n✓ Wrote cleaned .env.local`);
console.log(`✓ Backup saved to ${path.basename(backup)}`);
console.log(`\nNext steps:`);
console.log(`  1. Restart dev server (Ctrl+C then npm run dev)`);
console.log(`  2. Visit http://localhost:3000/analytics — should load real GA4 data`);
console.log(`  3. Update the Vercel env var with the cleaned JSON so prod isn't broken`);
