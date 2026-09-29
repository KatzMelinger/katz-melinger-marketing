/**
 * Regenerate the three debtor-side collection blogs for creditors (Diana's
 * Sept 28 spec, Appendix G).
 *
 *   node scripts/run.mjs scripts/redraft-debtor-blogs.ts --out-dir <dir>   # preview: writes each draft to a .md file, touches nothing
 *   node scripts/run.mjs scripts/redraft-debtor-blogs.ts --apply           # saves them
 *
 * Keeps each draft id (history kept), saves the old body in the change log
 * with reason "Full redraft: wrong audience", sets the author to Adam
 * Sackowitz, and never changes a status. Each new body goes through the same
 * checks and rewrite as any generated draft, and the Changes made log is left
 * unreviewed, so Approve waits for a person. An attorney should confirm the
 * legal facts before approval (Appendix G).
 */
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAnthropic, CONTENT_LONG_FORM_MODEL } from "../lib/anthropic";
import { groundAndFix, groundingBlock } from "../lib/generation-grounding";
import { appendRun, changeId, readFixLog } from "../lib/legal-fix-log";
import { renderFirmFactsBlock } from "../lib/firm-facts";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const TENANT = process.env.DEFAULT_TENANT_ID || "00000000-0000-0000-0000-000000000001";
const apply = process.argv.includes("--apply");
const outDir = (() => {
  const i = process.argv.indexOf("--out-dir");
  return i >= 0 ? process.argv[i + 1] : null;
})();

const RULES = `Rules for all three (Appendix G):
- Audience: owners, CFOs, controllers and credit managers of businesses in New York and New Jersey that are owed money by other businesses. Never address the person who owes the debt, and never explain how to avoid, dispute or defend against a collection.
- Only commercial (business to business) debts. Do not discuss consumer debt, credit cards, medical debt or personal loans. Where it helps, say that the federal Fair Debt Collection Practices Act covers consumer debts, not business debts.
- No fee language of any kind (no contingency, percentages, hourly rates, "no recovery, no fee"). Do not link the attorney fees page.
- No promises of results, no recovery percentages, no statistics without an official source.
- Voice: calm, clear, practical, written for a busy business owner; short paragraphs; New York and New Jersey spelled out; no dashes; no "expert" or "specialize".
- Byline "By Adam Sackowitz, Katz Melinger PLLC". Three or more internal links from the commercial collections and judgment enforcement pages, including https://katzmelinger.com/practice-areas/civil-litigation/new-york-commercial-collections-attorney/.
- Legal facts the draft may use (and no others): New York contract claims generally have a six year limitations period (CPLR 213(2)); New Jersey contract claims generally six years (N.J.S.A. 2A:14 1); claims for the sale of goods generally four years in both states (UCC 2 725); a New York money judgment can generally be enforced for 20 years (CPLR 211(b)), though a judgment lien on real property lasts 10 years unless extended (CPLR 5203); a New Jersey judgment for 20 years (N.J.S.A. 2A:14 5); New York prejudgment interest on contract claims is generally 9 percent a year (CPLR 5004). State these with "generally" and suggest confirming with an attorney.`;

