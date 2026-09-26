/**
 * The keyword tracker reads its own data completely (Diana, September report).
 *
 *   node scripts/run.mjs scripts/check-rank-history.ts
 *
 * Read-only. This is the check that was missing when the tracker was reported
 * broken three months running while the data was perfect the whole time.
 *
 * The failure it guards against is silent: PostgREST answers at most 1,000 rows,
 * seo_rank_snapshots takes 1,164 a day, and the old route asked for 180 days
 * unpaginated and oldest-first. So it received exactly one day — the oldest —
 * and the UI showed that single June date with no keywords in it. Nothing
 * errored. Nothing logged.
 */
import { readFileSync } from "node:fs";
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!l || l.startsWith("#") || !l.includes("=")) continue;
  const i = l.indexOf("=");
  const k = l.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
import { getSupabaseAdmin } from "../lib/supabase-server";
import { loadPaged, PAGE_SIZE, type VisibilityRow } from "../lib/rank-history";

const OWN = "katzmelinger.com";
let failed = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${line}`);
};

async function main() {
  const db = getSupabaseAdmin();
  const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);

  console.log("-- the aggregate the trend line reads ---------------------------");
  let vis: VisibilityRow[] = [];
  try {
    vis = await loadPaged<VisibilityRow>(async (lo, hi) => {
      const { data, error } = await db
        .rpc("seo_rank_visibility", { p_since: since })
        .range(lo, hi);
      return { rows: (data ?? []) as VisibilityRow[], error: error?.message ?? null };
    });
  } catch (err) {
    console.log(`  seo_rank_visibility unavailable: ${err instanceof Error ? err.message : err}`);
    console.log("  -> run supabase/seo_rank_visibility_fn.sql; nothing below can pass without it.");
    // exitCode rather than process.exit: exiting here while the Supabase client
    // still holds handles trips a libuv assertion on Windows and buries the
    // message above.
    process.exitCode = 1;
    return;
  }

  const dates = [...new Set(vis.map((r) => r.captured_on))].sort();
  const domains = [...new Set(vis.map((r) => r.domain))];
  console.log(`  ${vis.length} aggregate rows, ${dates.length} dates, ${domains.length} domains`);
  console.log(`  window ${dates[0]} .. ${dates[dates.length - 1]}`);

  // The original symptom, stated as a test: more than one date must survive.
  check(dates.length > 1, `history spans ${dates.length} dates, not 1 (the "stuck on June 13" bug)`);

  // And the newest date must be recent — a frozen tracker is a real failure too.
  const newest = dates[dates.length - 1] ?? "";
  const ageDays = newest ? Math.floor((Date.now() - new Date(newest).getTime()) / 86_400_000) : 999;
  check(ageDays <= 2, `newest capture is ${newest} (${ageDays}d old)`);

  console.log("\n-- the per-keyword detail for two compared dates ----------------");
  const pair = [dates[0], dates[dates.length - 1]].filter(Boolean);
  const rows = await loadPaged<{ keyword: string; domain: string }>(async (lo, hi) => {
    const { data, error } = await db
      .from("seo_rank_snapshots")
      .select("keyword, domain")
      .in("captured_on", pair)
      .order("keyword", { ascending: true })
      .range(lo, hi);
    return { rows: (data ?? []) as Array<{ keyword: string; domain: string }>, error: error?.message ?? null };
  });
  const ownKeywords = new Set(rows.filter((r) => r.domain === OWN).map((r) => r.keyword));
  console.log(`  ${rows.length} rows across ${pair.length} dates`);
  check(rows.length > PAGE_SIZE, `paging worked: ${rows.length} rows, past the ${PAGE_SIZE}-row cap`);
  check(ownKeywords.size > 100, `${ownKeywords.size} of the firm's own keywords present (not 0)`);

  console.log("");
  console.log("-- no fake zeros in the trend -----------------------------------");
  // A funding outage used to write a null rank for every keyword, and the
  // visibility aggregate scores null as zero CTR. So a day where the firm's own
  // visibility is 0 across the whole list is that signature: real data never
  // has all 194 keywords outside the top 100 at once.
  const ownVis = vis.filter((r) => r.domain === OWN);
  const zeroDays = ownVis.filter((r) => Number(r.visibility) === 0 && r.sampled > 50);
  check(
    zeroDays.length === 0,
    zeroDays.length === 0
      ? "no day records zero visibility across the whole tracked list"
      : `${zeroDays.length} day(s) at 0 visibility over ${zeroDays[0]?.sampled} keywords - ` +
        `likely nulls written during an outage (${zeroDays.map((d) => d.captured_on).join(", ")})`,
  );
  console.log("");

  console.log("\n-- the tracked list -------------------------------------------");
  const { count } = await db.from("seo_keywords").select("*", { count: "exact", head: true });
  check((count ?? 0) > 100, `seo_keywords holds ${count} rows`);

  console.log(failed === 0 ? "\nall pass" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
