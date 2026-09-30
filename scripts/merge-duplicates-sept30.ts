/**
 * Items 5a/5b, Option A (Kenneth, 2026-09-30): the duplicates 5d68332e and
 * f98564aa were corrected line by line on September 28; the keepers were not.
 * So each keeper section on the same topic is REPLACED by the duplicate's
 * corrected section, and the duplicate's genuinely new FAQs / sections are
 * ADDED. Every replacement and addition is one entry in the keeper's Changes
 * made (source "duplicate merge"), undoable on its own; the keeper is then
 * re-analysed so the new text goes through the legal checks.
 *
 *   node scripts/run.mjs scripts/merge-duplicates-sept30.ts            # dry run
 *   node scripts/run.mjs scripts/merge-duplicates-sept30.ts --apply
 *
 * The pairing is explicit (topic by topic, reviewed by a person), not inferred
 * from headings: a first version matched on exact heading text, missed that
 * "Who Is Protected?" and "Who Can File a Workplace Discrimination Claim in New
 * York?" are the same section, and doubled every topic. That run was reverted.
 * The duplicates are already archived; they are read here, not changed.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { appendRun, changeId, readFixLog, type FixChange } from "../lib/legal-fix-log";
import { clearTextCertifications } from "../lib/draft-certifications";
import { analyzeDraft } from "../lib/content-analysis";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const TENANT = process.env.DEFAULT_TENANT_ID || "00000000-0000-0000-0000-000000000001";
const apply = process.argv.includes("--apply");

type Plan = {
  dup: string;
  keep: string;
  /** [duplicate heading, keeper heading]: keeper section replaced by the duplicate's. */
  replace: [string, string][];
  /** Duplicate FAQ questions (H3) to add at the end of the keeper's FAQ. */
  addFaq: string[];
  /** Duplicate H2 sections to add before the keeper's FAQ. */
  addSections: string[];
};

const PLANS: Plan[] = [
  {
    dup: "5d68332e",
    keep: "8743c7a6",
    replace: [
      ["Who Can File a Workplace Discrimination Claim in New York?", "Who Is Protected?"],
      ["Which Employers Must Comply with Antidiscrimination Laws?", "Which Employers Must Comply?"],
      ["Specific Protections Under New York Antidiscrimination Law", "Specific Protections Under New York and New Jersey Law"],
      ["Federal vs. State vs. City Law in New York Workplace Discrimination Cases", "Federal vs State vs Local Law"],
      ["Legal Remedies Available in Workplace Discrimination Cases", "Legal Remedies Available"],
      ["How to File a Workplace Discrimination Claim in New York", "How to File a Discrimination Claim"],
      ["Evidence and Documentation in Workplace Discrimination Cases", "Evidence and Documentation"],
      ["Statute of Limitations for Workplace Discrimination Claims in New York", "Statute of Limitations"],
    ],
    addFaq: [
      "How do I know if I have a workplace discrimination claim?",
      "Do I need to file a charge with the EEOC before filing a lawsuit?",
      "What is the difference between workplace discrimination and harassment?",
      "Can I file a workplace discrimination claim if I was not fired?",
      "How much is my workplace discrimination case worth?",
    ],
    addSections: [],
  },
  {
    dup: "f98564aa",
    keep: "74108f45",
    replace: [
      ["Who Is Protected Under New York Law?", "Who Qualifies for Family and Medical Leave?"],
      ["What Evidence Should You Gather First?", "Evidence You Need to Protect Your Leave Claim"],
      ["Deadlines That Can Impact Your Claim", "Statute of Limitations for Family and Medical Leave Claims"],
    ],
    addFaq: [
      "Can my employer require me to use paid time off before taking unpaid FMLA leave?",
      "Does FMLA protect me if I need intermittent leave for medical appointments?",
      "What happens if my employer says they cannot hold my position for 12 weeks?",
      "What is the difference between FMLA and New York Paid Family Leave?",
    ],
    addSections: ["When to Contact an Employment Attorney"],
  },
];

