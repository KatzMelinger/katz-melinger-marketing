/**
 * Persistence for tracked findings and the audit log.
 *
 * The reconciliation rules live in lib/content-findings.ts (pure, testable);
 * this module is only the database half. Both are best-effort by design: a
 * findings-table failure must never take down the analysis that produced them,
 * because the analysis is the thing the user asked for.
 *
 * Everything degrades if the migration has not been run — the caller gets an
 * empty list and a logged warning rather than an error, matching how the
 * analyzer already handles unmigrated columns.
 */

import { getSupabaseAdmin } from "./supabase-server";
import {
  reconcileFindings,
  type FindingResolution,
  type FindingSource,
  type FindingStatus,
  type NormalizedFinding,
  type StoredFinding,
} from "./content-findings";
import { quoteStillPresent, STALE_NOTE } from "./finding-currency";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = Record<string, any>;

function rowToFinding(r: Row): StoredFinding {
  return {
    id: r.id,
    draftId: r.draft_id,
    fingerprint: r.fingerprint,
    source: r.source,
    ruleId: r.rule_id ?? null,
    severity: r.severity,
    title: r.title,
    detail: r.detail ?? null,
    excerpt: r.excerpt ?? null,
    fix: r.fix ?? null,
    status: r.status,
    // Legal-layer fields. Null on every finding the other checks produce,
    // and null on legal findings written before the migration.
    claimType: r.claim_type ?? null,
    sourceChecked: r.source_checked ?? null,
    jurisdiction: r.jurisdiction ?? null,
    resolution: r.resolution ?? null,
    resolvedByEmail: r.resolved_by_email ?? null,
    resolvedAt: r.resolved_at ?? null,
    resolutionNote: r.resolution_note ?? null,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
  };
}

/** True when the error means "this table hasn't been migrated yet". */
function isMissingTable(message: string | undefined): boolean {
  return !!message && /content_findings|content_audit_log|does not exist|schema cache/i.test(message);
}

export async function listFindings(draftId: string): Promise<StoredFinding[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("content_findings")
    .select("*")
    .eq("draft_id", draftId)
    .order("severity", { ascending: true })
    .order("first_seen_at", { ascending: true });
  if (error) {
    if (!isMissingTable(error.message)) {
      console.warn("[findings] list failed:", error.message);
    }
    return [];
  }
  return (data ?? []).map(rowToFinding);
}

/**
 * Open critical findings per draft, for the gates that must refuse a draft
 * with one (approve, the WordPress pull, certification).
 *
 * Returns `null` when the read FAILED — callers must treat that as "blocked",
 * never as "none": a gate that could not look is not a clean bill of health.
 * An unmigrated table returns an empty map (nothing can be open in it).
 */
export async function openCriticalFindings(
  draftIds: readonly string[],
): Promise<Map<string, StoredFinding[]> | null> {
  const out = new Map<string, StoredFinding[]>();
  if (draftIds.length === 0) return out;
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("content_findings")
    .select("*")
    .in("draft_id", draftIds as string[])
    .eq("severity", "critical")
    .in("status", ["open", "in_progress"])
    .range(0, 4999);
  if (error) {
    if (isMissingTable(error.message)) return out;
    console.warn("[findings] open-critical read failed:", error.message);
    return null;
  }
  for (const r of data ?? []) {
    const f = rowToFinding(r as Row);
    const list = out.get(f.draftId) ?? [];
    list.push(f);
    out.set(f.draftId, list);
  }
  // A blocker quoting text that is no longer in the draft is closed, not
  // obeyed (Oct 6 spec, Task 21). If the bodies cannot be read, the gate keeps
  // every blocker: refusing on a stale finding is safer than passing on a
  // live one.
  if (out.size > 0) {
    const { data: drafts, error: dErr } = await sb
      .from("content_drafts")
      .select("id, tenant_id, body")
      .in("id", [...out.keys()]);
    if (!dErr) {
      for (const d of drafts ?? []) {
        const r = await closeStaleFindings({
          draftId: d.id as string,
          tenantId: d.tenant_id as string,
          body: typeof d.body === "string" ? d.body : "",
          findings: out.get(d.id as string) ?? [],
        });
        if (r.open.length) out.set(d.id as string, r.open);
        else out.delete(d.id as string);
      }
    }
  }
  return out;
}

