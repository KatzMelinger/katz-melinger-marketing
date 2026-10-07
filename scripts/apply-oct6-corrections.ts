/**
 * Diana's Oct 6 spec, Task 12: the hand-verified corrections, then the ending
 * normalizer on every open website draft.
 *
 *   node scripts/run.mjs scripts/apply-oct6-corrections.ts               # dry run: writes nothing
 *   node scripts/run.mjs scripts/apply-oct6-corrections.ts --apply       # writes bodies + Changes made
 *   ... --out report.md                                                  # also write the report
 *
 * Rules (spec Task 12): a find string must match exactly; with replace_all
 * false it must occur exactly once, otherwise the operation is skipped and
 * reported. An empty replace deletes. Every operation is one entry in the
 * draft's "Changes made" log (source, reason, undo), the previous version is
 * kept, text-bound certifications are cleared, and the log is left
 * unreviewed — so Approve stays blocked until a person reads the changes.
 *
 * Never changes a status, never approves, never publishes.
 *
 * Operations come from scripts/data/oct6-corrections.json (copied verbatim
 * from the spec) plus EXTRA_OPS below (the spec's "also do by hand" items and
 * the 43fb024e Commission sentence from Task 22). Kenneth's 2026-10-06 call
 * that "free consultation" is allowed skips the spec's deletions of
 * free-consultation sentences (POLICY_SKIP).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { normalizeEnding } from "../lib/legal-disclaimers";
import { getOperatingBrief } from "../lib/social-operating-brief";
import { appendRun, changeId, readFixLog, whereIs, type ChangeSource, type FixChange } from "../lib/legal-fix-log";
import { clearTextCertifications } from "../lib/draft-certifications";
import { matchTrap, rowToTrap, type KnownTrap } from "../lib/known-traps";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const TENANT = process.env.DEFAULT_TENANT_ID || "00000000-0000-0000-0000-000000000001";
const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const outPath = (() => {
  const i = argv.indexOf("--out");
  return i >= 0 ? argv[i + 1] : null;
})();

const WEBSITE_FORMATS = ["blog", "km_page_update", "km_practice_page", "km_blog_post"];

type Op = {
  draft_id: string;
  find?: string;
  find_block_start?: string;
  find_block_end?: string;
  replace: string;
  replace_all?: boolean;
  source: ChangeSource;
  reason: string;
};

const SPEC_OPS = JSON.parse(readFileSync("scripts/data/oct6-corrections.json", "utf8")) as Op[];

const NYCCHR_CORRECTED =
  "You generally have one year to file a complaint with the New York City Commission on Human Rights, or three years for gender based harassment. You have three years to file a lawsuit in court under the New York City Human Rights Law.";

const EXTRA_OPS: Op[] = [
  // Task 22: verified on 2026-10-06, the sentence appears twice.
  {
    draft_id: "43fb024e-2cf3-4e9d-a4b0-aaae28a9d2fe",
    find: "Under the New York City Human Rights Law, you have three years from the date of discrimination to file a charge with the New York City Commission on Human Rights or file a lawsuit in court.",
    replace: NYCCHR_CORRECTED,
    replace_all: true,
    source: "knowledge base",
    reason: "NYC Commission deadline is one year, three years only for gender based harassment",
  },
  // "Also do by hand": byline under the H1 of 91446913.
  {
    draft_id: "91446913-29a6-4c18-ac2c-5e5be5a38b74",
    find: "# Pressured to Retire Because of Age in New York: Executive Secured Strong Exit\n\n",
    replace: "# Pressured to Retire Because of Age in New York: Executive Secured Strong Exit\n\nBy Nicole Grunfeld, Katz Melinger PLLC\n\n",
    source: "firm fact",
    reason: "Every blog carries the practice area's author byline (employment: Nicole Grunfeld)",
  },
  // ...and the prior results line after its result section.
  {
    draft_id: "91446913-29a6-4c18-ac2c-5e5be5a38b74",
    find: "\n## What the Final Exit Package Included\n",
    replace: "\nPrior results do not guarantee a similar outcome.\n\n## What the Final Exit Package Included\n",
    source: "required element",
    reason: "A client result needs the prior results line",
  },
  // The lien sentence in 14f1c894.
  {
    draft_id: "14f1c894-c2a0-499a-b9fc-500e6b930973",
    find: "A judgment creates a lien on real property in the county where it is entered.",
    replace:
      "A judgment creates a lien on real property in the county where it is entered. A docketed judgment is a lien on the debtor's real property in that county for 10 years, and the creditor can extend it.",
    source: "knowledge base",
    reason: "NY judgment lien lasts 10 years from docketing and can be extended (CPLR 5203)",
  },
  // 35acc071: the Spanish contingency sentence.
  {
    draft_id: "35acc071",
    find: " Muchos abogados de empleo, incluyendo Katz Melinger PLLC, ofrecen consultas gratuitas y representan a empleados sobre una base de honorarios contingentes, lo que significa que no paga honorarios de abogado a menos que recupere una compensación.",
    replace: "",
    source: "firm fact",
    reason: "Fee rule: the firm does not describe contingency arrangements",
  },
  // bf522634: the contingency paragraph.
  {
    draft_id: "bf522634",
    find: "Most employment lawyers work on contingency. That means you don't pay upfront. The lawyer gets paid a percentage of what you recover, if you recover anything. If you don't win, you don't owe attorney fees.\n\n",
    replace: "",
    source: "firm fact",
    reason: "Fee rule: no statements about how lawyers charge",
  },
  // Found by the dry run on 2026-10-06, not in the spec (critical traps still
  // firing after the spec's operations). Proposed to Kenneth with the report.
  {
    draft_id: "bf522634",
    find: "Some cases are handled on an hourly basis, especially if the goal is negotiating a severance package rather than filing a lawsuit. The lawyer will explain the fee structure during or after the consultation.\n\n",
    replace: "",
    source: "firm fact",
    reason: "Fee rule: no statements about how lawyers charge (added after the dry run)",
  },
  {
    draft_id: "35acc071",
    find: " La firma ofrece representación con honorarios contingentes, lo que significa que no paga honorarios de abogado a menos que recupere una compensación.",
    replace: "",
    source: "firm fact",
    reason: "Fee rule, and untrue: the firm does not work on contingency (added after the dry run)",
  },
  {
    draft_id: "5b710c12",
    find: "To file with the NYCCHR, the deadline is 1 year from the act of harassment.",
    replace: "To file with the NYCCHR, the deadline is one year from the act of harassment, or three years for gender based harassment.",
    source: "knowledge base",
    reason: "NYC Commission deadline for gender based harassment is 3 years (added after the dry run)",
  },
  {
    draft_id: "5b710c12",
    find: "A settlement typically includes a monetary payment, a confidentiality agreement, and a release of claims.",
    replace:
      "A settlement typically includes a monetary payment and a release of claims. In New York, a settlement of a discrimination or harassment claim may include confidentiality only if that is the employee's preference (New York General Obligations Law § 5-336), and New Jersey law bars terms that conceal the details of such claims (N.J.S.A. 10:5-12.8).",
    source: "knowledge base",
    reason: "Confidentiality limits in NY and NJ settlements (added after the dry run)",
  },
];

/** Kenneth, 2026-10-06: "free consultation" may be used. These spec deletions no longer apply. */
function policySkip(op: Op): string | null {
  if (op.replace === "" && /\bfree (?:initial )?consultations?\b/i.test(op.find ?? "") && !/Call\b/.test(op.find ?? "")) {
    return 'skipped: "free consultation" is allowed (Kenneth, 2026-10-06)';
  }
  return null;
}

