/**
 * Remove firm fee claims from every draft that contains one.
 *
 * Diana's §6, refined 2026-08-26: content must not state or imply how KATZ
 * MELINGER charges. Accurate statements about the market ("most employment
 * lawyers work on contingency") stay. Borderline cases go to a human. So this
 * touches ONLY hits classified `firm` — nothing else is in scope, and the
 * `general` and `ambiguous` hits are deliberately left alone.
 *
 * Dry-run by default. Nothing is written until you pass --apply.
 *
 *   node scripts/run.mjs scripts/strip-fee-language.ts              # preview
 *   node scripts/run.mjs scripts/strip-fee-language.ts --apply
 *   node scripts/run.mjs scripts/strip-fee-language.ts --apply --limit 5
 *   node scripts/run.mjs scripts/strip-fee-language.ts --draft <id>
 *
 * WHY A MODEL WRITES AND A PATTERN DECIDES
 *
 * A regex could delete the matched span, and the result would frequently be
 * ungrammatical — "Katz Melinger PLLC represents employees ." — or would strand
 * a clause that only made sense with the fee reference in it. Removing a claim
 * from prose is a language task.
 *
 * But a model is not trustworthy as the last word on whether the claim is gone.
 * So the model rewrites and the deterministic checker decides:
 *
 *   1. the rewrite must contain ZERO firm-subject fee hits;
 *   2. it must not have introduced a different fee model — "flat fee", hourly,
 *      retainer — which Diana explicitly forbade as a substitution;
 *   3. it must not have dropped `general` fee statements that were allowed to
 *      stay, or the "fix" quietly becomes the over-blocking she rejected;
 *   4. it must not have lost substantial content: a rewrite that shortens a
 *      draft by more than a fifth is deleting more than a fee clause.
 *
 * A rewrite failing any of those is REPORTED AND SKIPPED, never written. The
 * draft stays as it was and a person looks at it.
 *
 * ON AMBIGUOUS HITS
 *
 * A run legitimately reduces the `ambiguous` count in the drafts it touches,
 * and that is not overreach. The classifier works per SENTENCE; a fee claim
 * often spans two. "We work on contingency" is firm-subject; the "You pay
 * nothing unless you recover" that follows it has no we/our of its own and so
 * reads as ambiguous in isolation. They are one claim, and the rewrite removes
 * both — correctly.
 *
 * What must NOT happen is losing a market statement, and that is gated (3).
 * Drafts with ambiguous hits and NO firm claim are never opened at all, so the
 * genuinely borderline material Diana routed to human review stays untouched.
 *
 * Every write is recorded in content_audit_log with the before/after hit counts.
 */

import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { CONTENT_SHORT_FORM_MODEL, getAnthropic } from "../lib/anthropic";
import { findFeeLanguage, type FeeLanguageHit } from "../lib/fee-language";
import { recordAuditEvent } from "../lib/content-findings-store";

