/**
 * Does the live site carry its required disclaimers?
 *
 *   node scripts/run.mjs scripts/check-disclaimers.ts            # every page
 *   node scripts/run.mjs scripts/check-disclaimers.ts --results  # case results only
 *
 * Read-only. Run it before the WordPress change to see the baseline, and after
 * to confirm the change actually landed on every page rather than on the
 * template someone thought was global.
 *
 * The 2026-08-31 baseline: 0 of 447 pages carried the footer disclaimer, and 0
 * of 14 case-result pages carried prior-results language. The rules had been
 * encoded in lib/compliance-core.ts the whole time; nothing checked the site
 * against them, so nothing knew.
 */
import { readFileSync } from "node:fs";
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!l || l.startsWith("#") || !l.includes("=")) continue;
  const i = l.indexOf("=");
  const k = l.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const RESULTS_ONLY = process.argv.includes("--results");
type Row = Record<string, unknown>;

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8217;/g, "'")
    .replace(/&#038;|&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { hasFooterDisclaimer, hasResultsVary, hasAwardsNotice, AWARD_METHODOLOGIES } =
    await import("@/lib/legal-disclaimers");

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data } = await sb.from("site_pages").select("url").limit(2000);
  let urls = ((data ?? []) as Row[])
    .map((r) => String(r.url ?? ""))
    .filter((u) => u.startsWith("http"));
  if (RESULTS_ONLY) urls = urls.filter((u) => u.includes("/result/"));

  const rows: { url: string; footer: boolean; vary: boolean; awards: boolean; isResult: boolean }[] = [];
  // Pages that could not be read are listed, never counted as passing. A page
  // the checker could not see is not a page the checker cleared.
  const misses: string[] = [];

  for (let i = 0; i < urls.length; i += 8) {
    await Promise.all(
      urls.slice(i, i + 8).map(async (u) => {
        try {
          const res = await fetch(u, { headers: { "user-agent": "KM-Compliance-Sweep" } });
          if (!res.ok) return void misses.push(`${u} -> HTTP ${res.status}`);
          const text = visibleText(await res.text());
          rows.push({
            url: u,
            footer: hasFooterDisclaimer(text),
            vary: hasResultsVary(text),
            awards: hasAwardsNotice(text),
            isResult: u.includes("/result/"),
          });
        } catch (e) {
          misses.push(`${u} -> ${(e as Error).message}`);
        }
      }),
    );
  }

  const results = rows.filter((r) => r.isResult);
  const noFooter = rows.filter((r) => !r.footer);
  const resultsNoVary = results.filter((r) => !r.vary);

  console.log(`${rows.length} pages read, ${misses.length} unreadable.\n`);
  console.log(`  footer disclaimer      ${rows.length - noFooter.length}/${rows.length} pages`);
  console.log(`  results-vary line      ${results.length - resultsNoVary.length}/${results.length} case-result pages`);
  console.log(`  awards notice          ${rows.filter((r) => r.awards).length} pages carry it`);

  if (noFooter.length) {
    console.log(`\n=== ${noFooter.length} PAGES MISSING THE FOOTER DISCLAIMER ===`);
    for (const r of noFooter.slice(0, 25)) console.log("  " + r.url.replace("https://katzmelinger.com", ""));
    if (noFooter.length > 25) console.log(`  ... and ${noFooter.length - 25} more`);
  }

  if (resultsNoVary.length) {
    console.log(`\n=== ${resultsNoVary.length} CASE-RESULT PAGES MISSING "Results vary..." ===`);
    for (const r of resultsNoVary) console.log("  " + r.url.replace("https://katzmelinger.com", ""));
  }

  // The methodology page the awards notice points at has to exist, or the
  // notice sends a regulator to a 404.
  const methodology = "https://katzmelinger.com/award-methodology/";
  try {
    const res = await fetch(methodology, { headers: { "user-agent": "KM-Compliance-Sweep" } });
    console.log(`\naward methodology page: HTTP ${res.status} ${res.ok ? "" : "<- the awards notice links here"}`);
  } catch {
    console.log("\naward methodology page: could not be reached");
  }

  // Several of these sites sit behind bot protection that rejects Node's fetch
  // on its TLS fingerprint regardless of headers — superlawyers.com answers curl
  // with 200 and this with 403. So 403 means UNKNOWN, not broken. Reporting a
  // working link as dead is how a checker earns the habit of being ignored,
  // which costs more than the check is worth.
  console.log("\n=== award methodology links ===");
  console.log("    (403 = the site blocks automated checks; open it in a browser)\n");
  for (const a of AWARD_METHODOLOGIES) {
    try {
      const res = await fetch(a.url, {
        redirect: "follow",
        headers: { "user-agent": "Mozilla/5.0 (compatible; KM-link-check)" },
      });
      const flag = res.ok ? "ok     " : res.status === 403 ? "blocked" : `HTTP ${res.status}`;
      console.log(`  ${flag}  ${a.name}`);
      if (!res.ok && res.status !== 403) console.log(`            BROKEN: ${a.url}`);
      if (res.ok && res.url !== a.url) console.log(`            redirects to ${res.url}`);
    } catch (e) {
      console.log(`  ERROR    ${a.name} -> ${(e as Error).message}`);
    }
  }

  if (misses.length) {
    console.log(`\n=== ${misses.length} UNREADABLE (not checked, not cleared) ===`);
    for (const m of misses.slice(0, 20)) console.log("  " + m);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
