/**
 * Rule history (Oct 6 spec, Task 24): every change to a brand constant, a trap
 * or a knowledge base entry is a row in rule_changes — who, when, the old
 * value, the new value — and any change with an old value can be restored.
 *
 * Brand constants and traps apply when saved. Knowledge base changes are
 * proposals: they wait as 'pending' until a reviewing attorney approves them
 * (Kenneth, 2026-10-06, decision D), and only then reach legal_knowledge_base.
 *
 * Service-role client throughout, so every query is scoped by tenant_id here.
 */
import { getSupabaseAdmin } from "./supabase-server";
import { clearKnowledgeBaseCache, resolveDates, todayNy } from "./legal-knowledge-base";

export type RuleKind = "brand" | "trap" | "kb";
export type RuleAction = "create" | "update" | "enable" | "disable" | "restore" | "verify";

export type RuleChange = {
  id: string;
  rule_kind: RuleKind;
  rule_ref: string;
  rule_label: string;
  action: RuleAction;
  old_value: unknown;
  new_value: unknown;
  status: "applied" | "pending" | "rejected";
  changed_by_email: string | null;
  changed_at: string;
  reviewer_email: string | null;
  decided_by_email: string | null;
  decided_at: string | null;
  decision_note: string | null;
  restored_from: string | null;
};

/** True when rule_changes has not been migrated yet (supabase/rule_changes_task24.sql). */
export function isMissingRuleTable(message: string | undefined): boolean {
  return !!message && /rule_changes|does not exist|schema cache/i.test(message);
}

export async function recordRuleChange(
  tenantId: string,
  c: {
    kind: RuleKind;
    ref: string;
    label: string;
    action: RuleAction;
    oldValue: unknown;
    newValue: unknown;
    by: string | null;
    status?: "applied" | "pending";
    reviewerEmail?: string | null;
    restoredFrom?: string | null;
  },
): Promise<RuleChange | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("rule_changes")
    .insert({
      tenant_id: tenantId,
      rule_kind: c.kind,
      rule_ref: c.ref,
      rule_label: c.label.slice(0, 300),
      action: c.action,
      old_value: c.oldValue ?? null,
      new_value: c.newValue ?? null,
      status: c.status ?? "applied",
      changed_by_email: c.by,
      reviewer_email: c.reviewerEmail ?? null,
      restored_from: c.restoredFrom ?? null,
    })
    .select()
    .maybeSingle();
  if (error) {
    // History must never block the save it describes; an unmigrated table is
    // reported once in the server log.
    console.warn("[rule-changes] could not record change:", error.message);
    return null;
  }
  return data as RuleChange;
}