function loadEnv() {
  let raw = "";
  try {
    raw = readFileSync(".env.local", "utf8");
  } catch {
    console.error("Could not read .env.local from the current directory.");
    process.exit(1);
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    if (!(key in process.env)) {
      process.env[key] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
}

/** A fee model must not be swapped in for the one removed. */
const SUBSTITUTED_FEE_MODEL =
  /\b(?:flat[-\s]fee|flat[-\s]rate|hourly\s+(?:rate|fee|billing)|retainer|billed\s+by\s+the\s+hour)\b/i;

type Draft = {
  id: string;
  title: string | null;
  topic: string | null;
  body: string;
  status: string;
  tenant_id: string | null;
};

type Verdict = { ok: true } | { ok: false; reason: string };

/**
 * Does this rewrite deserve to be written? Everything here is deterministic;
 * the model gets no say in whether its own output is acceptable.
 */
function verify(original: string, rewritten: string): Verdict {
  if (!rewritten || rewritten.trim().length === 0) {
    return { ok: false, reason: "model returned nothing" };
  }

  const after = findFeeLanguage(rewritten);
  const stillFirm = after.filter((h) => h.subject === "firm");
  if (stillFirm.length > 0) {
    return {
      ok: false,
      reason: `still contains ${stillFirm.length} firm fee claim(s): "${stillFirm[0].match}"`,
    };
  }

  if (SUBSTITUTED_FEE_MODEL.test(rewritten) && !SUBSTITUTED_FEE_MODEL.test(original)) {
    const m = rewritten.match(SUBSTITUTED_FEE_MODEL);
    return { ok: false, reason: `substituted a fee model ("${m?.[0]}") instead of deleting` };
  }

  // The market statements were explicitly allowed to stay. Losing them means the
  // rewrite over-corrected into exactly the behaviour Diana rejected.
  const beforeGeneral = findFeeLanguage(original).filter((h) => h.subject === "general").length;
  const afterGeneral = after.filter((h) => h.subject === "general").length;
  if (afterGeneral < beforeGeneral) {
    return {
      ok: false,
      reason: `removed ${beforeGeneral - afterGeneral} permitted market statement(s)`,
    };
  }

  const ratio = rewritten.trim().length / Math.max(1, original.trim().length);
  if (ratio < 0.8) {
    return {
      ok: false,
      reason: `lost ${Math.round((1 - ratio) * 100)}% of the content — more than a fee clause`,
    };
  }
  if (ratio > 1.15) {
    return { ok: false, reason: `grew by ${Math.round((ratio - 1) * 100)}% — the model added text` };
  }

  return { ok: true };
}

const SYSTEM = `You remove fee claims from a law firm's marketing content.

Katz Melinger PLLC is FLAT-FEE and has never worked on a contingency basis, so any
claim that it does is false as well as against firm policy.

YOUR ONLY JOB: delete statements that say or imply how KATZ MELINGER charges.

Rules, in order of importance:
1. DELETE the fee reference. Never replace it with another fee model. Do NOT write
   "flat fee", "hourly", "retainer", or any rate. Say nothing about fees at all.
2. Keep every other word the same. This is a deletion, not a rewrite. Do not
   improve, restructure, retitle, or shorten anything else.
3. KEEP accurate general statements about other lawyers or the market — e.g.
   "most employment lawyers handle overtime cases on contingency". Those are true,
   they are not about this firm, and they stay exactly as written.
4. Leave the text grammatical. If deleting a clause breaks the sentence, repair
   the sentence minimally, or drop the whole sentence if that reads better.
5. "A free initial consultation" is permitted and should be kept if present.
6. Preserve the markdown structure, headings, and formatting exactly.

Return ONLY the corrected content. No preamble, no explanation, no code fence.`;

async function rewrite(body: string, hits: FeeLanguageHit[]): Promise<string> {
  const list = hits
    .map((h, i) => `${i + 1}. [${h.rule}] "${h.match}" in: "${h.sentence}"`)
    .join("\n");
  const res = await getAnthropic().messages.create({
    model: CONTENT_SHORT_FORM_MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Remove these ${hits.length} firm fee claim(s):\n\n${list}\n\nCONTENT:\n"""\n${body}\n"""`,
      },
    ],
  });
  const text = res.content[0]?.type === "text" ? res.content[0].text : "";
  return text
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const limitArg = args.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;
  const draftArg = args.indexOf("--draft");
  const onlyDraft = draftArg >= 0 ? args[draftArg + 1] : null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  let q = sb
    .from("content_drafts")
    .select("id, title, topic, body, status, tenant_id")
    .not("status", "in", "(archived)");
  if (onlyDraft) q = q.eq("id", onlyDraft);
  const { data, error } = await q;
  if (error) {
    console.error("Failed to read drafts:", error.message);
    process.exit(1);
  }

  const targets: { draft: Draft; hits: FeeLanguageHit[] }[] = [];
  for (const d of (data ?? []) as Draft[]) {
    const hits = findFeeLanguage(typeof d.body === "string" ? d.body : "").filter(
      (h) => h.subject === "firm",
    );
    if (hits.length > 0) targets.push({ draft: d, hits });
  }

  const total = targets.reduce((n, t) => n + t.hits.length, 0);
  console.log(
    `${targets.length} draft(s) contain ${total} firm fee claim(s).${
      apply ? "" : " Dry run — nothing will be written."
    }\n`,
  );

  const slice = targets.slice(0, Number.isFinite(limit) ? limit : targets.length);
  let fixed = 0;
  let skipped = 0;
  const skips: string[] = [];

  for (const [i, { draft, hits }] of slice.entries()) {
    const name = (draft.title || draft.topic || draft.id).slice(0, 52);
    process.stdout.write(`[${i + 1}/${slice.length}] ${name} (${hits.length}) … `);

    let out: string;
    try {
      out = await rewrite(draft.body, hits);
    } catch (e) {
      skipped++;
      const why = e instanceof Error ? e.message : String(e);
      console.log(`SKIP — model call failed: ${why}`);
      skips.push(`${name}: ${why}`);
      continue;
    }

    const verdict = verify(draft.body, out);
    if (!verdict.ok) {
      skipped++;
      console.log(`SKIP — ${verdict.reason}`);
      skips.push(`${name}: ${verdict.reason}`);
      continue;
    }

    if (!apply) {
      console.log(`would fix (${draft.body.length} -> ${out.length} chars)`);
      // Show what actually changes, so the preview is worth reading.
      for (const h of hits.slice(0, 2)) console.log(`        removing: "${h.sentence.slice(0, 100)}"`);
      fixed++;
      continue;
    }

    const { error: upErr } = await sb
      .from("content_drafts")
      .update({ body: out, updated_at: new Date().toISOString() })
      .eq("id", draft.id);
    if (upErr) {
      skipped++;
      console.log(`SKIP — write failed: ${upErr.message}`);
      skips.push(`${name}: ${upErr.message}`);
      continue;
    }

    await recordAuditEvent({
      tenantId: draft.tenant_id ?? "00000000-0000-0000-0000-000000000001",
      draftId: draft.id,
      event: "fee_language_removed",
      detail: {
        claims_removed: hits.length,
        rules: hits.map((h) => h.rule),
        chars_before: draft.body.length,
        chars_after: out.length,
      },
    });

    fixed++;
    console.log("fixed");
  }

  console.log(
    `\n${apply ? "Fixed" : "Would fix"} ${fixed}, skipped ${skipped}, ${
      targets.length - slice.length
    } not attempted.`,
  );
  if (skips.length) {
    console.log("\nSkipped (left untouched, need a person):");
    for (const s of skips) console.log(`  - ${s}`);
  }
  if (!apply && fixed > 0) console.log("\nRe-run with --apply to write these changes.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
