/**
 * Archive the duplicates Diana chose in Appendix F of her Sept 28 spec, before
 * the backfill runs (so archived drafts are not rewritten).
 *
 *   node scripts/run.mjs scripts/archive-duplicates-sept28.ts            # dry run: prints the plan
 *   node scripts/run.mjs scripts/archive-duplicates-sept28.ts --apply    # archives
 *
 * Archiving never deletes (lib/draft-archive.ts). Every row is Diana's call
 * ("Diana can change any row"); edit PLAN below rather than the database.
 *
 * Held back on purpose, even with --apply:
 *   - 5d68332e and f98564aa: Diana says copy their corrected sections into the
 *     keeper FIRST. That is a writing job; archiving them before it is done
 *     would bury the only corrected copy. Pass --include-merge-pending once
 *     the sections are copied.
 *   - 4361f757 ("json"): archive only "if its body is another FMLA lawyer
 *     article" — the script prints its opening lines for a person to decide.
 *   - 365f548e: keep, but its keyword changes to "fired for complaining at
 *     work" — printed as a to-do, not done here.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { archiveDrafts } from "../lib/draft-archive";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const TENANT = process.env.DEFAULT_TENANT_ID || "00000000-0000-0000-0000-000000000001";
const apply = process.argv.includes("--apply");
const includeMerge = process.argv.includes("--include-merge-pending");

type Row = { group: string; keep: string | null; archive: string[]; reason: "Duplicate" | "Off practice"; mergeFirst?: string[] };

// Appendix F2, row by row.
const PLAN: Row[] = [
  { group: "Wage theft attorney NYC", keep: "56e75650", archive: ["b3970b68"], reason: "Duplicate" },
  { group: "Best employment lawyer NYC for unpaid overtime", keep: "aa8fad36", archive: ["1a7264df"], reason: "Duplicate" },
  { group: "New York overtime for salaried employees", keep: "df5337ad", archive: ["dbf2006d", "8f5c2e29"], reason: "Duplicate" },
  { group: "Unpaid wages lawyer NYC", keep: "13338125", archive: ["85b6511f", "799af607"], reason: "Duplicate" },
  { group: "New York overtime lawyer", keep: "90e667a2", archive: ["ef5a83fa"], reason: "Duplicate" },
  { group: "Employment lawyer NYC (general)", keep: "fefa8de5", archive: ["5eeff7e8", "728e11c7", "93991c84", "9ef14bc7", "338e8cb9"], reason: "Duplicate" },
  { group: "Wrongful termination lawyer", keep: "246c200b", archive: ["da985255", "e4c06ceb"], reason: "Duplicate" },
  { group: "Wrongful dismissal New York", keep: "95d80d4e", archive: ["a2423c61"], reason: "Duplicate" },
  { group: "Workplace discrimination lawyer New York", keep: "8743c7a6", archive: ["5d68332e", "80138f8a", "cb19fd78"], reason: "Duplicate", mergeFirst: ["5d68332e"] },
  { group: "Workplace harassment lawyer", keep: "5b710c12", archive: ["1739ffe3"], reason: "Duplicate" },
  { group: "Sexual harassment lawyer NYC", keep: "3483b66f", archive: ["df0fb98b", "a5f96370"], reason: "Duplicate" },
  { group: "FMLA lawyer New York", keep: "74108f45", archive: ["f98564aa"], reason: "Duplicate", mergeFirst: ["f98564aa"] },
  { group: "FMLA retaliation attorney", keep: "fbff0b0e", archive: ["a0a26dc6", "8ee37a9a"], reason: "Duplicate" },
  { group: "What is a severance package", keep: "547f277c", archive: ["33f7b842", "a7bef1fe"], reason: "Duplicate" },
  { group: "Collection agency law firm", keep: "48d5e3f7", archive: ["7be02d57"], reason: "Duplicate" },
  { group: "Non compete New York", keep: "e70f280e", archive: ["e99c94b3"], reason: "Duplicate" },
  { group: "Off practice (fee topics)", keep: null, archive: ["f54dd966", "bf522634"], reason: "Off practice" },
];

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  // Resolve 8-character prefixes to full ids (paged past the 1,000-row cap).
  const all: { id: string; title: string | null; status: string; body: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("content_drafts")
      .select("id, title, status, body")
      .eq("tenant_id", TENANT)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const byPrefix = (p: string) => all.filter((d) => d.id.startsWith(p));
  const resolve = (p: string) => {
    const hits = byPrefix(p);
    if (hits.length !== 1) throw new Error(`prefix ${p} matches ${hits.length} drafts`);
    return hits[0];
  };

  let total = 0;
  for (const row of PLAN) {
    const keeper = row.keep ? resolve(row.keep) : null;
    const targets = row.archive
      .filter((p) => includeMerge || !row.mergeFirst?.includes(p))
      .map(resolve)
      .filter((d) => d.status !== "archived");
    const held = includeMerge ? [] : (row.mergeFirst ?? []);
    console.log(`\n## ${row.group}`);
    if (keeper) console.log(`  keep     ${keeper.id.slice(0, 8)}  ${keeper.title ?? "(no title)"}  [${keeper.status}]`);
    for (const t of targets) console.log(`  archive  ${t.id.slice(0, 8)}  ${t.title ?? "(no title)"}  [${t.status}]  reason: ${row.reason}`);
    for (const h of held) console.log(`  HELD     ${h}  copy its corrected sections into the keeper first (--include-merge-pending)`);
    if (apply && targets.length) {
      const r = await archiveDrafts({
        supabase: sb,
        tenantId: TENANT,
        ids: targets.map((t) => t.id),
        keeperId: keeper?.id ?? null,
        reason: row.reason,
        archivedBy: "appendix-f-2026-09-28",
      });
      console.log(`  -> archived ${r.archived.length}${r.errors.length ? `, errors: ${r.errors.join("; ")}` : ""}`);
      total += r.archived.length;
    } else total += targets.length;
  }

  const json = all.find((d) => d.id.startsWith("4361f757"));
  console.log("\n## Decide by hand");
  if (json) console.log(`  4361f757 "json": archive as a duplicate of 74108f45 only if this is another FMLA lawyer article:\n    ${(json.body ?? "").replace(/\s+/g, " ").slice(0, 300)}`);
  console.log("  365f548e: keep; change its keyword to \"fired for complaining at work\".");
  console.log(`\n${apply ? "Archived" : "Would archive"} ${total} draft(s).${apply ? "" : " Dry run: nothing written. Re-run with --apply."}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