const BRIEFS = [
  {
    prefix: "bd131d46",
    title: "What to Expect When You Hire a Law Firm to Collect a Business Debt in New York",
    keyword: "debt collection law firm for businesses New York",
    sections:
      "when a business should move from its own reminders to a law firm; what the firm needs from you (contract or invoices, purchase orders, delivery proof, statements, emails acknowledging the debt, any personal guarantee); the demand letter stage; filing suit if the debtor does not pay; possible outcomes (payment plan, settlement, judgment); enforcing a judgment (link to judgment enforcement); how long each stage usually takes, described generally and without promises; FAQ (Can we keep doing business with the customer during collection? What if the debtor says the goods were defective? What if the company closes?).",
  },
  {
    prefix: "12000a02",
    title: "How a Law Firm Demand Letter Helps Businesses Collect Unpaid Invoices",
    keyword: "demand letter for unpaid invoices New York",
    sections:
      "what a demand letter from a law firm is and why it gets a different response than an in house reminder; what it should include (amount, basis for the claim, deadline, next step); documents that make it stronger; what happens if the business ignores it; common mistakes creditors make (waiting too long, no written contract, accepting partial payments without a written agreement); oral versus written agreements (link to https://katzmelinger.com/resources/oral-vs-written-contracts-ny-collections/); FAQ.",
  },
  {
    prefix: "c33886d8",
    title: "Statute of Limitations for Commercial Debt Collection in New York and New Jersey",
    keyword: "statute of limitations commercial debt New York",
    sections:
      "why deadlines matter to creditors; six years for contract claims in New York and New Jersey; four years for sale of goods claims under the UCC; when the clock generally starts (breach or last payment, stated generally with \"may\" and a note to confirm with an attorney); how long a judgment lasts once you have one (20 years in both states); what to do if an invoice is getting old; FAQ.",
  },
];

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: rows, error } = await sb
    .from("content_drafts")
    .select("id, title, body, status, metadata")
    .eq("tenant_id", TENANT)
    .in("format", ["blog", "km_blog_post", "km_page_update", "km_practice_page"]);
  if (error) throw new Error(error.message);
  if (outDir) mkdirSync(outDir, { recursive: true });

  for (const b of BRIEFS) {
    const draft = (rows ?? []).find((r) => r.id.startsWith(b.prefix));
    if (!draft) {
      console.log(`${b.prefix}: not found`);
      continue;
    }
    const grounding = await groundingBlock({ tenantId: TENANT, title: b.title, topic: b.keyword, practiceArea: "collections" });
    const msg = await getAnthropic().messages.create({
      model: CONTENT_LONG_FORM_MODEL,
      max_tokens: 6000,
      system: `You write for Katz Melinger PLLC, a New York and New Jersey law firm. In commercial collections and judgment enforcement it represents creditors and businesses only.\n\n${renderFirmFactsBlock()}\n\n${grounding}`,
      messages: [
        {
          role: "user",
          content: `Write a complete blog post in Markdown.\n\nTitle (use as the H1): ${b.title}\nPrimary keyword: ${b.keyword}\n\nSections: ${b.sections}\n\n${RULES}\n\nReturn only the article.`,
        },
      ],
    });
    const text = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim();
    const fixed = await groundAndFix({ tenantId: TENANT, body: text, title: b.title, topic: b.keyword, practiceArea: "collections", format: "blog" });

    console.log(`\n== ${b.prefix}  ${b.title}`);
    console.log(`   ${fixed.body.split(/\s+/).length} words; ${fixed.fixLog?.changes.length ?? 0} automatic changes${fixed.fullRedraft ? `; STILL FLAGGED: ${fixed.fullRedraft}` : ""}`);
    if (outDir) writeFileSync(join(outDir, `${b.prefix}.md`), `# (was) ${draft.title}\n\n---\n\n${fixed.body}`);

    if (apply && !fixed.fullRedraft) {
      const meta = (draft.metadata as Record<string, unknown> | null) ?? {};
      const at = new Date().toISOString();
      // The redraft itself is one logged change; the checks' own fixes follow it.
      let log = appendRun(readFixLog(meta), {
        previousTitle: draft.title,
        previousBody: draft.body ?? "",
        changes: [
          {
            id: changeId(),
            where: "Whole draft",
            from: `(previous debtor-side article: "${draft.title}")`,
            to: `(regenerated for creditors: "${b.title}")`,
            reason: "Full redraft: wrong audience (Appendix G). The previous version is saved.",
            source: "firm fact",
            source_ref: "firm_off_practice",
            at,
          },
        ],
      });
      if (fixed.fixLog) log = { ...log, changes: [...log.changes, ...fixed.fixLog.changes] };
      log = { ...log, full_redraft_needed: null };
      const { error: upd } = await sb
        .from("content_drafts")
        .update({
          title: b.title,
          topic: b.keyword,
          body: fixed.body,
          practice_area: "Commercial Collections",
          metadata: { ...meta, legal_fix_log: log, redrafted_for: "creditors", redrafted_at: at },
          updated_at: at,
        })
        .eq("tenant_id", TENANT)
        .eq("id", draft.id);
      console.log(upd ? `   save failed: ${upd.message}` : "   saved (status unchanged; Changes made awaits review)");
    }
  }
  if (!apply) console.log(`\nPreview only${outDir ? `, written to ${outDir}` : ""}. Nothing saved. Re-run with --apply.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
