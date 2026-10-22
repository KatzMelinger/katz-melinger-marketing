/**
 * Corrections made by hand become regression cases (Oct 20 spec, Task A10):
 * "Every correction Diana or an attorney makes by hand is saved as a
 * regression case and, when it is a fact, as a knowledge base entry, so the
 * system does not repeat the mistake."
 *
 * A save that changes a few sentences is read as corrections: each removed
 * sentence paired with the added sentence most like it. A save that rewrites
 * most of the article is an edit, not a correction, and records nothing.
 *
 * Facts (a figure, a deadline, a statute): an attorney's correction is learned
 * at once (lib/legal-learned, the same as answering a question). Diana's waits
 * for an attorney (Kenneth, 2026-10-06: knowledge base edits need an
 * attorney), shown as "pending attorney" on /content/results.
 *
 * Every day each case is run again (runRegressionCases): it passes when the
 * system would now fix the original sentence itself (a learned correction) or
 * flag it (a trap). A failing case is a mistake the system can still make.
 */
import { getSupabaseAdmin } from "./supabase-server";
import { learnCorrection, learnedCorrections, loadLearned, sentenceKey } from "./legal-learned";
import { runTrapCheck } from "./trap-gate";

export type CorrectionPair = { before: string; after: string };

/** Sentences of an article, markdown and links flattened. */
export function sentencesOf(text: string): string[] {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>`]/g, " ")
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 25);
}

const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9$%.]+/g) ?? []);

function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  let both = 0;
  for (const t of ta) if (tb.has(t)) both++;
  return both / Math.max(1, Math.min(ta.size, tb.size) + Math.abs(ta.size - tb.size) / 2);
}

/**
 * The corrections in an edit: removed sentences paired with the added sentence
 * most like them (similarity 0.5 or more). More than 12 changed sentences is a
 * rewrite, not a correction, and returns nothing.
 */
export function correctionPairs(oldText: string, newText: string): CorrectionPair[] {
  const before = sentencesOf(oldText);
  const after = sentencesOf(newText);
  const afterKeys = new Set(after.map(sentenceKey));
  const beforeKeys = new Set(before.map(sentenceKey));
  const removed = before.filter((s) => !afterKeys.has(sentenceKey(s)));
  const added = after.filter((s) => !beforeKeys.has(sentenceKey(s)));
  if (!removed.length || !added.length || removed.length > 12 || added.length > 12) return [];
  const pairs: CorrectionPair[] = [];
  const used = new Set<number>();
  for (const r of removed) {
    let best = -1;
    let score = 0.5;
    added.forEach((a, i) => {
      if (used.has(i)) return;
      const s = similarity(r, a);
      if (s >= score) {
        score = s;
        best = i;
      }
    });
    if (best >= 0) {
      used.add(best);
      pairs.push({ before: r, after: added[best] });
    }
  }
  return pairs;
}

/** A correction that changes a figure, a date, a deadline or a citation. */
export function isFactCorrection(p: CorrectionPair): boolean {
  const facts = (s: string) => (s.match(/\$?\d[\d,.]*%?|§+\s*[\d.-]+|\b(?:days?|years?|months?|employees?)\b/gi) ?? []).join("|").toLowerCase();
  return facts(p.before) !== facts(p.after);
}

function isMissing(message: string | undefined): boolean {
  return !!message && /regression_cases|does not exist|schema cache/i.test(message);
}

export async function recordCorrections(args: {
  tenantId: string;
  draftId: string;
  oldText: string;
  newText: string;
  by: string | null;
  role: "editor" | "attorney";
  /** The pairs, when the caller already knows them (an attorney's Replace with). */
  pairs?: CorrectionPair[];
}): Promise<number> {
  const pairs = args.pairs ?? correctionPairs(args.oldText, args.newText);
  if (!pairs.length) return 0;
  const rows = [];
  for (const p of pairs) {
    const fact = isFactCorrection(p);
    let kb = "n/a";
    if (fact && args.role === "attorney" && args.by) {
      await learnCorrection({ tenantId: args.tenantId, from: p.before, to: p.after, by: args.by, draftId: args.draftId, rule: "manual correction" });
      kb = "learned";
    } else if (fact) {
      kb = "pending_attorney";
    }
    rows.push({
      tenant_id: args.tenantId,
      draft_id: args.draftId,
      before_text: p.before,
      after_text: p.after,
      by_email: args.by,
      by_role: args.role,
      is_fact: fact,
      kb_status: kb,
    });
  }
  const { error } = await getSupabaseAdmin()
    .from("regression_cases")
    .upsert(rows, { onConflict: "tenant_id,before_text,after_text", ignoreDuplicates: true });
  if (error && !isMissing(error.message)) console.warn("[regression-cases] save failed:", error.message);
  return error ? 0 : rows.length;
}

export type RegressionCase = {
  id: string;
  draft_id: string | null;
  before_text: string;
  after_text: string;
  by_email: string | null;
  by_role: string;
  is_fact: boolean;
  kb_status: string;
  enabled: boolean;
  last_run_at: string | null;
  last_result: string | null;
  last_detail: string | null;
  created_at: string;
};

export async function listCases(tenantId: string, limit = 200): Promise<RegressionCase[] | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("regression_cases")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return isMissing(error.message) ? null : [];
  return (data ?? []) as RegressionCase[];
}

/** An attorney confirms Diana's fact correction: it is learned from then on. */
export async function confirmCase(tenantId: string, id: string, by: string): Promise<boolean> {
  const sb = getSupabaseAdmin();
  const { data } = await sb.from("regression_cases").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!data) return false;
  const c = data as RegressionCase;
  await learnCorrection({ tenantId, from: c.before_text, to: c.after_text, by, draftId: c.draft_id, rule: "manual correction" });
  await sb.from("regression_cases").update({ kb_status: "learned" }).eq("tenant_id", tenantId).eq("id", id);
  return true;
}

/** Run every case once: does the system now fix or flag the original sentence? */
export async function runRegressionCases(tenantId: string): Promise<{ run: number; passed: number; failed: number }> {
  const cases = await listCases(tenantId, 1000);
  if (!cases) return { run: 0, passed: 0, failed: 0 };
  const learned = learnedCorrections(await loadLearned(tenantId));
  const fixes = new Map(learned.map((l) => [sentenceKey(l.from), l.to]));
  const sb = getSupabaseAdmin();
  let passed = 0;
  let failed = 0;
  for (const c of cases.filter((x) => x.enabled)) {
    let result: "pass" | "fail" = "fail";
    let detail = "";
    const fix = fixes.get(sentenceKey(c.before_text));
    if (fix) {
      result = "pass";
      detail = "Corrected automatically by the learned correction.";
    } else {
      const traps = await runTrapCheck(c.before_text, { tenantId });
      if (traps.findings.length) {
        result = "pass";
        detail = `Flagged: ${traps.findings[0].title}.`;
      } else {
        detail = c.is_fact
          ? c.kb_status === "pending_attorney"
            ? "Not caught yet: waiting for an attorney to confirm the correction."
            : "Not caught: no learned correction or trap covers this sentence."
          : "Wording or style correction: not caught by a check. Add a trap if it should be.";
      }
    }
    if (result === "pass") passed++;
    else failed++;
    await sb
      .from("regression_cases")
      .update({ last_run_at: new Date().toISOString(), last_result: result, last_detail: detail })
      .eq("tenant_id", tenantId)
      .eq("id", c.id);
  }
  return { run: passed + failed, passed, failed };
}
