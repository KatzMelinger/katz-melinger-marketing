/**
 * Give page drafts the H1 they are missing.
 *
 *   node scripts/run.mjs scripts/fix-missing-h1.ts            # dry run
 *   node scripts/run.mjs scripts/fix-missing-h1.ts --apply
 *
 * WHY THIS IS 26 DRAFTS AND NOT 88
 *
 * A sweep on 2026-08-31 reported 96 drafts with neither a keyword nor an H1,
 * which read as half the library being structurally broken. It was not: 93 of
 * them were Instagram captions, carousels, emails and video scripts. A caption
 * has no "# heading" by design and no target keyword because it has no search
 * result to rank in. The check was a page-SEO test applied to everything, and
 * lib/draft-metadata.ts now scopes it with hasWebPage().
 *
 * What survives that correction is real: 26 blog drafts, 6,000 to 17,000
 * characters each, genuinely missing the heading a page needs.
 *
 * TWO SHAPES, TWO FIXES, AND ONE THAT IS NOT MINE TO MAKE
 *
 *   promote   14 already open with the title as an H2. Demoting every other
 *             heading is not needed — the document just starts one level too
 *             deep — so the leading "##" becomes "#" and nothing else moves.
 *
 *   prepend   12 open with a paragraph and no heading at all. The draft's title
 *             becomes the H1.
 *
 *   leave     Where the "title" is a keyword stub — "json", "workplace
 *             discrimination attorney" — prepending it would put a search term
 *             where a headline goes, on a page whose entire purpose is to be
 *             read. That is a writing decision, so it is reported and skipped.
 *
 * Nothing is guessed and nothing is invented: every H1 written here is text
 * that was already on the draft, either as its title or as its own first
 * heading.
 */
import { readFileSync } from "node:fs";
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!l || l.startsWith("#") || !l.includes("=")) continue;
  const i = l.indexOf("=");
  const k = l.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const APPLY = process.argv.includes("--apply");
type Row = Record<string, unknown>;

/**
 * Does this read as a headline, or as a search term someone typed into a field?
 *
 * All-lowercase is the clearest signal — "fmla retaliation attorney" is a
 * keyword, "FMLA Retaliation Attorney for Remote Workers" is a title. A single
 * word ("json") is never a headline. And a title identical to the draft's own
 * primary keyword is by definition the keyword, whatever its casing.
 */
function looksLikeHeadline(title: string, keyword: string): boolean {
  const t = title.trim();
  if (t.length < 12) return false;
  if (t === t.toLowerCase()) return false;
  if (keyword && t.toLowerCase() === keyword.trim().toLowerCase()) return false;
  if (t.split(/\s+/).length < 3) return false;
  return true;
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { bodyH1, hasWebPage, primaryKeyword } = await import("@/lib/draft-metadata");
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await sb
    .from("content_drafts")
    .select("id, tenant_id, title, topic, body, format, status")
    .neq("status", "archived");
  if (error) throw error;

  const targets = ((data ?? []) as Row[]).filter(
    (d) => hasWebPage(d.format as string) && !bodyH1(String(d.body ?? "")),
  );

  const promote: { row: Row; from: string; to: string; body: string }[] = [];
  const prepend: { row: Row; h1: string; body: string }[] = [];
  const leave: { row: Row; why: string }[] = [];

  for (const row of targets) {
    const body = String(row.body ?? "");
    const title = String(row.title || row.topic || "").trim();
    const keyword = primaryKeyword(row as never);
    const lines = body.split(/\r?\n/);
    const firstIdx = lines.findIndex((l) => l.trim());
    const first = firstIdx >= 0 ? lines[firstIdx] : "";

    // The document opens on an H2. Promote just that one line.
    const h2 = first.match(/^##\s+(.+)$/);
    if (h2) {
      const next = [...lines];
      next[firstIdx] = `# ${h2[1].trim()}`;
      promote.push({ row, from: h2[1].trim(), to: h2[1].trim(), body: next.join("\n") });
      continue;
    }

    if (!looksLikeHeadline(title, keyword)) {
      leave.push({
        row,
        why: title ? `title "${title}" reads as a keyword, not a headline` : "no title to use",
      });
      continue;
    }

    prepend.push({ row, h1: title, body: `# ${title}\n\n${body.trimStart()}` });
  }

  console.log(`${targets.length} page drafts have no H1.\n`);
  console.log(`  ${String(promote.length).padStart(3)}  open with an H2 — promote it`);
  console.log(`  ${String(prepend.length).padStart(3)}  open with a paragraph — prepend the title`);
  console.log(`  ${String(leave.length).padStart(3)}  need a person to write a headline\n`);

  if (leave.length) {
    console.log("Left for a person:");
    for (const l of leave) {
      console.log(`  [${l.row.status}] ${String(l.row.title || l.row.topic).slice(0, 58)}`);
      console.log(`      ${l.why}`);
    }
    console.log("");
  }

  if (!APPLY) {
    console.log("Promote (first line becomes an H1):");
    for (const p of promote.slice(0, 6)) console.log(`  ## -> #  ${p.to.slice(0, 70)}`);
    if (promote.length > 6) console.log(`  ... and ${promote.length - 6} more`);
    console.log("\nPrepend (title becomes the H1):");
    for (const p of prepend.slice(0, 6)) console.log(`  # ${p.h1.slice(0, 70)}`);
    if (prepend.length > 6) console.log(`  ... and ${prepend.length - 6} more`);
    console.log(`\nDry run. Re-run with --apply to write ${promote.length + prepend.length} drafts.`);
    return;
  }

  let done = 0;
  let failed = 0;
  for (const item of [...promote, ...prepend]) {
    const { error: err } = await sb
      .from("content_drafts")
      .update({ body: item.body, updated_at: new Date().toISOString() })
      .eq("id", String(item.row.id))
      .eq("tenant_id", String(item.row.tenant_id));
    if (err) {
      failed++;
      console.log(`  FAIL  ${String(item.row.title).slice(0, 50)} — ${err.message}`);
      continue;
    }
    done++;
  }

  console.log(`\n${done} drafts given an H1, ${failed} failed, ${leave.length} left for a person.`);
  console.log(
    "\nThese now have the prerequisite the metadata generator needs. Run\n" +
      "  node scripts/run.mjs scripts/backfill-draft-metadata.ts\n" +
      "to fill the meta titles and descriptions that were blocked on it.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
