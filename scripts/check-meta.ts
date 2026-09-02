/**
 * Probe the Meta Graph API, one call at a time.
 *
 *   node scripts/run.mjs scripts/check-meta.ts
 *   node scripts/run.mjs scripts/check-meta.ts --write   # save into the report
 *
 * The mirror of scripts/check-linkedin.ts. The route to Instagram demographics
 * is three hops and each fails differently — the token lists Pages, a Page
 * names its linked Instagram Business account, that account serves
 * demographics — so each is reported separately. "No data" at the end is
 * usually a missing link two hops earlier, and one collapsed error would send
 * someone looking in the wrong place.
 *
 * --write calls the SAME function the monthly cron calls.
 */
import { readFileSync } from "node:fs";
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!l || l.startsWith("#") || !l.includes("=")) continue;
  const i = l.indexOf("=");
  const k = l.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

import { debugToken, metaConfigured } from "@/lib/meta-api";
import { buildInstagramAudience, refreshInstagramAudience } from "@/lib/meta-audience-refresh";

const WRITE = process.argv.includes("--write");

async function main() {
  if (!metaConfigured()) {
    console.log("META_ACCESS_TOKEN is not set.\n");
    console.log("Add it to .env.local and to Vercel. Do not paste it into a chat or a");
    console.log("commit — a token that has been through either has to be revoked.");
    process.exit(1);
  }

  console.log("Probing Meta, one call at a time.\n");

  const dbg = await debugToken();
  if (dbg.ok) {
    const never = dbg.value.expiresAt === 0;
    console.log("  ok      token introspection");
    console.log(`          type:    ${dbg.value.type}`);
    console.log(
      `          expires: ${never ? "never" : new Date(dbg.value.expiresAt * 1000).toISOString().slice(0, 10)}`,
    );
    console.log(`          scopes:  ${dbg.value.scopes.join(", ")}`);
    // A System User token is the whole reason there is no renewal cycle here.
    // If this ever reads otherwise, the renewal problem is back and unnoticed.
    if (dbg.value.type !== "SYSTEM_USER") {
      console.log(`          WARNING: expected SYSTEM_USER; a ${dbg.value.type} token will expire.`);
    }
    for (const need of ["instagram_basic", "instagram_manage_insights"]) {
      if (!dbg.value.scopes.includes(need)) console.log(`          WARNING: missing scope ${need}`);
    }
  } else {
    console.log(`  FAILED  token introspection (${dbg.status ?? "no response"}): ${dbg.message}`);
    if (dbg.fix) console.log(`          fix: ${dbg.fix}`);
  }

  const built = await buildInstagramAudience();
  if (!built.ok) {
    console.log(`\n  FAILED  ${built.step}`);
    console.log(`          ${built.reason}`);
    process.exit(1);
  }
  if (built.skipped) {
    console.log(`\n  skipped: ${built.reason}`);
    return;
  }

  const { account, mapped } = built;
  console.log(`\n  ok      ${account.pageName} -> @${account.username}`);
  console.log(`          ${account.followers} followers, ${account.posts} posts\n`);

  for (const key of ["ageGroups", "gender", "topCities", "topCountries"] as const) {
    const rows = mapped.audience[key];
    const cov = mapped.coverage[key];
    console.log(
      `  ${key}  (describes ${cov.described} followers` +
        `${cov.ofFollowers !== null ? `, ${cov.ofFollowers}% of the base` : ""})`,
    );
    if (!rows.length) {
      console.log("    (empty — Meta returned no rows for this breakdown)");
      continue;
    }
    for (const r of rows) console.log(`    ${String(r.pct).padStart(5)}%  ${r.label}`);
    console.log("");
  }

  if (!WRITE) {
    console.log("Read-only. Re-run with --write to save this into the monthly report.");
    return;
  }

  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const written = await refreshInstagramAudience(sb, "00000000-0000-0000-0000-000000000001");
  if (!written.ok) {
    console.log(`\nWrite failed at ${written.step}: ${written.reason}`);
    process.exit(1);
  }
  console.log("\nWritten. The Instagram section of the monthly report is now filled from the API.");
  console.log("LinkedIn's figures were left untouched.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
