/**
 * What the system learns from attorneys (Kenneth, 2026-10-12).
 *
 * When a reviewing attorney marks a legal sentence "Approved as is", that exact
 * sentence is approved everywhere: no draft sends it to an attorney again.
 * When an attorney types a replacement, the wrong sentence is remembered with
 * the attorney's text: the fixer corrects it in any later draft, and the
 * correction is logged in Changes made with who approved it.
 *
 * Exact sentences only (case, spacing, quotes and links ignored). A looser
 * match could carry an attorney's decision onto a sentence they never read.
 * Every entry is listed on /content/rules and can be switched off.
 */
import { getSupabaseAdmin } from "./supabase-server";
import { quoteText } from "./finding-currency";

export type LearnedStatement = {
  id: string;
  kind: "approved" | "correction";
  sentence_key: string;
  sentence: string;
  replacement: string | null;
  approved_by_email: string;
  approved_at: string;
  draft_id: string | null;
  finding_rule: string | null;
  enabled: boolean;
};

export const sentenceKey = (s: string) => quoteText(s);

function isMissing(message: string | undefined): boolean {
  return !!message && /legal_learned_statements|does not exist|schema cache/i.test(message);
}

export async function loadLearned(tenantId: string, opts: { includeDisabled?: boolean } = {}): Promise<LearnedStatement[]> {
  try {
    let q = getSupabaseAdmin()
      .from("legal_learned_statements")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("approved_at", { ascending: false });
    if (!opts.includeDisabled) q = q.eq("enabled", true);
    const { data, error } = await q;
    if (error) {
      if (!isMissing(error.message)) console.warn("[legal-learned] load failed:", error.message);
      return [];
    }
    return (data ?? []) as LearnedStatement[];
  } catch (e) {
    console.warn("[legal-learned] load failed:", e);
    return [];
  }
}

/** Sentence keys an attorney has approved (directly, or as their replacement text). */
export function approvedKeys(learned: readonly LearnedStatement[]): Set<string> {
  const keys = new Set<string>();
  for (const l of learned) {
    if (!l.enabled) continue;
    if (l.kind === "approved") keys.add(l.sentence_key);
    else if (l.replacement) keys.add(sentenceKey(l.replacement));
  }
  return keys;
}

async function save(row: Omit<LearnedStatement, "id" | "approved_at" | "enabled"> & { tenant_id: string }) {
  const { error } = await getSupabaseAdmin()
    .from("legal_learned_statements")
    .upsert(
      { ...row, approved_at: new Date().toISOString(), enabled: true },
      { onConflict: "tenant_id,kind,sentence_key" },
    );
  // Learning must never fail the decision it learns from.
  if (error && !isMissing(error.message)) console.warn("[legal-learned] save failed:", error.message);
}

export async function learnApproval(args: {
  tenantId: string;
  sentence: string;
  by: string;
  draftId?: string | null;
  rule?: string | null;
}): Promise<void> {
  const key = sentenceKey(args.sentence);
  if (key.length < 20) return;
  await save({
    tenant_id: args.tenantId,
    kind: "approved",
    sentence_key: key,
    sentence: args.sentence.trim(),
    replacement: null,
    approved_by_email: args.by,
    draft_id: args.draftId ?? null,
    finding_rule: args.rule ?? null,
  });
}

export async function learnCorrection(args: {
  tenantId: string;
  from: string;
  to: string;
  by: string;
  draftId?: string | null;
  rule?: string | null;
}): Promise<void> {
  const key = sentenceKey(args.from);
  if (key.length < 20 || !args.to.trim() || sentenceKey(args.to) === key) return;
  await save({
    tenant_id: args.tenantId,
    kind: "correction",
    sentence_key: key,
    sentence: args.from.trim(),
    replacement: args.to.trim(),
    approved_by_email: args.by,
    draft_id: args.draftId ?? null,
    finding_rule: args.rule ?? null,
  });
}

/** Attorney corrections in the form the fixer applies them. */
export function learnedCorrections(learned: readonly LearnedStatement[]) {
  return learned
    .filter((l) => l.enabled && l.kind === "correction" && l.replacement)
    .map((l) => ({ from: l.sentence, to: l.replacement!, by: l.approved_by_email, at: l.approved_at }));
}
