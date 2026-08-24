/**
 * Runner for maintenance scripts that reach into `lib/`.
 *
 *   node scripts/run.mjs scripts/<name>.ts [args…]
 *
 * Most scripts in here talk to Supabase directly and import nothing from the
 * app, so plain `node scripts/x.ts` is enough for them. This runner exists for
 * the ones that call into app code — anything importing lib/content-analysis,
 * for instance, transitively pulls in `@/lib/...` path aliases that neither
 * Node's TypeScript stripping nor bare `jiti` resolves. Without the alias the
 * script dies on load with MODULE_NOT_FOUND for `@/lib/supabase-route`, and
 * because the offending import is usually lazy, it dies at the moment the
 * script starts doing real work rather than at startup.
 *
 * Argv is passed through untouched, so flags like --apply / --limit behave the
 * same as calling the script directly.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { createJiti } from "jiti";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const target = process.argv[2];
if (!target) {
  console.error("Usage: node scripts/run.mjs scripts/<name>.ts [args…]");
  process.exit(1);
}

// The script reads its own flags off process.argv, so drop the runner's own
// argv[1] (this file) and argv[2] (the target) and leave the rest in place.
process.argv = [process.argv[0], resolve(root, target), ...process.argv.slice(3)];

const jiti = createJiti(import.meta.url, {
  alias: { "@": root },
  interopDefault: true,
});

await jiti.import(resolve(root, target));
