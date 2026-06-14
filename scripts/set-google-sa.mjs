/**
 * One-off: insert a Google service-account JSON file into .env.local as a single
 * correctly-escaped GOOGLE_SERVICE_ACCOUNT_JSON line.
 *
 * Usage: node scripts/set-google-sa.mjs "C:\\path\\to\\service-account.json"
 *
 * The value is minified (one line) and wrapped in SINGLE quotes so dotenv keeps
 * the private key's \n escapes literal — JSON.parse then turns them into real
 * newlines at runtime. The secret never leaves your machine.
 */
import { readFileSync, writeFileSync } from "node:fs";

const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error('Pass the path: node scripts/set-google-sa.mjs "C:\\path\\to\\key.json"');
  process.exit(1);
}

// Parse + re-stringify to guarantee valid, minified, single-line JSON.
let minified;
try {
  const parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
  if (!parsed.client_email || !parsed.private_key) {
    console.error("That file doesn't look like a service-account key (missing client_email / private_key).");
    process.exit(1);
  }
  minified = JSON.stringify(parsed);
} catch (e) {
  console.error("Could not read/parse the JSON file:", e.message);
  process.exit(1);
}

const ENV = ".env.local";
const lines = readFileSync(ENV, "utf8").split(/\r?\n/);
const out = lines.filter((l) => !/^GOOGLE_SERVICE_ACCOUNT_JSON=/.test(l));
// Single-quoted so the \n escapes stay literal for JSON.parse.
out.push(`GOOGLE_SERVICE_ACCOUNT_JSON='${minified}'`);
writeFileSync(ENV, out.join("\n"));

console.log("✓ GOOGLE_SERVICE_ACCOUNT_JSON written to .env.local for:", minified.match(/"client_email":"([^"]+)"/)?.[1] ?? "(unknown)");
