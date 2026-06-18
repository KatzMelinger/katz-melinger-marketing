/**
 * Shared duplicate-prevention guard for content creation.
 *
 * Every content-creation entry point — Opportunities (brief + KM draft),
 * Content Studio (generate / drafts / multi-format batch), Peggy's chat tool,
 * and the autonomous agent — calls this BEFORE creating a brief or draft, so the
 * system can never produce two pieces targeting the same keyword or keyword
 * CLUSTER. It checks across every content state:
 *   - drafts            (content_drafts, excluding archived)
 *   - briefs in progress (brief_suggestions, excluding rejected)
 *   - the production board (content_pipeline)
 *   - published pages   (site_pages / Site Inventory)
 *   - the keyword's cluster (seo_opportunities.cluster_id — a sibling keyword in
 *     the same cluster that already has a brief or draft)
 *
 * Uses the service-role client + an explicit tenant filter, so it works in both
 * request context AND the cron agent (no session). Read-only and fail-soft: a
 * query error never blocks creation (we'd rather risk a rare dup than hard-fail
 * a generation on a transient DB hiccup).
 *
 * Matching is on a normalized key (lowercased, punctuation stripped, spaces
 * collapsed) because the underlying columns are not stored normalized — that's
 * exactly why "Labor Attorney NY" could be created twice.
 */

import { getSupabaseAdmin } from "@/lib/supabase-server";

export type DuplicateKind = "draft" | "brief" | "pipeline" | "published" | "cluster";

export type DuplicateMatch = {
  kind: DuplicateKind;
  /** id (or URL for published) of the existing item. */
  id: string;
  /** Human label — title / keyword / url. */
  label: string;
  status?: string | null;
  /** Extra context, e.g. the cluster relationship or the page URL. */
  detail?: string;
};

