#!/usr/bin/env node
/**
 * Cross-platform launcher for `next start`.
 *
 * Why this exists:
 *   Next.js's env loader (@next/env) refuses to overwrite any variable that
 *   already exists in `process.env`, even when the existing value is an
 *   empty string. Some shell setups (Vercel CLI leftovers, half-configured
 *   profiles, Windows User-level Environment Variables) leave variables like
 *   ANTHROPIC_API_KEY=""  hanging around. The result is that `next start`
 *   silently ignores the real value in .env.local and every Anthropic call
 *   fails with "ANTHROPIC_API_KEY is not configured".
 *
 *   This script strips empty / whitespace-only values from the inherited env
 *   before delegating to `next start`, so .env.local is allowed to fill them
 *   in normally. Same goes for the dev mode equivalent (see start-dev.js).
 *
 * No new dependencies — uses Node's built-in child_process only.
 */

"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");

// Variables we'll strip from process.env if they exist but are blank. We
// only target the ones we actually rely on — leave everything else alone
// so we don't accidentally clobber a system env that matters.
const STRIP_IF_EMPTY = [
  "ANTHROPIC_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];

const stripped = [];
for (const name of STRIP_IF_EMPTY) {
  const v = process.env[name];
  if (v !== undefined && (typeof v !== "string" || v.trim() === "")) {
    delete process.env[name];
    stripped.push(name);
  }
}
if (stripped.length > 0) {
  // Visible in the start log so future debugging takes 5 seconds, not 2 hours.
  console.log(
    `[start-server] Stripped empty env vars so .env.local can load real values: ${stripped.join(", ")}`,
  );
}

// Path to the locally installed Next binary. Resolving via node_modules
// avoids relying on the user's PATH and keeps this script portable across
// Windows (next.cmd) and Unix (next).
const isWindows = process.platform === "win32";
const binName = isWindows ? "next.cmd" : "next";
const nextBin = path.join(__dirname, "..", "node_modules", ".bin", binName);

const child = spawn(nextBin, ["start", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
  // On Windows, .cmd files need shell:true to be invoked by spawn.
  shell: isWindows,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

// Forward Ctrl+C and similar so the child shuts down cleanly.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig);
  });
}
