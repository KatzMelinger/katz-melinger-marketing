/**
 * Run the section 9 rewrite on one stored draft and record it.
 *
 * Shared by the "Fix known errors" button (POST /api/content/drafts/[id]/auto-fix),
 * the library backfill (scripts/backfill-legal-rewrite.ts) and nothing else
 * that writes. Service-role client, so every query is scoped by tenant_id.
 *
 * It never changes a draft's status, never approves and never publishes
 * (Diana decides what is published). It saves the previous version, the new
 * body, and the change log; clears the text-bound certifications, because the
 * text changed; and leaves the log unreviewed, which holds approval until a
 * person marks it reviewed.
 */
import { getSupabaseAdmin } from "./supabase-server";
import { autoRewrite, type RewriteResult } from "./auto-rewrite";
import { runLegalFactChecks } from "./legal-verify";
import { loadStatuteTable } from "./legal-statute-check";
import { closingCtaFor } from "./closing-cta";
import { appendRun, readFixLog } from "./legal-fix-log";
import { clearTextCertifications } from "./draft-certifications";
import { recordAuditEvent } from "./content-findings-store";
import { hasWebPage } from "./draft-metadata";

export const REWRITE_FORMATS = new Set(["blog", "km_blog_post", "km_page_update", "km_practice_page"]);

export type FixDraftOutcome = {
  draftId: string;
  title: string | null;
  skipped?: string;
  changes: number;
  attorneyReview: string[];
  fullRedraft: string | null;
  result?: RewriteResult;
};

export async function fixDraft(args: {
  draftId: string;
  tenantId: string;
  actor?: { id: string | null; email: string | null };
  /** Compute and report, write nothing. */
  dryRun?: boolean;
  /** Deterministic edits only (no model call). */
  noModel?: boolean;
  /** Restrict to the backfill's website formats. The button allows any page format. */
  websiteFormatsOnly?: boolean;
}): Promise<FixDraftOutcome> {
  const sb = getSupabaseAdmin();
  const { data: draft, error } = await sb
    .from("content_drafts")
    .select("id, title, topic, body, format, status, practice_area, metadata")
    .eq("tenant_id", args.tenantId)
    .eq("id", args.draftId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!draft) throw new Error("Draft not found");

  const base: FixDraftOutcome = {
    draftId: draft.id as string,
    title: (draft.title as string | null) ?? null,
    changes: 0,
    attorneyReview: [],
    fullRedraft: null,
  };
  const format = ((draft.format as string | null) ?? "").trim();
  if (args.websiteFormatsOnly ? !REWRITE_FORMATS.has(format) : !hasWebPage(format)) {
    return { ...base, skipped: `format ${format || "(none)"} is not a web page` };
  }
  if (["archived", "published"].includes(draft.status as string)) {
    return { ...base, skipped: `status ${draft.status}` };
  }

  const body = (draft.body as string | null) ?? "";
  const [kbFindings, statutes, cta] = await Promise.all([
    runLegalFactChecks(body, { tenantId: args.tenantId }).catch(() => []),
    loadStatuteTable(args.tenantId),
    closingCtaFor(args.tenantId),
  ]);

  const result = await autoRewrite({
    body,
    title: (draft.title as string | null) ?? null,
    topic: (draft.topic as string | null) ?? null,
    practiceArea: (draft.practice_area as string | null) ?? null,
    format,
    cta,
    kbFindings,
    statuteRows: statutes.ok ? statutes.rows : [],
    noModel: args.noModel,
  });

  const outcome: FixDraftOutcome = {
    ...base,
    changes: result.changes.length,
    attorneyReview: result.attorneyReview,
    fullRedraft: result.fullRedraft,
    result,
  };
  if (args.dryRun) return outcome;
  if (result.changes.length === 0 && !result.fullRedraft) return outcome;

  const storedMeta = (draft.metadata as Record<string, unknown> | null) ?? {};
  const log = appendRun(readFixLog(storedMeta), {
    previousTitle: (draft.title as string | null) ?? null,
    previousBody: body,
    changes: result.changes,
    fullRedraft: result.fullRedraft,
  });
  let meta: Record<string, unknown> = { ...storedMeta, legal_fix_log: log };
  if (result.changes.length > 0) meta = clearTextCertifications(meta).meta;

  const { error: upd } = await sb
    .from("content_drafts")
    .update({
      body: result.body,
      title: result.title,
      metadata: meta,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", args.tenantId)
    .eq("id", args.draftId);
  if (upd) throw new Error(upd.message);

  await recordAuditEvent({
    tenantId: args.tenantId,
    draftId: args.draftId,
    event: result.fullRedraft ? "full_redraft_flagged" : "auto_rewrite",
    actorUserId: args.actor?.id ?? null,
    actorEmail: args.actor?.email ?? null,
    detail: {
      changes: result.changes.length,
      by_source: result.changes.reduce<Record<string, number>>((acc, c) => {
        acc[c.source] = (acc[c.source] ?? 0) + 1;
        return acc;
      }, {}),
      attorney_review: result.attorneyReview.length,
      full_redraft: result.fullRedraft,
    },
  });
  return outcome;
}