/**
 * Sync a fresh set of findings onto a draft.
 *
 * Called after every analysis. Existing rows keep their id and their status;
 * see reconcileFindings for exactly what happens to each case and why. Returns
 * a summary so the caller can log what a re-run actually changed.
 */
export async function syncFindings(args: {
  draftId: string;
  tenantId: string;
  incoming: NormalizedFinding[];
  /**
   * Which engines this run recomputed. Auto-resolution is limited to these,
   * so a partial run (the approval gate, which produces only legal findings)
   * cannot close findings no engine in this run looked for. Omit only from a
   * full analysis pass. See reconcileFindings.
   */
  sources?: readonly FindingSource[];
}): Promise<{
  inserted: number;
  reopened: number;
  autoResolved: number;
  touched: number;
  /** The findings actually inserted — what a notification should be about. */
  insertedFindings: NormalizedFinding[];
  /** Re-opened findings: previously marked fixed, still reported. Also news. */
  reopenedFindings: NormalizedFinding[];
}> {
  const { draftId, tenantId, incoming, sources } = args;
  const empty = {
    inserted: 0, reopened: 0, autoResolved: 0, touched: 0,
    insertedFindings: [] as NormalizedFinding[], reopenedFindings: [] as NormalizedFinding[],
  };
  const sb = getSupabaseAdmin();

  const existing = await listFindings(draftId);
  const plan = reconcileFindings(existing, incoming, sources ? { sources } : undefined);
  const now = new Date().toISOString();

  try {
    if (plan.insert.length > 0) {
      const { error } = await sb.from("content_findings").insert(
        plan.insert.map((f) => ({
          tenant_id: tenantId,
          draft_id: draftId,
          fingerprint: f.fingerprint,
          source: f.source,
          rule_id: f.ruleId,
          severity: f.severity,
          title: f.title,
          detail: f.detail,
          excerpt: f.excerpt,
          fix: f.fix,
          status: "open",
          // Legal-layer columns; undefined on every other source, which
          // Postgres stores as NULL — the correct value for them.
          claim_type: f.claimType ?? null,
          source_checked: f.sourceChecked ?? null,
          jurisdiction: f.jurisdiction ?? null,
          first_seen_at: now,
          last_seen_at: now,
        })),
      );
      if (error) {
        if (isMissingTable(error.message)) return empty;
        console.warn("[findings] insert failed:", error.message);
      }
    }

    // Wording can change between runs (a rule description edit, a longer
    // excerpt) while the fingerprint holds. Refresh the text so the drawer
    // never shows a stale phrasing of a live finding.
    for (const { id, finding } of plan.touch) {
      await sb
        .from("content_findings")
        .update({
          last_seen_at: now,
          severity: finding.severity,
          title: finding.title,
          detail: finding.detail,
          fix: finding.fix,
          updated_at: now,
        })
        .eq("id", id);
    }

    for (const { id, finding } of plan.reopen) {
      await sb
        .from("content_findings")
        .update({
          status: "open",
          severity: finding.severity,
          title: finding.title,
          last_seen_at: now,
          resolved_by: null,
          resolved_by_email: null,
          resolved_at: null,
          resolution_note: "Re-opened: the check still reports this after it was marked resolved.",
          updated_at: now,
        })
        .eq("id", id);
    }

    // resolved_by_edit, not resolved: a check only falls silent when the text
    // it was pointing at changed, so this is the one closure that is evidence
    // of an actual fix rather than a decision someone made (item 12).
    for (const stale of plan.autoResolve) {
      await sb
        .from("content_findings")
        .update({
          status: "resolved_by_edit",
          resolved_at: now,
          resolution: "fixed",
          resolution_note: "The content changed and the check no longer reports this.",
          updated_at: now,
        })
        .eq("id", stale.id);
    }
  } catch (e) {
    console.warn("[findings] sync failed:", e);
    return empty;
  }

  return {
    inserted: plan.insert.length,
    reopened: plan.reopen.length,
    autoResolved: plan.autoResolve.length,
    touched: plan.touch.length,
    insertedFindings: plan.insert,
    reopenedFindings: plan.reopen.map((r) => r.finding),
  };
}

