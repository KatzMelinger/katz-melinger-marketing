/**
 * POST /api/content/drafts/[id]/legal-fix
 *
 *   { findingId, action: "preview" }                         -> { sentence, proposed, rejected[] }
 *   { findingId, action: "apply", proposed, byAttorney? }    -> { ok, change }
 *   { findingId, action: "send_to_attorney", reason? }       -> { ok, reviewer }
 *
 * Diana's Oct 6 spec, Task 22: every legal flag has an action. Apply fix
 * rewrites only the quoted sentence, refuses any rewrite that trips another
 * rule (the finding then belongs to an attorney), and logs the change in
 * "Changes made" with undo — so Approve still waits for the log to be marked
 * Reviewed. Send to attorney moves the draft to the Legal Review queue for the
 * practice-area attorney (Kenneth, 2026-10-07), who can approve the sentence
 * as is or type a replacement (byAttorney: applied even if a rule objects,
 * since the attorney decides; the objections are logged with it).
 */
import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/supabase-route";
import { getTenantClient } from "@/lib/tenant-db";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { recordAuditEvent, setFindingStatus } from "@/lib/content-findings-store";
import { loadEnabledTraps } from "@/lib/trap-gate";
import { guardSentence, locateSentence, proposeFix } from "@/lib/legal-sentence-fix";
import { appendRun, changeId, readFixLog, whereIs, type FixChange } from "@/lib/legal-fix-log";
import { clearTextCertifications } from "@/lib/draft-certifications";
import { canClearLegalHold, reviewerFor } from "@/lib/legal-reviewers";
import { scheduleDraftAnalysis } from "@/lib/auto-analyze";
import { hasWebPage } from "@/lib/draft-metadata";