const clean = (s: string) => s.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** The span of a section: its heading line to the next heading of the same or higher level. */
function section(body: string, heading: string, level?: number): { start: number; end: number; text: string } | null {
  const re = /^(#{2,4})\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (clean(m[2]) !== clean(heading) || (level && m[1].length !== level)) continue;
    const lvl = m[1].length;
    const rest = body.slice(m.index + m[0].length);
    const next = rest.search(new RegExp(`^#{1,${lvl}}\\s`, "m"));
    const end = next === -1 ? body.length : m.index + m[0].length + next;
    return { start: m.index, end, text: body.slice(m.index, end).trimEnd() };
  }
  return null;
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await sb
    .from("content_drafts")
    .select("id,title,topic,status,format,practice_area,body,metadata")
    .eq("tenant_id", TENANT);
  if (error) throw new Error(error.message);
  const get = (p: string) => {
    const hits = (data ?? []).filter((d) => d.id.startsWith(p));
    if (hits.length !== 1) throw new Error(`${p} matches ${hits.length}`);
    return hits[0];
  };

  for (const plan of PLANS) {
    const dup = get(plan.dup);
    const keep = get(plan.keep);
    const dupBody: string = dup.body ?? "";
    let body: string = keep.body ?? "";
    const changes: FixChange[] = [];
    const at = new Date().toISOString();
    const problems: string[] = [];
    const reason = (what: string) =>
      `${what} from ${plan.dup}, corrected line by line on September 28, before it was archived (Kenneth, 2026-09-30, Option A).`;

    console.log(`\n== ${plan.dup} -> ${plan.keep} "${keep.title}"`);

    // Replacements, in place.
    for (const [dh, kh] of plan.replace) {
      const d = section(dupBody, dh, 2);
      const k = section(body, kh, 2);
      if (!d || !k) {
        problems.push(`not found: ${!d ? `duplicate "${dh}"` : ""} ${!k ? `keeper "${kh}"` : ""}`);
        continue;
      }
      const anchor = body.slice(Math.max(0, k.start - 40), k.start);
      body = body.slice(0, k.start) + d.text + "\n\n" + body.slice(k.end).replace(/^\n+/, "");
      changes.push({
        id: changeId(), where: kh, from: k.text, to: d.text, reason: reason(`Section "${kh}" replaced by the corrected "${dh}"`),
        source: "duplicate merge", source_ref: plan.dup, anchor_before: anchor, at,
      });
      console.log(`   replace  "${kh}" (${k.text.split(/\s+/).length}w) <- "${dh}" (${d.text.split(/\s+/).length}w)`);
    }

    // New sections, before the keeper's FAQ (or its closing).
    for (const h of plan.addSections) {
      const d = section(dupBody, h, 2);
      if (!d) { problems.push(`not found: duplicate section "${h}"`); continue; }
      const faq = body.search(/^##\s+[^\n]*\b(FAQ|Frequently Asked|Common Questions)\b/im);
      const idx = faq === -1 ? body.search(/^##\s+(Related Resources|About the Author)\b/im) : faq;
      const at2 = idx === -1 ? body.length : idx;
      const anchor = body.slice(Math.max(0, at2 - 40), at2);
      body = body.slice(0, at2) + d.text + "\n\n" + body.slice(at2);
      changes.push({
        id: changeId(), where: h, from: "", to: d.text, reason: reason(`Section "${h}" added`),
        source: "duplicate merge", source_ref: plan.dup, anchor_before: anchor, at,
      });
      console.log(`   add      ## ${h}`);
    }

    // New FAQ questions, at the end of the keeper's FAQ.
    for (const q of plan.addFaq) {
      const d = section(dupBody, q, 3);
      if (!d) { problems.push(`not found: duplicate FAQ "${q}"`); continue; }
      const faq = body.match(/^##\s+[^\n]*\b(FAQ|Frequently Asked|Common Questions)\b[^\n]*$/im);
      if (!faq || faq.index === undefined) { problems.push(`keeper has no FAQ for "${q}"`); continue; }
      const after = faq.index + faq[0].length;
      const next = body.slice(after).search(/^#{1,2}\s/m);
      const at3 = next === -1 ? body.length : after + next;
      const anchor = body.slice(Math.max(0, at3 - 40), at3);
      body = body.slice(0, at3).trimEnd() + "\n\n" + d.text + "\n\n" + body.slice(at3);
      changes.push({
        id: changeId(), where: "Frequently Asked Questions", from: "", to: d.text, reason: reason(`FAQ "${q}" added`),
        source: "duplicate merge", source_ref: plan.dup, anchor_before: anchor, at,
      });
      console.log(`   add FAQ  ### ${q}`);
    }

    body = body.replace(/\n{3,}/g, "\n\n");
    for (const p of problems) console.log(`   PROBLEM  ${p}`);
    console.log(`   ${keep.body.split(/\s+/).length} -> ${body.split(/\s+/).length} words, ${changes.length} changes`);

    if (apply && changes.length && problems.length === 0) {
      const meta = (keep.metadata as Record<string, unknown> | null) ?? {};
      const log = appendRun(readFixLog(meta), { previousTitle: keep.title, previousBody: keep.body ?? "", changes });
      const nextMeta = clearTextCertifications({ ...meta, legal_fix_log: log }).meta;
      const { error: e1 } = await sb.from("content_drafts").update({ body, metadata: nextMeta, updated_at: at }).eq("tenant_id", TENANT).eq("id", keep.id);
      if (e1) throw new Error(e1.message);
      await analyzeDraft({ draftId: keep.id, body, title: keep.title, topic: keep.topic, format: keep.format, practiceArea: keep.practice_area, tenantId: TENANT, notify: false })
        .catch((e) => console.warn(`   analysis failed: ${e instanceof Error ? e.message : e}`));
      console.log("   -> saved and re-analysed");
    } else if (apply) {
      console.log("   -> NOT saved (fix the problems above first)");
    }
  }
  if (!apply) console.log("\nDry run: nothing written. Re-run with --apply.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
