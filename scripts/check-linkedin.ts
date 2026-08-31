/**
 * Probe the LinkedIn Community Management API, one call at a time.
 *
 *   node scripts/run.mjs scripts/check-linkedin.ts
 *   node scripts/run.mjs scripts/check-linkedin.ts --write   # save into the report
 *
 * The client in lib/linkedin-api.ts was written without a token, so its
 * endpoint shapes come from LinkedIn's documented contract rather than from a
 * response anyone has seen. This exists so the FIRST real response is looked at
 * before anything depends on it — the alternative is an integration that
 * returns empty charts and gets believed.
 *
 * Every step reports separately, because they fail for different reasons: a 401
 * is an expired token, a 403 is a product that was never approved, and an empty
 * result with a 200 is the organization URN pointing somewhere real but wrong.
 */
import { readFileSync } from "node:fs";
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!l || l.startsWith("#") || !l.includes("=")) continue;
  const i = l.indexOf("=");
  const k = l.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

import {
  linkedInConfigured,
  resolveOrganizationUrn,
  fetchFollowerStatistics,
  fetchFollowerCount,
  fetchLabelMap,
  type LinkedInResult,
} from "@/lib/linkedin-api";
import { mapFollowerStatistics } from "@/lib/linkedin-audience";

const WRITE = process.argv.includes("--write");

function report<T>(label: string, r: LinkedInResult<T>): T | null {
  if (r.ok) {
    console.log(`  ok      ${label}`);
    return r.value;
  }
  console.log(`  FAILED  ${label}`);
  console.log(`          step:   ${r.step}`);
  console.log(`          status: ${r.status ?? "(no response)"}`);
  console.log(`          says:   ${r.message}`);
  if (r.fix) console.log(`          fix:    ${r.fix}`);
  return null;
}

async function main() {
  if (!linkedInConfigured()) {
    console.log("LINKEDIN_ACCESS_TOKEN is not set.\n");
    console.log("Add it to .env.local and to Vercel. Do not paste it into a chat or a");
    console.log("commit — a token that has been through either has to be regenerated.\n");
    console.log("Optional: LINKEDIN_ORGANIZATION_ID (discovered automatically if the token");
    console.log("administers exactly one page) and LINKEDIN_API_VERSION (YYYYMM).");
    process.exit(1);
  }

  console.log("Probing LinkedIn, one call at a time.\n");

  const org = report("resolve the organization", await resolveOrganizationUrn());
  if (!org) return void process.exit(1);
  console.log(`          org:    ${org}\n`);

  const followers = report("follower count", await fetchFollowerCount(org));
  const stats = report("follower statistics", await fetchFollowerStatistics(org));
  if (!stats) return void process.exit(1);

  console.log("\n  Buckets LinkedIn actually returned:");
  for (const [k, v] of Object.entries(stats)) {
    console.log(`    ${k.padEnd(36)} ${Array.isArray(v) ? v.length + " rows" : typeof v}`);
  }

  console.log("\n  Resolving URN labels:");
  const functions = report("functions", await fetchLabelMap("functions"));
  const seniorities = report("seniorities", await fetchLabelMap("seniorities"));
  const industries = report("industries", await fetchLabelMap("industries"));

  const mapped = mapFollowerStatistics(stats, followers, {
    functions: functions ?? undefined,
    seniorities: seniorities ?? undefined,
    industries: industries ?? undefined,
  });

  console.log(`\n  Mapped for the report (followers: ${mapped.audience.totalFollowers ?? "unknown"}):\n`);
  for (const key of ["jobFunction", "seniority", "industry", "companySize", "location"] as const) {
    const rows = mapped.audience[key];
    const cov = mapped.coverage[key];
    console.log(`  ${key}  (describes ${cov.described} followers${cov.ofFollowers !== null ? `, ${cov.ofFollowers}% of the base` : ""})`);
    if (!rows.length) { console.log("    (empty — LinkedIn returned no rows for this breakdown)"); continue; }
    for (const r of rows) console.log(`    ${String(r.pct).padStart(5)}%  ${r.label}`);
    console.log("");
  }

  // A label map that failed leaves raw URNs in the rows. Loud, because a report
  // row reading "urn:li:function:1" is obviously broken while a blank is not.
  const raw = Object.values(mapped.audience)
    .flatMap((v) => (Array.isArray(v) ? v : []))
    .filter((r) => typeof r.label === "string" && r.label.startsWith("urn:"));
  if (raw.length) {
    console.log(`  WARNING: ${raw.length} row(s) still show a raw URN — a label lookup failed above.`);
  }

  if (!WRITE) {
    console.log("\nRead-only. Re-run with --write to save this into the monthly report.");
    return;
  }

  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const tenantId = "00000000-0000-0000-0000-000000000001";
  const { data } = await sb
    .from("social_insights").select("id, report_audience")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(1);
  const row = (data ?? [])[0] as { id?: string; report_audience?: Record<string, unknown> } | undefined;
  if (!row?.id) {
    console.log("\nNo social_insights row to write into — open the monthly report once first.");
    return;
  }
  // Instagram's hand-entered numbers are left exactly as they are. Only the
  // LinkedIn half has a source to replace it.
  const next = { ...(row.report_audience ?? {}), linkedin: mapped.audience };
  const { error } = await sb
    .from("social_insights").update({ report_audience: next })
    .eq("id", row.id).eq("tenant_id", tenantId);
  if (error) { console.log("\nWrite failed: " + error.message); process.exit(1); }
  console.log("\nWritten. The LinkedIn section of the monthly report is now filled from the API.");
  console.log("Instagram's hand-entered figures were left untouched.");
}

main().catch((e) => { console.error(e); process.exit(1); });