type OpResult = { op: Op; status: "applied" | "not found" | "ambiguous" | "policy"; detail?: string; count?: number };

function count(hay: string, needle: string): number {
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

function applyOp(body: string, op: Op, changes: FixChange[], at: string): { body: string; result: OpResult } {
  const skip = policySkip(op);
  if (skip) return { body, result: { op, status: "policy", detail: skip } };

  // Block delete: from the start marker through the end marker, inclusive.
  if (op.find_block_start && op.find_block_end) {
    const s = body.indexOf(op.find_block_start);
    const e = s === -1 ? -1 : body.indexOf(op.find_block_end, s);
    if (s === -1 || e === -1) return { body, result: { op, status: "not found" } };
    if (body.indexOf(op.find_block_start, s + 1) !== -1) return { body, result: { op, status: "ambiguous", count: 2 } };
    const span = body.slice(s, e + op.find_block_end.length);
    changes.push({ id: changeId(), where: whereIs(body, s), from: span, to: op.replace, reason: op.reason, source: op.source, source_ref: "oct6_task12", anchor_before: body.slice(Math.max(0, s - 40), s), at });
    return { body: body.slice(0, s) + op.replace + body.slice(e + op.find_block_end.length), result: { op, status: "applied", count: 1 } };
  }

  const find = op.find ?? "";
  // An insertion's replacement contains its find string, so without this a
  // second run would insert again (a second byline, a second lien sentence).
  if (op.replace && op.replace.includes(find) && body.includes(op.replace)) {
    return { body, result: { op, status: "not found", detail: "already applied" } };
  }
  const n = count(body, find);
  if (n === 0) return { body, result: { op, status: "not found" } };
  if (n > 1 && !op.replace_all) return { body, result: { op, status: "ambiguous", count: n } };
  let next = body;
  for (let k = 0; k < n; k++) {
    const i = next.indexOf(find);
    changes.push({ id: changeId(), where: whereIs(next, i), from: find, to: op.replace, reason: op.reason, source: op.source, source_ref: "oct6_task12", anchor_before: next.slice(Math.max(0, i - 40), i), at });
    next = next.slice(0, i) + op.replace + next.slice(i + find.length);
  }
  return { body: next, result: { op, status: "applied", count: n } };
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: drafts, error } = await sb
    .from("content_drafts")
    .select("id, title, topic, format, status, body, metadata")
    .eq("tenant_id", TENANT)
    .in("format", WEBSITE_FORMATS)
    .not("status", "in", "(archived,published)");
  if (error) throw new Error(error.message);
  const { data: trapRows } = await sb.from("content_known_traps").select("*").eq("tenant_id", TENANT).eq("enabled", true);
  const traps: KnownTrap[] = (trapRows ?? []).map(rowToTrap);
  const brief = await getOperatingBrief(TENANT);
  const cta = { phone: brief.webPhone, offerPhrase: brief.offerPhrase };

  const ops = [...SPEC_OPS, ...EXTRA_OPS];
  const byDraft = new Map<string, Op[]>();
  for (const op of ops) {
    const d = (drafts ?? []).find((x) => x.id === op.draft_id || x.id.startsWith(op.draft_id));
    const key = d?.id ?? op.draft_id;
    byDraft.set(key, [...(byDraft.get(key) ?? []), op]);
  }

  const lines: string[] = [];
  const log = (s = "") => {
    lines.push(s);
    console.log(s);
  };
  log(`# Oct 6 Task 12 corrections ${apply ? "(APPLIED)" : "(dry run, nothing written)"}`);
  log(`${(drafts ?? []).length} open website drafts · ${ops.length} operations · CTA "${cta.phone}" / "${cta.offerPhrase}"`);
  log("");

  const tally = { applied: 0, "not found": 0, ambiguous: 0, policy: 0 };
  let endingChanged = 0;
  let written = 0;
  const at = new Date().toISOString();

  for (const d of drafts ?? []) {
    const original = (d.body as string | null) ?? "";
    const meta = (d.metadata as Record<string, unknown> | null) ?? {};
    const changes: FixChange[] = [];
    let body = original;
    const draftOps = byDraft.get(d.id) ?? [];
    const results: OpResult[] = [];
    for (const op of draftOps) {
      const r = applyOp(body, op, changes, at);
      body = r.body;
      results.push(r.result);
      tally[r.result.status]++;
    }
    byDraft.delete(d.id);

    const opChanges = changes.length;
    const ending = normalizeEnding(body, { cta, language: (meta.language as string | undefined) ?? null });
    if (ending.changes.length) {
      endingChanged++;
      body = ending.body;
      for (const c of ending.changes) {
        const i = c.to ? body.indexOf(c.to) : -1;
        changes.push({ id: changeId(), where: c.where, from: c.from, to: c.to, reason: c.reason, source: "required element", source_ref: c.ref, anchor_before: c.anchor ?? (i > 0 ? body.slice(Math.max(0, i - 40), i) : ""), at });
      }
    }

    if (draftOps.length) {
      log(`## ${d.id.slice(0, 8)} ${d.title ?? ""} (${d.status})`);
      for (const r of results) {
        const what = (r.op.find ?? r.op.find_block_start ?? "").replace(/\s+/g, " ").slice(0, 90);
        const tag = r.status === "applied" ? `applied${r.count && r.count > 1 ? ` x${r.count}` : ""}` : r.status === "ambiguous" ? `SKIPPED, found ${r.count} times` : r.status === "not found" ? "SKIPPED, not found" : r.detail;
        log(`- [${tag}] "${what}…" (${r.op.reason})`);
      }
      // Traps still firing on the corrected body.
      const ctx = { title: d.title, topic: d.topic, primaryKeyword: String((meta.primaryKeyword as string) ?? ""), isWebPage: true };
      const still = traps.filter((t) => matchTrap(t, body, ctx).length > 0).map((t) => `${t.label} (${t.severity})`);
      log(`- ending: ${ending.changes.length} change(s) · traps still firing: ${still.length ? still.join("; ") : "none"}`);
      log("");
    }

    if (apply && changes.length > 0) {
      const fixLog = appendRun(readFixLog(meta), { previousTitle: (d.title as string | null) ?? null, previousBody: original, changes });
      const nextMeta = clearTextCertifications({ ...meta, legal_fix_log: fixLog }).meta;
      const { error: upd } = await sb
        .from("content_drafts")
        .update({ body, metadata: nextMeta, updated_at: new Date().toISOString() })
        .eq("tenant_id", TENANT)
        .eq("id", d.id);
      if (upd) log(`!! ${d.id.slice(0, 8)} write failed: ${upd.message}`);
      else written++;
    }
    void opChanges;
  }

  for (const [id, rest] of byDraft) {
    log(`## ${id.slice(0, 8)}: NOT AN OPEN WEBSITE DRAFT, ${rest.length} operation(s) skipped`);
    tally["not found"] += rest.length;
  }

  log("");
  log(`Operations: ${tally.applied} applied, ${tally["not found"]} not found, ${tally.ambiguous} ambiguous, ${tally.policy} skipped by policy.`);
  log(`Ending normalizer: ${endingChanged} of ${(drafts ?? []).length} drafts change.`);
  if (apply) log(`Written: ${written} drafts. Each has an unreviewed "Changes made" log, so Approve waits for a person.`);
  if (outPath) writeFileSync(outPath, lines.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