/** Move one finding, recording who did it. Returns the updated row. */
export async function setFindingStatus(args: {
  findingId: string;
  tenantId: string;
  status: FindingStatus;
  userId: string;
  userEmail: string;
  note?: string;
  /**
   * What the reviewer actually did — fixed, approved_as_is, or removed.
   *
   * The column has existed since the legal-findings migration and nothing ever
   * wrote it, which made "how often is a flag approved as-is" a question with
   * no answer. That number is the one that says whether the checker is too
   * noisy, so a schema that records it and code that does not is worse than
   * useless: it looks like the data is there.
   */
  resolution?: FindingResolution;
}): Promise<StoredFinding | null> {
  const sb = getSupabaseAdmin();
  const now = new Date().toISOString();
  const closing =
    args.status === "resolved" ||
    args.status === "resolved_by_edit" ||
    args.status === "dismissed";

  const { data, error } = await sb
    .from("content_findings")
    .update({
      status: args.status,
      // Re-opening clears the attribution: the previous resolution is no longer
      // a live claim, and leaving a name on it would misattribute the state.
      resolved_by: closing ? args.userId : null,
      resolved_by_email: closing ? args.userEmail : null,
      resolved_at: closing ? now : null,
      resolution_note: args.note ?? null,
      // Cleared on re-open for the same reason as the attribution: a finding
      // that is open again was not "fixed".
      resolution: closing ? (args.resolution ?? null) : null,
      updated_at: now,
    })
    .eq("id", args.findingId)
    .eq("tenant_id", args.tenantId)
    .select()
    .maybeSingle();

  if (error) {
    console.warn("[findings] status update failed:", error.message);
    return null;
  }
  return data ? rowToFinding(data as Row) : null;
}

/**
 * Close every open finding whose quoted text is no longer in `body` (Oct 6
 * spec, Task 21; see lib/finding-currency.ts). Returns the findings that are
 * still open, so a caller can display or gate on them directly.
 *
 * Status `resolved_by_edit` with resolution `fixed`: the same state the
 * reconciler gives a finding whose check fell silent, so if the text comes
 * back the next analysis reopens it as usual.
 */
export async function closeStaleFindings(args: {
  draftId: string;
  tenantId: string;
  body: string;
  findings?: StoredFinding[];
}): Promise<{ open: StoredFinding[]; closed: StoredFinding[] }> {
  const all = args.findings ?? (await listFindings(args.draftId));
  const isOpen = (f: StoredFinding) => f.status === "open" || f.status === "in_progress";
  const stale = all.filter((f) => isOpen(f) && quoteStillPresent(f, args.body) === false);
  if (stale.length > 0) {
    const now = new Date().toISOString();
    const { error } = await getSupabaseAdmin()
      .from("content_findings")
      .update({
        status: "resolved_by_edit",
        resolution: "fixed",
        resolution_note: STALE_NOTE,
        resolved_at: now,
        updated_at: now,
      })
      .in("id", stale.map((f) => f.id))
      .eq("tenant_id", args.tenantId);
    if (error) {
      // Could not close them: report them as still open rather than hide a
      // blocker the database still holds.
      console.warn("[findings] stale close failed:", error.message);
      return { open: all.filter(isOpen), closed: [] };
    }
    await recordAuditEvent({
      tenantId: args.tenantId,
      draftId: args.draftId,
      event: "findings_closed_stale",
      detail: { count: stale.length, rules: [...new Set(stale.map((f) => f.ruleId))].slice(0, 20) },
    });
  }
  const closedIds = new Set(stale.map((f) => f.id));
  return { open: all.filter((f) => isOpen(f) && !closedIds.has(f.id)), closed: stale };
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/**
 * Append one event. Never throws and never blocks the caller — an audit write
 * failing must not fail an approval, but it is logged loudly, because an audit
 * log with silent gaps is worse than none: it looks complete.
 */
export async function recordAuditEvent(args: {
  tenantId: string;
  draftId?: string | null;
  event: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb.from("content_audit_log").insert({
      tenant_id: args.tenantId,
      draft_id: args.draftId ?? null,
      event: args.event,
      actor_user_id: args.actorUserId ?? null,
      actor_email: args.actorEmail ?? null,
      detail: args.detail ?? {},
    });
    if (error && !isMissingTable(error.message)) {
      console.warn(`[audit] failed to record "${args.event}":`, error.message);
    }
  } catch (e) {
    console.warn(`[audit] failed to record "${args.event}":`, e);
  }
}

export async function listAuditEvents(draftId: string, limit = 50) {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("content_audit_log")
    .select("*")
    .eq("draft_id", draftId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (!isMissingTable(error.message)) console.warn("[audit] list failed:", error.message);
    return [];
  }
  return data ?? [];
}