export async function listRuleChanges(
  tenantId: string,
  opts: { kind?: RuleKind; ref?: string; status?: RuleChange["status"]; limit?: number } = {},
): Promise<RuleChange[]> {
  let q = getSupabaseAdmin()
    .from("rule_changes")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("changed_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.kind) q = q.eq("rule_kind", opts.kind);
  if (opts.ref) q = q.eq("rule_ref", opts.ref);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) {
    if (isMissingRuleTable(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as RuleChange[];
}

/* -------------------------------------------------------------------------- */
/* Knowledge base entries                                                      */
/* -------------------------------------------------------------------------- */

/** The editable columns of legal_knowledge_base, as stored. */
export type KbRow = {
  entry_type: "threshold" | "named_act";
  key: string;
  label: string;
  practice_area: string;
  jurisdiction: "federal" | "NY" | "NJ";
  region: string | null;
  unit: string | null;
  current_value: number | null;
  effective_date: string | null;
  prior_value: number | null;
  prior_effective_date: string | null;
  scheduled_value: number | null;
  scheduled_effective_date: string | null;
  match_keywords: string[];
  aliases: string[];
  canonical_citation: string | null;
  enforcement_path: string | null;
  source_url: string | null;
  notes: string | null;
  last_verified: string | null;
};

export const KB_COLUMNS =
  "entry_type, key, label, practice_area, jurisdiction, region, unit, current_value, effective_date, prior_value, prior_effective_date, scheduled_value, scheduled_effective_date, match_keywords, aliases, canonical_citation, enforcement_path, source_url, notes, last_verified";

export { todayNy };

export const KB_UNITS = ["usd_per_hour", "usd_per_week", "usd_per_year", "days", "years", "employees"] as const;

export function kbRef(r: Pick<KbRow, "entry_type" | "key">): string {
  return `${r.entry_type}:${r.key}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string") return v.split("\n").map((x) => x.trim()).filter(Boolean);
  return [];
}

/**
 * Turn the entry form into the row the change would store, given the row as it
 * is now (null for a new entry).
 *
 * The form has one "value" and one "effective date". Where they land depends
 * on the date, so Diana never has to know about prior or scheduled columns:
 *   - a date in the future, on an entry that already has a current value:
 *     it becomes the scheduled value, and today's figure stays in force until
 *     that date ("NJ minimum wage $16.48, effective January 1, 2027");
 *   - a date today or earlier, with a different value: the old current value
 *     becomes the prior value, so a sentence that dates the old figure
 *     correctly is still recognised as right.
 */
export function kbProposal(
  form: Record<string, unknown>,
  existing: KbRow | null,
  today = todayNy(),
): { row: KbRow } | { error: string } {
  const entryType = form.entry_type === "named_act" ? "named_act" : "threshold";
  const key = (str(form.key) ?? "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_|_$/g, "");
  const label = str(form.label);
  const jurisdiction = ["federal", "NY", "NJ"].includes(String(form.jurisdiction)) ? (form.jurisdiction as KbRow["jurisdiction"]) : null;
  if (!key) return { error: "Key is required (for example nj_min_wage)." };
  if (!label) return { error: "Label is required." };
  if (!jurisdiction) return { error: "Jurisdiction must be federal, NY or NJ." };
  const sourceUrl = str(form.source_url);
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) return { error: "Source URL is required: the primary source this rule comes from." };
  const effective = str(form.effective_date);
  if (effective && !DATE_RE.test(effective)) return { error: "Effective date must be YYYY-MM-DD." };

  const base: KbRow = {
    entry_type: entryType,
    key,
    label,
    practice_area: str(form.practice_area) ?? existing?.practice_area ?? "employment",
    jurisdiction,
    region: str(form.region),
    unit: null,
    current_value: null,
    effective_date: null,
    prior_value: existing?.prior_value ?? null,
    prior_effective_date: existing?.prior_effective_date ?? null,
    scheduled_value: existing?.scheduled_value ?? null,
    scheduled_effective_date: existing?.scheduled_effective_date ?? null,
    match_keywords: list(form.match_keywords),
    aliases: list(form.aliases),
    canonical_citation: str(form.canonical_citation),
    enforcement_path: str(form.enforcement_path),
    source_url: sourceUrl,
    notes: str(form.notes),
    last_verified: today,
  };

  if (entryType === "named_act") {
    return { row: { ...base, prior_value: null, prior_effective_date: null, scheduled_value: null, scheduled_effective_date: null } };
  }

  const unit = KB_UNITS.includes(form.unit as (typeof KB_UNITS)[number]) ? String(form.unit) : null;
  if (!unit) return { error: "Unit is required for a threshold." };
  const value = num(form.value);
  if (value === null) return { error: "Value is required for a threshold." };
  base.unit = unit;

  const future = !!effective && effective > today;
  if (existing && existing.current_value !== null && future) {
    // Scheduled: today's figure stays until the date.
    return {
      row: {
        ...base,
        current_value: existing.current_value,
        effective_date: existing.effective_date,
        scheduled_value: value,
        scheduled_effective_date: effective,
      },
    };
  }
  // A new entry dated in the future is stored as current with that date; the
  // loader (lib/legal-knowledge-base.ts) holds it back until the date.
  const changed = existing?.current_value != null && existing.current_value !== value;
  // A scheduled value this edit overtakes (same date or earlier) is dropped.
  const overtaken =
    !!existing?.scheduled_effective_date && !!effective && existing.scheduled_effective_date <= effective;
  return {
    row: {
      ...base,
      current_value: value,
      effective_date: effective,
      prior_value: changed ? existing!.current_value : base.prior_value,
      prior_effective_date: changed ? existing!.effective_date : base.prior_effective_date,
      scheduled_value: overtaken ? null : base.scheduled_value,
      scheduled_effective_date: overtaken ? null : base.scheduled_effective_date,
    },
  };
}

/**
 * The row as it stands today: a scheduled figure whose date has passed is
 * current, and a current figure dated in the future (how the 2027 NJ minimum
 * wage was first loaded) is shown as upcoming, with the prior figure current.
 * The form and the history then show what drafts are actually checked against.
 */
export function asOfToday(r: KbRow, today = todayNy()): KbRow {
  if (r.entry_type !== "threshold" || r.current_value == null) return r;
  // Nothing earlier to show as current: leave a future-dated entry as it is.
  if (r.effective_date && r.effective_date > today && r.prior_value == null) return r;
  return resolveDates({ ...r, current_value: r.current_value }, today) ?? r;
}

export async function loadKbRows(tenantId: string): Promise<KbRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("legal_knowledge_base")
    .select(KB_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("jurisdiction")
    .order("label");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as KbRow[]).map((r) => asOfToday(r));
}

export async function loadKbRow(tenantId: string, entryType: string, key: string): Promise<KbRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("legal_knowledge_base")
    .select(KB_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("entry_type", entryType)
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? asOfToday(data as unknown as KbRow) : null;
}

/** Write an approved knowledge base row. Bumps the version and drops the read cache. */
export async function applyKbRow(tenantId: string, row: KbRow, approvedBy: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const { data: current } = await sb
    .from("legal_knowledge_base")
    .select("version")
    .eq("tenant_id", tenantId)
    .eq("entry_type", row.entry_type)
    .eq("key", row.key)
    .maybeSingle();
  const { error } = await sb.from("legal_knowledge_base").upsert(
    {
      tenant_id: tenantId,
      ...row,
      version: ((current?.version as number | undefined) ?? 0) + 1,
      updated_by: approvedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,entry_type,key" },
  );
  if (error) throw new Error(error.message);
  clearKnowledgeBaseCache();
}

/** Older than 12 months, or never recorded: the entry shows "Verify". */
export function needsVerify(lastVerified: string | null, today = todayNy()): boolean {
  if (!lastVerified) return true;
  const [y, m, d] = today.split("-").map(Number);
  const cutoff = `${y - 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return lastVerified < cutoff;
}
