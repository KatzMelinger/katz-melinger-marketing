/**
 * Title cannibalization filter.
 *
 * Cross-checks proposed SEO titles against existing in-system content so a
 * suggested title doesn't accidentally compete with something the firm has
 * already published or queued. Three data sources:
 *
 *   1. content_pipeline rows with a URL set (= live or queued for publish)
 *   2. content_drafts in published/approved status
 *   3. The latest cannibalization_snapshots row (Semrush ranked keywords)
 *
 * For each proposed title we tokenize, strip stopwords, and compute Jaccard
 * similarity against the existing keyword/title corpus. Anything above the
 * conflict threshold gets dropped (or returned as a warning, depending on
 * the caller).
 *
 * No external API calls — runs against whatever data the firm already has.
 */

import { getSupabaseAdmin } from "./supabase-server";
import { resolveTenantId } from "./tenant-context";

const CONFLICT_THRESHOLD = 0.7; // Jaccard similarity above which we drop

// Common English stopwords + a few legal-marketing filler words. Keep this
// list short — over-aggressive filtering makes "FMLA leave" and "FMLA pay"
// look identical.
const STOP = new Set([
  "a","an","the","and","or","of","for","to","in","on","at","by","with",
  "from","is","are","be","you","your","my","our","we","us","i","it","its",
  "this","that","these","those","what","how","why","when","where","who",
  "lawyer","attorney","lawyers","attorneys","law","firm",
]);

function tokens(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s§]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersect = 0;
  for (const t of setA) if (setB.has(t)) intersect += 1;
  const union = setA.size + setB.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

export type ConflictDetail = {
  source: "pipeline" | "draft" | "ranked_keyword";
  text: string;
  url?: string | null;
  similarity: number;
};

type ExistingItem = {
  source: ConflictDetail["source"];
  text: string;
  url: string | null;
};

/**
 * Pull every comparable title/keyword we know about. Cheap query — three
 * small selects from indexed tables. Failures bubble up as an empty corpus
 * (so the title filter degrades to "no conflicts" rather than blocking the
 * analysis pipeline).
 */
async function loadExisting(currentDraftId: string | null): Promise<ExistingItem[]> {
  const supabase = getSupabaseAdmin();
  const tid = await resolveTenantId();
  const items: ExistingItem[] = [];

  try {
    const { data: pipeRows } = await supabase
      .from("content_pipeline")
      .select("title, url")
      .eq("tenant_id", tid)
      .not("title", "is", null);
    for (const r of pipeRows ?? []) {
      if (typeof r.title === "string" && r.title.trim()) {
        items.push({
          source: "pipeline",
          text: r.title,
          url: (r.url as string | null) ?? null,
        });
      }
    }
  } catch {
    // ignore
  }

  try {
    // Only "live-ish" drafts compete for the same SERP slot.
    const { data: draftRows } = await supabase
      .from("content_drafts")
      .select("id, title")
      .eq("tenant_id", tid)
      .in("status", ["published", "approved", "review"])
      .not("title", "is", null);
    for (const r of draftRows ?? []) {
      if (!r.title || typeof r.title !== "string") continue;
      if (currentDraftId && r.id === currentDraftId) continue;
      items.push({ source: "draft", text: r.title, url: null });
    }
  } catch {
    // ignore
  }

  try {
    // The most recent cannibalization snapshot doubles as a "what does the
    // site already rank for" inventory. Each issue.keyword is a query we've
    // already got URLs ranking against.
    const { data: snap } = await supabase
      .from("cannibalization_snapshots")
      .select("issues")
      .eq("tenant_id", tid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const issues = snap?.issues as
      | Array<{ keyword?: string; urls?: Array<{ url?: string }> }>
      | null;
    if (Array.isArray(issues)) {
      for (const iss of issues) {
        if (typeof iss?.keyword === "string" && iss.keyword.trim()) {
          items.push({
            source: "ranked_keyword",
            text: iss.keyword,
            url: iss.urls?.[0]?.url ?? null,
          });
        }
      }
    }
  } catch {
    // ignore
  }

  return items;
}

export type FilteredTitle = {
  title: string;
  conflicts: ConflictDetail[];
};

export type CannibalizationResult = {
  kept: FilteredTitle[]; // titles that passed the threshold (no high-similarity conflict)
  dropped: FilteredTitle[]; // titles excluded because they conflict with existing content
};

/**
 * Filter a list of proposed titles against the existing corpus.
 *
 * @param proposed   Titles produced by the AI.
 * @param draftId    The draft these are for — excluded from self-comparison.
 */
export async function filterTitlesByCannibalization(
  proposed: string[],
  draftId: string | null = null,
): Promise<CannibalizationResult> {
  if (proposed.length === 0) {
    return { kept: [], dropped: [] };
  }
  const corpus = await loadExisting(draftId);
  if (corpus.length === 0) {
    return {
      kept: proposed.map((t) => ({ title: t, conflicts: [] })),
      dropped: [],
    };
  }

  const corpusTokens = corpus.map((c) => ({ ...c, tokens: tokens(c.text) }));

  const kept: FilteredTitle[] = [];
  const dropped: FilteredTitle[] = [];

  for (const title of proposed) {
    const tTokens = tokens(title);
    const conflicts: ConflictDetail[] = [];

    for (const existing of corpusTokens) {
      const sim = jaccard(tTokens, existing.tokens);
      if (sim >= CONFLICT_THRESHOLD) {
        conflicts.push({
          source: existing.source,
          text: existing.text,
          url: existing.url,
          similarity: Math.round(sim * 100) / 100,
        });
      }
    }

    // Keep highest-similarity conflict at the top so the UI shows the worst
    // offender first.
    conflicts.sort((a, b) => b.similarity - a.similarity);

    if (conflicts.length > 0) {
      dropped.push({ title, conflicts });
    } else {
      kept.push({ title, conflicts: [] });
    }
  }

  return { kept, dropped };
}
