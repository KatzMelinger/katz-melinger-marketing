/**
 * Version history (Oct 20 spec, Task A17): every saved version of a draft is
 * kept and can be restored. The version BEFORE each change is stored (an
 * edit, Fix known errors, Improve to Ready, an attorney's replacement, an
 * Undo, a restore). Before supabase/system_health_a17.sql is run, saving is a
 * no-op and nothing else changes.
 */
import { getSupabaseAdmin } from "./supabase-server";

function isMissingTable(message: string | undefined): boolean {
  return !!message && /content_draft_versions|does not exist|schema cache/i.test(message);
}

export async function saveVersion(args: {
  tenantId: string;
  draftId: string;
  title: string | null;
  body: string | null;
  content?: unknown;
  reason: string;
  by?: string | null;
}): Promise<void> {
  if (!args.body?.trim()) return;
  try {
    const { error } = await getSupabaseAdmin()
      .from("content_draft_versions")
      .insert({
        tenant_id: args.tenantId,
        draft_id: args.draftId,
        title: args.title,
        body: args.body,
        content: args.content ?? null,
        reason: args.reason,
        saved_by: args.by ?? null,
      });
    if (error && !isMissingTable(error.message)) console.warn("[draft-versions] save failed:", error.message);
  } catch {
    /* a version that could not be kept never blocks the save itself */
  }
}

export type DraftVersion = { id: string; title: string | null; reason: string; saved_by: string | null; saved_at: string; words: number };

export async function listVersions(tenantId: string, draftId: string): Promise<DraftVersion[] | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("content_draft_versions")
    .select("id, title, reason, saved_by, saved_at, body")
    .eq("tenant_id", tenantId)
    .eq("draft_id", draftId)
    .order("saved_at", { ascending: false })
    .limit(100);
  if (error) return isMissingTable(error.message) ? null : [];
  return (data ?? []).map((v) => ({
    id: v.id as string,
    title: (v.title as string | null) ?? null,
    reason: v.reason as string,
    saved_by: (v.saved_by as string | null) ?? null,
    saved_at: v.saved_at as string,
    words: String(v.body ?? "").split(/\s+/).filter(Boolean).length,
  }));
}

export async function getVersion(tenantId: string, draftId: string, versionId: string): Promise<{ title: string | null; body: string } | null> {
  const { data } = await getSupabaseAdmin()
    .from("content_draft_versions")
    .select("title, body")
    .eq("tenant_id", tenantId)
    .eq("draft_id", draftId)
    .eq("id", versionId)
    .maybeSingle();
  return data ? { title: (data.title as string | null) ?? null, body: data.body as string } : null;
}
