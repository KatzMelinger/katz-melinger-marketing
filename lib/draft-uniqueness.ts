/**
 * One live draft per topic (Oct 20 spec, Task A3): no two open drafts may
 * share a primary keyword or an update_target_url. Creating a second one is
 * refused with the existing draft, which the person opens and refreshes
 * instead. Archived and published drafts do not count (an archived draft is
 * read only; Restore swaps it with the kept version).
 */
import { getSupabaseAdmin } from "./supabase-server";
import { semanticKey } from "./content-dedup";

type Meta = Record<string, unknown>;

export function draftPrimaryKeyword(meta: Meta | null | undefined): string | null {
  const m = meta ?? {};
  const kb = (m.km_brief as Meta | undefined) ?? {};
  const sb = (m.seo_brief as Meta | undefined) ?? {};
  const sel = (m.keyword_selection as { chosen?: { keyword?: unknown } } | undefined)?.chosen?.keyword;
  for (const k of [m.primaryKeyword, kb.primaryKeyword, sb.primaryKeyword, sel]) {
    if (typeof k === "string" && k.trim()) return k.trim();
  }
  return null;
}

export function draftTargetUrl(meta: Meta | null | undefined): string | null {
  const u = meta?.update_target_url ?? meta?.source_url;
  return typeof u === "string" && u.trim() ? u.trim() : null;
}

/** https://www.katzmelinger.com/x/?a -> katzmelinger.com/x */
export function normalizeTargetUrl(u: string): string {
  return u
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

export type LiveDraftConflict = {
  draftId: string;
  title: string | null;
  status: string;
  /** What they share. */
  by: "keyword" | "url";
  value: string;
};

/**
 * The open draft that already targets this keyword or URL, if any. A read
 * failure returns null rather than blocking creation (the board and the
 * report still show duplicates).
 */
export async function findLiveDraftFor(args: {
  tenantId: string;
  keyword?: string | null;
  targetUrl?: string | null;
  excludeId?: string | null;
}): Promise<LiveDraftConflict | null> {
  const kwKey = args.keyword?.trim() ? semanticKey(args.keyword) : null;
  const urlKey = args.targetUrl?.trim() ? normalizeTargetUrl(args.targetUrl) : null;
  if (!kwKey && !urlKey) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("content_drafts")
    .select("id, title, status, metadata")
    .eq("tenant_id", args.tenantId)
    .not("status", "in", "(archived,published)")
    .range(0, 1999);
  if (error) return null;
  for (const d of data ?? []) {
    if (args.excludeId && d.id === args.excludeId) continue;
    const meta = (d.metadata as Meta | null) ?? {};
    const url = draftTargetUrl(meta);
    if (urlKey && url && normalizeTargetUrl(url) === urlKey) {
      return { draftId: d.id as string, title: (d.title as string | null) ?? null, status: d.status as string, by: "url", value: url };
    }
    const kw = draftPrimaryKeyword(meta);
    if (kwKey && kw && semanticKey(kw) === kwKey) {
      return { draftId: d.id as string, title: (d.title as string | null) ?? null, status: d.status as string, by: "keyword", value: kw };
    }
  }
  return null;
}

/** The 409 body: open the existing draft and refresh it instead. */
export function liveDraftConflictBody(c: LiveDraftConflict): Record<string, unknown> {
  return {
    error:
      `An open draft already targets this ${c.by === "url" ? "page" : "keyword"} ("${c.value}"): ` +
      `"${c.title ?? c.draftId.slice(0, 8)}". Open it and use Refresh this draft instead of creating a second one.`,
    duplicate: true,
    liveDraft: c,
    existing: { kind: "draft", id: c.draftId, label: c.title ?? c.draftId.slice(0, 8) },
  };
}
