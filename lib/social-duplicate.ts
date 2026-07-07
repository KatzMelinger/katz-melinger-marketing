/**
 * Rule 8 — duplicate-angle check against the current month's Content Calendar.
 *
 * Before a generated social post is finalized, compare it against the posts
 * already scheduled or published THIS MONTH. Two conflict kinds are flagged:
 *   - same-source:   the same source asset was already posted this month.
 *   - similar-angle: an existing post opens with essentially the same angle
 *                    (hook + first value line), not just the same topic.
 *
 * Per the locked decision this is ADVISORY: conflicts are flagged to Diana on
 * the card (not blocked, not auto-regenerated). Reuses the domain-aware token
 * normalization from content-dedup (semanticKey) so word-order/abbreviation/
 * lawyer-vs-attorney variants collapse together.
 *
 * Fails soft: any query error yields "no conflicts, check not run" (null), so
 * generation never breaks on this.
 */

import { getSupabaseAdmin } from "./supabase-server";
import { semanticKey } from "./content-dedup";

export type AngleConflict = {
  postId: string;
  platform: string;
  /** ISO date the conflicting post is/was scheduled or published. */
  date: string;
  reason: "same-source" | "similar-angle";
  /** 0..1 angle similarity, present for similar-angle. */
  similarity?: number;
};

const ANGLE_THRESHOLD = 0.6; // similar-angle: hook+first-line token overlap
const SOURCE_THRESHOLD = 0.75; // same-source: source-title token overlap

/** Token set from content-dedup's canonical key (synonym/stopword-aware). */
function tokens(s: string): Set<string> {
  return new Set(semanticKey(s).split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * The distinctive "angle" of a post: its hook line plus the first value line —
 * the part that differs between two posts on the same topic. Carousels have a
 * "Slide 1:" prefix stripped first.
 */
function angleSignature(body: string): string {
  const cleaned = (body ?? "").replace(/^\s*(?:\*\*)?slide\s*\d+\s*[:\-.)]/i, "");
  const lines = cleaned
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^#/.test(l)); // drop hashtag lines
  return lines.slice(0, 2).join(" ").split(/\s+/).slice(0, 30).join(" ");
}

function monthBounds(now: Date): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

type ExistingPost = { id: string; platform: string; date: string; body: string; sourceTitle: string | null };

/**
 * Load this month's scheduled/published social posts for the tenant, plus each
 * one's source-asset title (from the linked draft's social_source metadata).
 */
async function loadMonthPosts(tenantId: string, now: Date): Promise<ExistingPost[]> {
  const sb = getSupabaseAdmin();
  const { start, end } = monthBounds(now);
  // scheduled_at OR published_at within the month. Two ranged filters can't be
  // OR'd cleanly, so pull a recent window and filter in code.
  const { data, error } = await sb
    .from("social_posts")
    .select("id, platform, content, status, scheduled_at, published_at, posted_at, created_at, source_draft_id")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error || !data) return [];

  const rows = (data as Array<Record<string, unknown>>)
    .map((r) => {
      const date =
        (r.scheduled_at as string | null) ??
        (r.published_at as string | null) ??
        (r.posted_at as string | null) ??
        (r.created_at as string | null);
      return date ? { r, date } : null;
    })
    .filter((x): x is { r: Record<string, unknown>; date: string } => x !== null)
    .filter(({ date }) => date >= start && date < end);

  // Resolve source titles from the linked drafts in one query.
  const draftIds = [...new Set(rows.map(({ r }) => r.source_draft_id).filter(Boolean))] as string[];
  const sourceById = new Map<string, string>();
  if (draftIds.length) {
    const { data: drafts } = await sb.from("content_drafts").select("id, metadata").in("id", draftIds);
    for (const d of (drafts ?? []) as Array<Record<string, unknown>>) {
      const meta = (d.metadata ?? {}) as Record<string, unknown>;
      const s = meta.social_source as { title?: string } | undefined;
      if (s?.title) sourceById.set(String(d.id), s.title);
    }
  }

  return rows.map(({ r, date }) => ({
    id: String(r.id ?? ""),
    platform: String(r.platform ?? "").toLowerCase(),
    date,
    body: typeof r.content === "string" ? r.content : "",
    sourceTitle: r.source_draft_id ? sourceById.get(String(r.source_draft_id)) ?? null : null,
  }));
}

/**
 * Check each candidate post against this month's calendar. Returns a map of
 * candidate index → conflicts, and whether the check actually ran (`ran`). When
 * `ran` is false the caller should treat the checklist item as not-applicable.
 */
export async function checkMonthlyDuplicates(args: {
  tenantId: string;
  sourceTitle: string;
  candidates: { body: string }[];
  now?: Date;
}): Promise<{ ran: boolean; conflicts: AngleConflict[][] }> {
  const empty = args.candidates.map(() => [] as AngleConflict[]);
  try {
    const existing = await loadMonthPosts(args.tenantId, args.now ?? new Date());
    if (!existing.length) return { ran: true, conflicts: empty };

    const sourceTokens = tokens(args.sourceTitle);
    const conflicts = args.candidates.map(({ body }) => {
      const sig = tokens(angleSignature(body));
      const out: AngleConflict[] = [];
      for (const p of existing) {
        // same source asset used this month
        if (p.sourceTitle && jaccard(sourceTokens, tokens(p.sourceTitle)) >= SOURCE_THRESHOLD) {
          out.push({ postId: p.id, platform: p.platform, date: p.date, reason: "same-source" });
          continue; // one conflict per existing post is enough
        }
        // essentially the same angle
        const sim = jaccard(sig, tokens(angleSignature(p.body)));
        if (sim >= ANGLE_THRESHOLD) {
          out.push({ postId: p.id, platform: p.platform, date: p.date, reason: "similar-angle", similarity: Math.round(sim * 100) / 100 });
        }
      }
      return out;
    });
    return { ran: true, conflicts };
  } catch {
    return { ran: false, conflicts: empty };
  }
}
