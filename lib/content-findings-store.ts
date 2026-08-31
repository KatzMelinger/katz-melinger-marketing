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
  type FindingStatus,
  type NormalizedFinding,
  type StoredFinding,
} from "./content-findings";

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
  const { draftId, tenantId, incoming } = args;
  const empty = {
    inserted: 0, reopened: 0, autoResolved: 0, touched: 0,
    insertedFindings: [] as NormalizedFinding[], reopenedFindings: [] as NormalizedFinding[],
  };
  const sb = getSupabaseAdmin();

  const existing = await listFindings(draftId);
  const plan = reconcileFindings(existing, incoming);
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

    for (const stale of plan.autoResolve) {
      await sb
        .from("content_findings")
        .update({
          status: "resolved",
          resolved_at: now,
          resolution_note: "Resolved automatically — the check no longer reports this.",
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
}): Promise<StoredFinding | null> {
  const sb = getSupabaseAdmin();
  const now = new Date().toISOString();
  const closing = args.status === "resolved" || args.status === "dismissed";

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
