/**
 * Archive a draft as a duplicate (or as off practice), never delete it
 * (Diana's Sept 28 spec, Appendix F).
 *
 * An archived draft keeps its text and history, drops out of the Production
 * Board, the Content Studio list, the backfill and the publish queue (status
 * "archived"), and carries:
 *   metadata.archive = { duplicate_of, reason, archived_by, archived_at, previous_status }
 * and the keeper carries metadata.absorbed_from = [archived ids]. The draft
 * screens show "Archived as a duplicate of <keeper>" with a Restore button.
 *
 * Takes the caller's Supabase client: the RLS-scoped route client in a
 * request, the service-role client (with tenantId) in a script.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export type ArchiveInfo = {
  duplicate_of: string | null;
  reason: string;
  archived_by: string | null;
  archived_at: string;
  previous_status: string | null;
};

export function readArchive(meta: Record<string, unknown> | null | undefined): ArchiveInfo | null {
  const a = meta?.archive as ArchiveInfo | undefined;
  return a && typeof a === "object" && a.archived_at ? a : null;
}

export async function archiveDrafts(args: {
  supabase: any;
  tenantId?: string;
  ids: string[];
  keeperId: string | null;
  reason: string;
  archivedBy: string | null;
}): Promise<{ archived: string[]; errors: string[] }> {
  const { supabase, tenantId } = args;
  const now = new Date().toISOString();
  const archived: string[] = [];
  const errors: string[] = [];

  let q = supabase.from("content_drafts").select("id, status, metadata").in("id", args.ids);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data, error } = await q;
  if (error) return { archived, errors: [error.message] };

  for (const d of data ?? []) {
    const meta = (d.metadata as Record<string, unknown> | null) ?? {};
    const wp = (meta.wp_publish as Record<string, unknown> | undefined) ?? undefined;
    const next: Record<string, unknown> = {
      ...meta,
      archive: {
        duplicate_of: args.keeperId,
        reason: args.reason,
        archived_by: args.archivedBy,
        archived_at: now,
        previous_status: d.status ?? null,
      } satisfies ArchiveInfo,
      ...(wp ? { wp_publish: { ...wp, queued: false } } : {}),
    };
    let u = supabase.from("content_drafts").update({ status: "archived", metadata: next }).eq("id", d.id);
    if (tenantId) u = u.eq("tenant_id", tenantId);
    const { error: e } = await u;
    if (e) errors.push(`${d.id}: ${e.message}`);
    else {
      archived.push(d.id);
      let p = supabase.from("content_pipeline").update({ status: "archived" }).eq("draft_id", d.id);
      if (tenantId) p = p.eq("tenant_id", tenantId);
      await p;
    }
  }

  if (args.keeperId && archived.length > 0) {
    let k = supabase.from("content_drafts").select("id, metadata").eq("id", args.keeperId);
    if (tenantId) k = k.eq("tenant_id", tenantId);
    const { data: keeper } = await k.maybeSingle();
    if (keeper) {
      const meta = (keeper.metadata as Record<string, unknown> | null) ?? {};
      const prior = Array.isArray(meta.absorbed_from) ? (meta.absorbed_from as string[]) : [];
      let ku = supabase
        .from("content_drafts")
        .update({ metadata: { ...meta, absorbed_from: [...new Set([...prior, ...archived])] } })
        .eq("id", args.keeperId);
      if (tenantId) ku = ku.eq("tenant_id", tenantId);
      await ku;
    }
  }
  return { archived, errors };
}

export async function restoreDraft(args: {
  supabase: any;
  tenantId?: string;
  id: string;
}): Promise<{ ok: boolean; status?: string; error?: string }> {
  const { supabase, tenantId } = args;
  let q = supabase.from("content_drafts").select("id, status, metadata").eq("id", args.id);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data: d, error } = await q.maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!d) return { ok: false, error: "Not found" };
  if (d.status !== "archived") return { ok: false, error: "This draft is not archived." };
  const meta = { ...((d.metadata as Record<string, unknown> | null) ?? {}) };
  const info = readArchive(meta);
  // Never restore straight into a gated status: an approved draft that was
  // archived comes back to review and goes through the gates again.
  const prev = info?.previous_status;
  const status = prev && !["approved", "published", "needs_legal", "archived"].includes(prev) ? prev : "draft";
  delete meta.archive;
  meta.restored_from_archive = { at: new Date().toISOString(), was: info ?? null };
  let u = supabase.from("content_drafts").update({ status, metadata: meta }).eq("id", args.id);
  if (tenantId) u = u.eq("tenant_id", tenantId);
  const { error: e } = await u;
  if (e) return { ok: false, error: e.message };
  let p = supabase.from("content_pipeline").update({ status }).eq("draft_id", args.id);
  if (tenantId) p = p.eq("tenant_id", tenantId);
  await p;
  return { ok: true, status };
}
