/**
 * Pillar integrity: every pillar must resolve directly on the live site and be
 * present in the Cluster Map, and a generated draft must reach the confirmed
 * internal-link minimum (Diana item 4, 21 September).
 *
 *   node scripts/run.mjs scripts/check-pillar-links.ts
 *
 * Network + DB. This is the check that would have caught the state found on
 * 2026-09-24: three pillar URLs returning 404, two more redirecting to an
 * unrelated case result, and none of them in site_pages — so the pillar link
 * could never be confirmed and every draft fell short of the minimum.
 */
import { readFileSync } from "node:fs";
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!l || l.startsWith("#") || !l.includes("=")) continue;
  const i = l.indexOf("=");
  const k = l.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
import { getSupabaseAdmin } from "../lib/supabase-server";
import { EMPLOYMENT_PILLARS, COLLECTIONS_PILLARS } from "../lib/km-content-system";
import { buildLinkPlan } from "../lib/internal-links";
import { inferPillar } from "../lib/strategy-engine";
import { MIN_CONFIRMED_INTERNAL_LINKS } from "../lib/internal-links-check";
import { getPillars } from "../lib/pillars-store";

const BASE = "https://katzmelinger.com";
const norm = (u: string) => {
  try { return new URL(u, BASE).pathname.replace(/\/+$/, "") || "/"; } catch { return u; }
};

let failed = 0;
const report = (ok: boolean, line: string) => { if (!ok) failed++; console.log(`${ok ? "pass" : "FAIL"}  ${line}`); };

async function main() {
  const db = getSupabaseAdmin();
  const { data } = await db.from("site_pages").select("url").limit(5000);
  const known = new Set((data ?? []).map((r) => norm(String(r.url))));

  // tenant_settings.pillars OVERRIDES the code constants at runtime, so a
  // green code-side check means nothing until the stored list matches.
  const live = await getPillars();
  const codeUrls = new Map([...EMPLOYMENT_PILLARS, ...COLLECTIONS_PILLARS].map((p) => [p.id, p.url]));
  const stale = live.filter((p) => codeUrls.get(p.id) && codeUrls.get(p.id) !== p.url);
  // Any pillar the code knows about and the stored list does not. A MISSING
  // pillar is worse than a stale URL: buildLinkPlan looks the pillar up by id
  // in the stored list, so a draft assigned to one that isn't there gets no
  // Pillar/CTA link at all rather than a wrong one.
  const missing = [...codeUrls.keys()].filter((id) => !live.some((p) => p.id === id));
  if (stale.length || missing.length) {
    console.log("!! tenant_settings.pillars is STALE — run the pending supabase/tenant_pillars_*.sql");
    for (const p of stale) console.log(`   ${p.id.padEnd(22)} stored ${p.url}  should be ${codeUrls.get(p.id)}`);
    for (const id of missing) console.log(`   ${id.padEnd(22)} MISSING from the stored list — drafts assigned to it get no CTA link`);
    console.log("   (the link-count section below cannot pass until it is applied)");
    console.log("");
  }

  console.log("-- every pillar resolves directly and is in the Cluster Map ------");
  for (const p of [...EMPLOYMENT_PILLARS, ...COLLECTIONS_PILLARS]) {
    let status = 0, landed = p.url;
    try {
      const res = await fetch(`${BASE}${p.url}`, { redirect: "follow" });
      status = res.status;
      landed = res.url.replace(BASE, "");
    } catch { /* reported below */ }
    const direct = norm(landed) === norm(p.url);
    const inMap = known.has(norm(p.url));
    report(status === 200 && direct && inMap,
      `${p.id.padEnd(22)} ${String(status).padEnd(4)}${direct ? "direct" : `REDIRECTS -> ${landed}`} ${inMap ? "in map" : "NOT IN MAP"}`);
  }

  console.log(`\n-- a generated draft reaches ${MIN_CONFIRMED_INTERNAL_LINKS} confirmed links ----------------`);
  const CASES: Array<[string, string[]]> = [
    ["is gender a protected class", ["gender discrimination", "protected class"]],
    ["are non competes legal", ["non-compete", "restrictive covenant"]],
    ["restrictive covenants after termination", ["restrictive covenant"]],
    ["ny overtime laws for salaried employees", ["overtime pay", "salaried employees"]],
    ["quid pro quo harassment", ["sexual harassment", "quid pro quo"]],
    ["how do i prove an fmla retaliation claim", ["fmla retaliation", "medical leave"]],
  ];
  for (const [topic, kws] of CASES) {
    const pillarId = inferPillar({ clusterName: topic, primaryKeyword: topic, secondaryKeywords: kws }, "employment");
    // Exactly the options the generation paths use.
    const plan = await buildLinkPlan({
      primaryKeyword: topic,
      secondaryKeywords: kws,
      pillarId: pillarId || undefined,
      perTermLimit: 2,
      practiceArea: "employment",
      minLinks: MIN_CONFIRMED_INTERNAL_LINKS,
    });
    const confirmed = plan.links.filter((l) => known.has(norm(l.url))).length;
    const hasCta = plan.links.some((l) => l.section === "Pillar / CTA");
    report(confirmed >= MIN_CONFIRMED_INTERNAL_LINKS && hasCta,
      `${String(confirmed).padStart(2)} confirmed, CTA ${hasCta ? "yes" : "NO "}  ${topic}`);
  }
  console.log(failed === 0 ? "\nall pass" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