export const runtime = "nodejs";
export const maxDuration = 120;

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as {
    findingId?: unknown;
    action?: unknown;
    proposed?: unknown;
    byAttorney?: unknown;
    reason?: unknown;
  };
  const findingId = typeof b.findingId === "string" ? b.findingId : "";
  const action = String(b.action ?? "");
  if (!findingId || !["preview", "apply", "send_to_attorney"].includes(action)) {
    return NextResponse.json({ error: "findingId and a valid action are required" }, { status: 400 });
  }

  // Ownership through the RLS-scoped client; writes through the admin client
  // scoped by tenant, the same split as the other draft routes.
  const { supabase, tenantId } = await getTenantClient();
  const { data: draft } = await supabase
    .from("content_drafts")
    .select("id, title, topic, body, format, status, practice_area, metadata, seo_brief, template")
    .eq("id", id)
    .maybeSingle();
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  const sb = getSupabaseAdmin();
  const { data: finding } = await sb
    .from("content_findings")
    .select("id, rule_id, source, severity, title, detail, excerpt, fix, status")
    .eq("id", findingId)
    .eq("draft_id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!finding) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const body = typeof draft.body === "string" ? draft.body : "";
  const actor = { id: user.id, email: user.email ?? "" };

  if (action === "send_to_attorney") {
    const reviewer = reviewerFor({
      practiceArea: draft.practice_area as string | null,
      topic: draft.topic as string | null,
      title: draft.title as string | null,
    });
    const name = reviewer?.name ?? "the reviewing attorney";
    const reason = typeof b.reason === "string" && b.reason.trim() ? b.reason.trim() : null;
    await setFindingStatus({
      findingId,
      tenantId,
      status: "in_progress",
      userId: actor.id,
      userEmail: actor.email,
      note: `Sent to ${name} by ${actor.email}${reason ? `: ${reason}` : ""}`,
    });
    if (draft.status !== "needs_legal") {
      await sb.from("content_drafts").update({ status: "needs_legal" }).eq("id", id).eq("tenant_id", tenantId);
      await sb.from("content_pipeline").update({ status: "needs_legal" }).eq("draft_id", id);
    }
    await recordAuditEvent({
      tenantId,
      draftId: id,
      event: "legal_sent_to_attorney",
      actorUserId: actor.id,
      actorEmail: actor.email,
      detail: { findingId, rule: finding.rule_id, reviewer: name, reason },
    });
    return NextResponse.json({ ok: true, reviewer: name });
  }

  const located = finding.excerpt ? locateSentence(body, finding.excerpt as string) : null;
  if (!located) {
    return NextResponse.json(
      {
        error:
          "This flag does not point at one sentence (it quotes several, or text that changed). Edit the passage by hand or send it to the attorney.",
      },
      { status: 409 },
    );
  }

  let proposed = typeof b.proposed === "string" ? b.proposed.trim() : "";
  if (action === "preview" && !proposed) {
    try {
      proposed =
        (await proposeFix({
          sentence: located.text,
          title: finding.title as string,
          note: (finding.detail as string | null) ?? null,
          fix: (finding.fix as string | null) ?? null,
        })) ?? "";
    } catch (e) {
      console.warn("[legal-fix] model call failed:", e);
      return NextResponse.json({ error: "The automatic rewrite is unavailable. Send this flag to the attorney." }, { status: 502 });
    }
    if (!proposed) {
      return NextResponse.json({
        sentence: located.text,
        proposed: null,
        rejected: ["No correction can be written without inventing a fact. Send this flag to the attorney."],
      });
    }
  }
  if (!proposed) return NextResponse.json({ error: "proposed is required" }, { status: 400 });

  const newBody = body.slice(0, located.start) + proposed + body.slice(located.start + located.text.length);
  const meta = (draft.metadata as Record<string, any> | null) ?? {};
  const traps = await loadEnabledTraps(tenantId);
  const rejected = await guardSentence({
    newSentence: proposed,
    newBody,
    traps: traps.traps,
    ctx: {
      title: draft.title as string | null,
      topic: draft.topic as string | null,
      primaryKeyword: String(meta.primaryKeyword ?? meta.km_brief?.primaryKeyword ?? ""),
      isWebPage: hasWebPage((draft.format as string | null) ?? "blog"),
    },
    tenantId,
  });

  if (action === "preview") {
    return NextResponse.json({ sentence: located.text, proposed, rejected });
  }

  // apply
  const byAttorney = b.byAttorney === true;
  if (byAttorney && !canClearLegalHold(actor.email)) {
    return NextResponse.json({ error: "Only a reviewing attorney can replace a sentence over a rule's objection." }, { status: 403 });
  }
  if (rejected.length && !byAttorney) {
    return NextResponse.json(
      { error: "The corrected sentence trips another rule, so it was not applied. Send this flag to the attorney.", rejected },
      { status: 422 },
    );
  }

  const change: FixChange = {
    id: changeId(),
    where: whereIs(body, located.start),
    from: located.text,
    to: proposed,
    reason: byAttorney
      ? `Replaced by ${actor.email} (attorney) for: ${finding.title}${rejected.length ? ` (rules still objecting: ${rejected.join("; ")})` : ""}`
      : `${finding.title}`,
    source: (finding.rule_id as string | null)?.startsWith("trap:") || finding.source === "legal" ? "knowledge base" : "brand rule",
    source_ref: (finding.rule_id as string | null) ?? undefined,
    anchor_before: body.slice(Math.max(0, located.start - 40), located.start),
    at: new Date().toISOString(),
  };
  const log = appendRun(readFixLog(meta), { previousTitle: (draft.title as string | null) ?? null, previousBody: body, changes: [change] });
  const nextMeta = clearTextCertifications({ ...meta, legal_fix_log: log }).meta;
  const patch: Record<string, unknown> = { body: newBody, metadata: nextMeta, updated_at: new Date().toISOString() };
  // An approved draft that changes is no longer the approved draft (spec 11.9).
  if (draft.status === "approved") patch.status = "review";
  const { error: upd } = await sb.from("content_drafts").update(patch).eq("id", id).eq("tenant_id", tenantId);
  if (upd) return NextResponse.json({ error: upd.message }, { status: 500 });

  await setFindingStatus({
    findingId,
    tenantId,
    status: "resolved",
    userId: actor.id,
    userEmail: actor.email,
    note: byAttorney ? "Attorney replaced the sentence." : "Apply fix: sentence corrected.",
    resolution: "fixed",
  });
  await recordAuditEvent({
    tenantId,
    draftId: id,
    event: byAttorney ? "legal_attorney_replacement" : "legal_apply_fix",
    actorUserId: actor.id,
    actorEmail: actor.email,
    detail: { findingId, rule: finding.rule_id, changeId: change.id, objections: rejected },
  });
  scheduleDraftAnalysis({
    draftId: id,
    body: newBody,
    title: draft.title as string | null,
    topic: draft.topic as string | null,
    format: draft.format as string | null,
    template: draft.template as string | null,
    targetKeywords: (draft.seo_brief as { targetKeywords?: string[] } | null)?.targetKeywords ?? [],
  });
  return NextResponse.json({ ok: true, change });
}
