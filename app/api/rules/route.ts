/**
 * Rules without code (Oct 6 spec, Task 24).
 *
 * GET  /api/rules
 *        → { kb, history, pending, missing, brief, learned, canApprove, today }
 *          learned: what attorneys approved or corrected (lib/legal-learned.ts)
 *          kb: knowledge base entries, each with needsVerify (12 months)
 *          history: the latest rule changes (brand, trap, kb)
 *          missing: claims in open drafts that no rule covers yet
 * POST /api/rules
 *        { action: "propose_kb", entry }   a new or changed knowledge base
 *            entry. Stored as pending; applies only when an attorney approves
 *            (Kenneth, 2026-10-06, decision D). The reviewing attorney is
 *            emailed.
 *        { action: "approve", id } / { action: "reject", id, note? }
 *            attorneys only (lib/legal-reviewers canClearLegalHold).
 *        { action: "restore", id }  put a change's old value back. Brand
 *            constants and traps apply at once; a knowledge base restore is a
 *            new pending proposal.
 *        { action: "verify", entryType, key }  attorneys only: the entry was
 *            checked against its source today.
 *        { action: "toggle_learned", id, enabled }  attorneys only: switch a
 *            learned approval or correction off or on.
 */
import { after, NextRequest, NextResponse } from "next/server";
import { openRefreshDrafts } from "@/lib/live-page-scan";

import { writeBrandSetting } from "@/lib/brand-settings";
import { canClearLegalHold, reviewerFor } from "@/lib/legal-reviewers";
import { sendEmails } from "@/lib/notify-shared";
import { getOperatingBrief } from "@/lib/social-operating-brief";
import { loadLearned } from "@/lib/legal-learned";
import {
  applyKbRow,
  isMissingRuleTable,
  kbProposal,
  kbRef,
  listRuleChanges,
  loadKbRow,
  loadKbRows,
  needsVerify,
  recordRuleChange,
  todayNy,
  type KbRow,
  type RuleChange,
} from "@/lib/rule-changes";
import { getCurrentUser } from "@/lib/supabase-route";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPEN_DRAFT_EXCLUDED = ["archived", "published"];

/** Sentences in open drafts that state a legal claim no rule covers (Task 23's
 *  "Missing rules"): open legal findings the classifier left unclassified. */
async function missingRules(tenantId: string) {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("content_findings")
    .select("draft_id, excerpt, content_drafts!inner(title, status)")
    .eq("tenant_id", tenantId)
    .eq("source", "legal")
    .eq("claim_type", "unclassified")
    .in("status", ["open", "in_progress"])
    .not("content_drafts.status", "in", `(${OPEN_DRAFT_EXCLUDED.join(",")})`)
    .limit(500);
  if (error) {
    console.warn("[rules] missing rules:", error.message);
    return [];
  }
  const bySentence = new Map<string, { sentence: string; drafts: { id: string; title: string }[] }>();
  for (const r of data ?? []) {
    const sentence = ((r.excerpt as string | null) ?? "").trim();
    if (!sentence) continue;
    const d = r.content_drafts as unknown as { title: string | null } | null;
    const item = bySentence.get(sentence) ?? { sentence, drafts: [] };
    if (!item.drafts.some((x) => x.id === r.draft_id)) {
      item.drafts.push({ id: r.draft_id as string, title: d?.title?.trim() || "Untitled" });
    }
    bySentence.set(sentence, item);
  }
  return [...bySentence.values()].sort((a, b) => b.drafts.length - a.drafts.length);
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}

function describe(row: KbRow | null): string {
  if (!row) return "(none)";
  if (row.entry_type === "named_act") return `${row.label}${row.canonical_citation ? `, ${row.canonical_citation}` : ""}`;
  const parts = [`${row.current_value} ${row.unit}`, row.effective_date ? `effective ${row.effective_date}` : null];
  if (row.scheduled_value != null) parts.push(`then ${row.scheduled_value} from ${row.scheduled_effective_date}`);
  return parts.filter(Boolean).join(", ");
}

