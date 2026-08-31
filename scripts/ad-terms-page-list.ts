/**
 * The pages with FIRM-VOICE advertising violations, testimonials excluded.
 *
 *   node scripts/run.mjs scripts/ad-terms-page-list.ts
 *
 * Read-only. The full sweep counts every hit; this answers the narrower and more
 * actionable question: which URLs contain copy THE FIRM WROTE that needs editing.
 *
 * Client testimonials are excluded because they are a different decision. A
 * reviewer saying "best law firm I have dealt with" is their sentence, not the
 * firm's, and whether it may be republished is a judgment call under RPC 7.1(e)
 * rather than a copy edit. Mixing the two would put one unresolved question in
 * front of ten pages that can simply be fixed.
 */
import { readFileSync } from "node:fs";
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!l || l.startsWith("#") || !l.includes("=")) continue;
  const i = l.indexOf("=");
  const k = l.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

/**
 * First-person client voice. These mark a quoted review, not firm copy.
 *
 * Deliberately narrow: it keys on the reviewer's own grammar ("I highly
 * recommend", "I was able to"), not on the presence of praise, so a marketing
 * sentence written in the firm's voice can never be dismissed as a testimonial.
 */
const TESTIMONIAL =
  /\b(?:I\s+(?:highly\s+)?recommend|would\s+(?:definitely\s+|highly\s+)?recommend|I\s+am\s+(?:extremely\s+|very\s+)?(?:happy|grateful|thankful)|I\s+was\s+able\s+to|was\s+great\s+to\s+deal\s+with|I\s+felt|I\s+reached\s+out|thank(?:ful|s)\s+i\s+was|my\s+experience\s+with)\b/i;

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { findAdTerms, blockingAdHits } = await import("@/lib/ad-terms");
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data } = await sb.from("site_pages").select("url").limit(2000);
  const urls = ((data ?? []) as Record<string, unknown>[])
    .map((r) => r.url)
    .filter((u): u is string => typeof u === "string" && u.startsWith("http"));

  const perPage = new Map<string, { match: string; why: string; sentence: string }[]>();
  const misses: string[] = [];
  let testimonialSkipped = 0;

  for (let i = 0; i < urls.length; i += 10) {
    await Promise.all(
      urls.slice(i, i + 10).map(async (u) => {
        try {
          const res = await fetch(u, { headers: { "user-agent": "KM-Compliance-Sweep" } });
          if (!res.ok) {
            misses.push(`${u} -> HTTP ${res.status}`);
            return;
          }
          const text = (await res.text())
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&#8217;/g, "'")
            .replace(/&#8216;/g, "'")
            .replace(/&hellip;/g, "...")
            .replace(/&amp;/g, "&")
            .replace(/\s+/g, " ");
          for (const h of blockingAdHits(findAdTerms(text))) {
            if (TESTIMONIAL.test(h.sentence)) {
              testimonialSkipped++;
              continue;
            }
            const list = perPage.get(u) ?? [];
            // One entry per distinct sentence: the same passage matching twice
            // is one edit, not two.
            if (!list.some((x) => x.sentence === h.sentence && x.match === h.match))
              list.push({ match: h.match, why: h.why, sentence: h.sentence });
            perPage.set(u, list);
          }
        } catch (e) {
          misses.push(`${u} -> ${(e as Error).message}`);
        }
      }),
    );
  }

  const pages = [...perPage.entries()].sort((a, b) => b[1].length - a[1].length);
  console.log(
    `${urls.length} live pages fetched, ${misses.length} unreadable.\n` +
      `${testimonialSkipped} client-testimonial hits excluded.\n` +
      `${pages.length} pages carry firm-written copy that needs editing.\n`,
  );

  console.log("=".repeat(78));
  for (const [url, hits] of pages) {
    console.log(`\n${url}   (${hits.length})`);
    for (const h of hits) {
      console.log(`   "${h.match}"  ${h.why.split(" — ")[0]}`);
      console.log(`     ${h.sentence.slice(0, 165)}`);
    }
  }

  console.log("\n\n=== JUST THE URLS ===");
  for (const [url] of pages) console.log(url);

  if (misses.length) {
    console.log(`\n=== ${misses.length} UNREADABLE (not scanned, not cleared) ===`);
    for (const m of misses.slice(0, 30)) console.log("  " + m);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