/** Normalize for comparison: lowercase, strip punctuation, collapse whitespace. */
export function normalizeKeyword(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Build the user-facing message for a duplicate match. */
export function duplicateMessage(d: DuplicateMatch): string {
  const where: Record<DuplicateKind, string> = {
    draft: "a draft",
    brief: "a brief in progress",
    pipeline: "a Production Board item",
    published: "a published page",
    cluster: "the same keyword cluster",
  };
  const base = `Already covered by ${where[d.kind]}: “${d.label}”`;
  return d.detail && d.kind !== "cluster" ? `${base} (${d.detail})` : d.detail ? `${base} — ${d.detail}` : base;
}

export async function findExistingContent(args: {
  tenantId: string;
  keyword: string;
  secondaryKeywords?: string[];
  /** Default true — scan published Site Inventory pages too. */
  includePublished?: boolean;
}): Promise<DuplicateMatch | null> {
  const target = normalizeKeyword(args.keyword);
  if (!target || target.length < 3) return null;
  const sb = getSupabaseAdmin();
  const tid = args.tenantId;

  // 1) Existing drafts (topic OR title), excluding archived.
  try {
    const { data } = await sb
      .from("content_drafts")
      .select("id, title, topic, status")
      .eq("tenant_id", tid)
      .limit(2000);
    for (const r of (data ?? []) as Array<{ id: string; title: string | null; topic: string | null; status: string | null }>) {
      if ((r.status ?? "").toLowerCase() === "archived") continue;
      if (normalizeKeyword(r.topic ?? "") === target || normalizeKeyword(r.title ?? "") === target) {
        return { kind: "draft", id: r.id, label: r.title || r.topic || target, status: r.status };
      }
    }
  } catch {
    /* fail soft */
  }

  // 2) Briefs in progress (non-rejected).
  try {
    const { data } = await sb
      .from("brief_suggestions")
      .select("id, primary_keyword, status")
      .eq("tenant_id", tid)
      .limit(2000);
    for (const r of (data ?? []) as Array<{ id: string; primary_keyword: string | null; status: string | null }>) {
      if ((r.status ?? "").toLowerCase() === "rejected") continue;
      if (normalizeKeyword(r.primary_keyword ?? "") === target) {
        return { kind: "brief", id: r.id, label: r.primary_keyword || target, status: r.status };
      }
    }
  } catch {
    /* fail soft */
  }

  // 3) Production board items.
  try {
    const { data } = await sb
      .from("content_pipeline")
      .select("id, title, keywords, status")
      .eq("tenant_id", tid)
      .limit(2000);
    for (const r of (data ?? []) as Array<{ id: number; title: string | null; keywords: string | null; status: string | null }>) {
      if (normalizeKeyword(r.title ?? "") === target || normalizeKeyword(r.keywords ?? "") === target) {
        return { kind: "pipeline", id: String(r.id), label: r.title || r.keywords || target, status: r.status };
      }
    }
  } catch {
    /* fail soft */
  }

  // 4) Same keyword CLUSTER — a sibling keyword that already has a brief/draft.
  try {
    const { data } = await sb
      .from("seo_opportunities")
      .select("keyword, cluster_id, cluster_primary_keyword, draft_id, brief_id")
      .eq("tenant_id", tid)
      .not("cluster_id", "is", null)
      .limit(4000);
    const rows = (data ?? []) as Array<{
      keyword: string;
      cluster_id: string | null;
      cluster_primary_keyword: string | null;
      draft_id: string | null;
      brief_id: string | null;
    }>;
    const self = rows.find((r) => normalizeKeyword(r.keyword) === target);
    if (self?.cluster_id) {
      const sibling = rows.find(
        (r) =>
          r.cluster_id === self.cluster_id &&
          normalizeKeyword(r.keyword) !== target &&
          (r.draft_id || r.brief_id),
      );
      if (sibling) {
        return {
          kind: "cluster",
          id: sibling.draft_id || sibling.brief_id || self.cluster_id,
          label: sibling.keyword,
          detail: self.cluster_primary_keyword
            ? `cluster “${self.cluster_primary_keyword}” already has content for “${sibling.keyword}” — build one page for the cluster, not competing pages`
            : `“${sibling.keyword}” is in the same cluster and already has content`,
        };
      }
    }
  } catch {
    /* fail soft */
  }

  // 5) Published Site Inventory pages.
  if (args.includePublished !== false) {
    try {
      const { data } = await sb
        .from("site_pages")
        .select("url, title, h1, topics")
        .eq("tenant_id", tid)
        .limit(2000);
      for (const p of (data ?? []) as Array<{ url: string; title: string | null; h1: string | null; topics: string[] | null }>) {
        const hay = normalizeKeyword(`${p.title ?? ""} ${p.h1 ?? ""} ${(p.topics ?? []).join(" ")}`);
        // Title is an exact target, or the full multi-word phrase appears on the page.
        if (normalizeKeyword(p.title ?? "") === target || (target.includes(" ") && hay.includes(target))) {
          return { kind: "published", id: p.url, label: p.title || p.url, detail: p.url };
        }
      }
    } catch {
      /* fail soft */
    }
  }

  return null;
}

/**
 * Bulk set of normalized targets already in flight or published — the
 * per-run idempotency set for the autonomous agent (cheaper than calling
 * findExistingContent for every candidate). Mirrors the same sources.
 */
export async function loadExistingTargetSet(tenantId: string): Promise<Set<string>> {
  const sb = getSupabaseAdmin();
  const set = new Set<string>();
  const add = (s?: string | null) => {
    const n = normalizeKeyword(s ?? "");
    if (n) set.add(n);
  };

  try {
    const { data } = await sb.from("content_drafts").select("title, topic, status").eq("tenant_id", tenantId).limit(4000);
    for (const r of (data ?? []) as Array<{ title: string | null; topic: string | null; status: string | null }>) {
      if ((r.status ?? "").toLowerCase() === "archived") continue;
      add(r.topic);
      add(r.title);
    }
  } catch {
    /* fail soft */
  }
  try {
    const { data } = await sb.from("brief_suggestions").select("primary_keyword, status").eq("tenant_id", tenantId).limit(4000);
    for (const r of (data ?? []) as Array<{ primary_keyword: string | null; status: string | null }>) {
      if ((r.status ?? "").toLowerCase() === "rejected") continue;
      add(r.primary_keyword);
    }
  } catch {
    /* fail soft */
  }
  try {
    const { data } = await sb.from("content_pipeline").select("title, keywords").eq("tenant_id", tenantId).limit(4000);
    for (const r of (data ?? []) as Array<{ title: string | null; keywords: string | null }>) {
      add(r.title);
      add(r.keywords);
    }
  } catch {
    /* fail soft */
  }
  return set;
}
