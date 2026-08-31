/**
 * Library-wide sweep for attorney-advertising violations (RPC 7.4 / 7.1).
 *
 *   node scripts/run.mjs scripts/sweep-ad-terms.ts
 *
 * Read-only. Reports; changes nothing. The point is to find out how much
 * PUBLISHED copy calls the firm an expert, which no check has ever covered —
 * lib/compliance-core.ts stated the rule only inside a model prompt, and only
 * ever ran against draft bodies.
 *
 * Blocking = the sentence is about Katz Melinger. Review = no clear subject.
 * General (about other lawyers or the market) is legitimate and is counted but
 * not listed, since flagging it is what would make this check ignorable.
 */
import { readFileSync } from "node:fs";
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!l || l.startsWith("#") || !l.includes("=")) continue;
  const i = l.indexOf("="); const k = l.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const LIVE = process.argv.includes("--live");

type Row = Record<string, unknown>;

async function main() {
  // Every URL that could not be read, printed at the end. A sweep that silently
  // skips pages reports "all clear" for copy it never saw.
  const misses: string[] = [];
  const { createClient } = await import("@supabase/supabase-js");
  const { findAdTerms, blockingAdHits, reviewableAdHits, marketingCopyViolations } =
    await import("@/lib/ad-terms");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  type Item = { surface: string; label: string; text: string; short: boolean; extra?: string };
  const items: Item[] = [];

  const d = await sb.from("content_drafts").select("id,title,topic,body,status,metadata").neq("status", "archived");
  for (const r of (d.data ?? []) as Row[]) {
    items.push({ surface: "draft body", label: (r.title ?? r.topic ?? String(r.id)), text: String(r.body ?? ""), short: false, extra: r.status });
    const km = (((r.metadata ?? {}) as Row).km_brief ?? {}) as Row;
    const metaText = [km.metaTitle, km.metaDescription].filter(Boolean).join(". ");
    if (metaText) items.push({ surface: "draft metadata", label: (r.title ?? r.topic ?? String(r.id)), text: metaText, short: true, extra: r.status });
  }

  // site_pages is a CRAWL INDEX, not a content store: url, title, h1, scores.
  // The page BODY is not in the database at all, so a database-only sweep can
  // never answer "what does the live site say". Titles and H1s are checked here;
  // --live fetches the pages themselves.
  const p = await sb.from("site_pages").select("id,url,title,h1").limit(2000);
  const pages = (p.data ?? []) as Row[];
  for (const r of pages) {
    const meta = [r.title, r.h1].filter(Boolean).join(". ");
    if (meta) items.push({ surface: "LIVE title/H1", label: r.url ?? String(r.id), text: meta, short: true });
  }

  if (LIVE) {
    const urls = pages.map((r) => r.url).filter((u: string) => typeof u === "string" && u.startsWith("http"));
    console.log(`Fetching ${urls.length} live pages...`);
    let done = 0;
    for (let i = 0; i < urls.length; i += 8) {
      await Promise.all(
        urls.slice(i, i + 8).map(async (u: string) => {
          try {
            const res = await fetch(u, { headers: { "user-agent": "KatzMelinger-Compliance-Sweep" } });
            if (!res.ok) { misses.push(`${u} -> HTTP ${res.status}`); return; }
            const html = await res.text();
            // Strip scripts/styles/tags. Crude, but this is a word-level check.
            const text = html
              .replace(/<script[\s\S]*?<\/script>/gi, " ")
              .replace(/<style[\s\S]*?<\/style>/gi, " ")
              .replace(/<[^>]+>/g, " ")
              .replace(/&nbsp;/g, " ")
              .replace(/&amp;/g, "&")
              .replace(/\s+/g, " ")
            items.push({ surface: "LIVE page body", label: u, text, short: false });
          } catch (e) {
            misses.push(`${u} -> ${(e as Error).message}`);
          }
        }),
      );
      done += Math.min(8, urls.length - i);
      if (done % 80 === 0 || done === urls.length) console.log(`  ${done}/${urls.length}`);
    }
  }
  const s = await sb.from("social_posts").select("id,platform,content").limit(500);
  for (const r of (s.data ?? []) as Row[]) {
    const text = String(r.content ?? "");
    if (text) items.push({ surface: "social post", label: `${r.platform ?? "?"} ${String(r.id)}`, text, short: true });
  }

  const rr = await sb.from("review_requests").select("id,subject,message").limit(500);
  for (const r of (rr.data ?? []) as Row[]) {
    const text = [r.subject, r.message].filter(Boolean).join(". ");
    if (text) items.push({ surface: "review request", label: String(r.id), text, short: true });
  }

  const bySurface = new Map<string, { scanned: number; blocking: number; review: number; general: number; items: number }>();
  const findings: { surface: string; label: string; extra?: string; kind: string; match: string; why: string; sentence: string }[] = [];

  for (const it of items) {
    const st = bySurface.get(it.surface) ?? { scanned: 0, blocking: 0, review: 0, general: 0, items: 0 };
    st.scanned++;
    const all = findAdTerms(it.text);
    const blocking = it.short ? marketingCopyViolations(it.text) : blockingAdHits(all);
    const review = it.short ? [] : reviewableAdHits(all);
    st.general += all.filter((h) => h.subject === "general").length;
    st.blocking += blocking.length; st.review += review.length;
    if (blocking.length || review.length) st.items++;
    bySurface.set(it.surface, st);
    for (const h of blocking) findings.push({ surface: it.surface, label: it.label, extra: it.extra, kind: "BLOCKING", match: h.match, why: h.why, sentence: h.sentence });
    for (const h of review) findings.push({ surface: it.surface, label: it.label, extra: it.extra, kind: "review", match: h.match, why: h.why, sentence: h.sentence });
  }

  console.log("SURFACE                 scanned   blocking   review   (legit)   items");
  console.log("-".repeat(74));
  for (const [k, v] of bySurface)
    console.log(`${k.padEnd(22)} ${String(v.scanned).padStart(7)} ${String(v.blocking).padStart(10)} ${String(v.review).padStart(8)} ${String(v.general).padStart(9)} ${String(v.items).padStart(7)}`);

  const blocking = findings.filter((f) => f.kind === "BLOCKING");
  console.log(`\n\n=== ${blocking.length} BLOCKING — the copy claims this ABOUT KATZ MELINGER ===`);
  for (const f of blocking) {
    console.log(`\n[${f.surface}${f.extra ? " / " + f.extra : ""}] ${String(f.label).slice(0, 72)}`);
    console.log(`  "${f.match}"  ${f.why}`);
    console.log(`  ...${f.sentence.slice(0, 170)}`);
  }

  const rev = findings.filter((f) => f.kind === "review");
  console.log(`\n\n=== ${rev.length} FOR REVIEW — no clear subject, a human should judge ===`);
  for (const f of rev.slice(0, 25)) {
    console.log(`\n[${f.surface}] ${String(f.label).slice(0, 72)}`);
    console.log(`  "${f.match}" — ...${f.sentence.slice(0, 150)}`);
  }
  if (rev.length > 25) console.log(`\n  ... and ${rev.length - 25} more`);
}
main().catch((e) => { console.error(e); process.exit(1); });