async function propose(tenantId: string, row: KbRow, old: KbRow | null, by: string, restoredFrom?: string) {
  const reviewer = reviewerFor({ practiceArea: row.practice_area });
  const change = await recordRuleChange(tenantId, {
    kind: "kb",
    ref: kbRef(row),
    label: row.label,
    action: restoredFrom ? "restore" : old ? "update" : "create",
    oldValue: old,
    newValue: row,
    by,
    status: "pending",
    reviewerEmail: reviewer?.email ?? null,
    restoredFrom: restoredFrom ?? null,
  });
  if (!change) throw new Error("Could not save the proposal. Has supabase/rule_changes_task24.sql been run?");
  if (reviewer?.email) {
    await sendEmails(
      [reviewer.email],
      `Knowledge base change to approve: ${row.label}`,
      [
        `${by} proposed a change to the knowledge base entry "${row.label}".`,
        ``,
        `Now:      ${describe(old)}`,
        `Proposed: ${describe(row)}`,
        `Source:   ${row.source_url ?? "(none)"}`,
        ``,
        `It applies to drafts only after an attorney approves it:`,
        `${appBaseUrl()}/content/rules`,
      ].join("\n"),
    ).catch(() => 0);
  }
  return change;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const tenantId = await resolveTenantId();
  try {
    const [kbRows, history, missing, brief, learned] = await Promise.all([
      loadKbRows(tenantId),
      listRuleChanges(tenantId, { limit: 300 }),
      missingRules(tenantId),
      getOperatingBrief(tenantId),
      loadLearned(tenantId, { includeDisabled: true }),
    ]);
    const today = todayNy();
    return NextResponse.json({
      today,
      kb: kbRows.map((r) => ({ ...r, needsVerify: needsVerify(r.last_verified, today) })),
      history,
      pending: history.filter((h) => h.status === "pending"),
      missing,
      brief,
      learned,
      canApprove: canClearLegalHold(user.email),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const tenantId = await resolveTenantId();
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const sb = getSupabaseAdmin();

  const loadChange = async (): Promise<RuleChange | null> => {
    if (typeof b.id !== "string") return null;
    const { data, error } = await sb.from("rule_changes").select("*").eq("tenant_id", tenantId).eq("id", b.id).maybeSingle();
    if (error && !isMissingRuleTable(error.message)) throw new Error(error.message);
    return (data as RuleChange | null) ?? null;
  };

  try {
    switch (b.action) {
      case "propose_kb": {
        const entry = (b.entry ?? {}) as Record<string, unknown>;
        const entryType = entry.entry_type === "named_act" ? "named_act" : "threshold";
        const keyNow = typeof entry.original_key === "string" && entry.original_key ? entry.original_key : String(entry.key ?? "");
        const existing = keyNow ? await loadKbRow(tenantId, entryType, keyNow) : null;
        const parsed = kbProposal(entry, existing);
        if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
        if (!existing && (await loadKbRow(tenantId, entryType, parsed.row.key))) {
          return NextResponse.json({ error: `An entry with the key ${parsed.row.key} already exists. Edit it instead.` }, { status: 409 });
        }
        if (existing && existing.key !== parsed.row.key) {
          return NextResponse.json({ error: "The key of an existing entry cannot change." }, { status: 400 });
        }
        const change = await propose(tenantId, parsed.row, existing, user.email);
        return NextResponse.json({ change });
      }

      case "approve":
      case "reject": {
        if (!canClearLegalHold(user.email)) {
          return NextResponse.json({ error: "Only a reviewing attorney can approve knowledge base changes." }, { status: 403 });
        }
        const change = await loadChange();
        if (!change || change.rule_kind !== "kb" || change.status !== "pending") {
          return NextResponse.json({ error: "No pending knowledge base change with that id." }, { status: 404 });
        }
        if (b.action === "approve") {
          const row = change.new_value as KbRow;
          // The entry must still be what the proposal was made against.
          const now = await loadKbRow(tenantId, row.entry_type, row.key);
          const old = change.old_value as KbRow | null;
          if (describe(now) !== describe(old)) {
            return NextResponse.json(
              { error: "This entry changed after the proposal was made. Reject it and propose again." },
              { status: 409 },
            );
          }
          await applyKbRow(tenantId, row, user.email);
          // Oct 20 spec, Task A15: every live page citing the entry gets a refresh draft.
          const origin = new URL(req.url).origin;
          after(() =>
            openRefreshDrafts({
              tenantId,
              kbKey: row.key,
              reason: `change:${change.id}`,
              origin,
              note: `Knowledge base entry "${row.label}" changed, approved by ${user.email} (Task A15). Correct this page to the new entry.`,
            }).catch((e) => console.warn("[rules] refresh drafts failed:", e)),
          );
        }
        const { error } = await sb
          .from("rule_changes")
          .update({
            status: b.action === "approve" ? "applied" : "rejected",
            decided_by_email: user.email,
            decided_at: new Date().toISOString(),
            decision_note: typeof b.note === "string" && b.note.trim() ? b.note.trim() : null,
          })
          .eq("tenant_id", tenantId)
          .eq("id", change.id);
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }

      case "restore": {
        const change = await loadChange();
        if (!change) return NextResponse.json({ error: "No change with that id." }, { status: 404 });
        if (change.action === "verify" || change.old_value === null || change.old_value === undefined) {
          return NextResponse.json({ error: "This change has no earlier value to restore." }, { status: 400 });
        }
        if (change.rule_kind === "brand") {
          const now = (await sb.from("brand_voice_settings").select("value").eq("tenant_id", tenantId).eq("key", change.rule_ref).maybeSingle()).data;
          await writeBrandSetting(tenantId, change.rule_ref, String(change.old_value));
          await recordRuleChange(tenantId, {
            kind: "brand", ref: change.rule_ref, label: change.rule_label, action: "restore",
            oldValue: (now?.value as string | undefined) ?? null, newValue: change.old_value, by: user.email, restoredFrom: change.id,
          });
          return NextResponse.json({ ok: true });
        }
        if (change.rule_kind === "trap") {
          const old = change.old_value as Record<string, unknown>;
          const { data: now } = await sb.from("content_known_traps").select("*").eq("tenant_id", tenantId).eq("id", change.rule_ref).maybeSingle();
          // Everything but identity and timestamps goes back.
          const { id: _id, tenant_id: _t, created_at: _c, ...fields } = old;
          void _id; void _t; void _c;
          const { data, error } = await sb
            .from("content_known_traps")
            .update({ ...fields, updated_at: new Date().toISOString() })
            .eq("tenant_id", tenantId)
            .eq("id", change.rule_ref)
            .select()
            .maybeSingle();
          if (error) throw new Error(error.message);
          if (!data) return NextResponse.json({ error: "That trap no longer exists." }, { status: 404 });
          await recordRuleChange(tenantId, {
            kind: "trap", ref: change.rule_ref, label: String(data.label), action: "restore",
            oldValue: now, newValue: data, by: user.email, restoredFrom: change.id,
          });
          return NextResponse.json({ ok: true });
        }
        const old = change.old_value as KbRow;
        const now = await loadKbRow(tenantId, old.entry_type, old.key);
        const proposal = await propose(tenantId, { ...old, last_verified: todayNy() }, now, user.email, change.id);
        return NextResponse.json({ change: proposal, pending: true });
      }

      case "verify": {
        if (!canClearLegalHold(user.email)) {
          return NextResponse.json({ error: "Only a reviewing attorney can mark an entry verified." }, { status: 403 });
        }
        const row = await loadKbRow(tenantId, String(b.entryType ?? ""), String(b.key ?? ""));
        if (!row) return NextResponse.json({ error: "No such entry." }, { status: 404 });
        const today = todayNy();
        const { error } = await sb
          .from("legal_knowledge_base")
          .update({ last_verified: today })
          .eq("tenant_id", tenantId)
          .eq("entry_type", row.entry_type)
          .eq("key", row.key);
        if (error) throw new Error(error.message);
        await recordRuleChange(tenantId, {
          kind: "kb", ref: kbRef(row), label: row.label, action: "verify",
          oldValue: { last_verified: row.last_verified }, newValue: { last_verified: today }, by: user.email,
        });
        return NextResponse.json({ ok: true });
      }

      case "toggle_learned": {
        if (!canClearLegalHold(user.email)) {
          return NextResponse.json({ error: "Only a reviewing attorney can change a learned decision." }, { status: 403 });
        }
        if (typeof b.id !== "string") return NextResponse.json({ error: "id required" }, { status: 400 });
        const { error } = await sb
          .from("legal_learned_statements")
          .update({ enabled: b.enabled !== false })
          .eq("tenant_id", tenantId)
          .eq("id", b.id);
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
