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

/**
 * Domain-aware token expansion so semantically identical keywords compare equal
 * regardless of word order, abbreviation, or attorney/lawyer phrasing. The key
 * is a normalized token; the value is the canonical token(s) it expands to.
 * This is why "labor attorney ny", "ny labor attorney", and "labor lawyer new
 * york" all resolve to the same target instead of three competing pages.
 */
const TOKEN_SYNONYMS: Record<string, string[]> = {
  // geo abbreviations
  ny: ["new", "york"],
  nyc: ["new", "york", "city"],
  nj: ["new", "jersey"],
  ct: ["connecticut"],
  usa: ["us"],
  // legal-domain synonyms — collapse phrasing to one canonical token
  lawyer: ["attorney"],
  lawyers: ["attorney"],
  attorneys: ["attorney"],
  counsel: ["attorney"],
  atty: ["attorney"],
  attys: ["attorney"],
  // common plurals we want to collapse
  lawsuits: ["lawsuit"],
  claims: ["claim"],
  rights: ["right"],
};

/** Filler tokens that carry no disambiguating signal for keyword identity. */
const STOPWORDS = new Set(["a", "an", "the", "in", "for", "of", "near", "me", "best", "top", "and"]);

/** Expand one string into its canonical, stopword-stripped token list. */
function expandTokens(s: string): string[] {
  const out: string[] = [];
  for (const tok of normalizeKeyword(s).split(" ")) {
    if (!tok || STOPWORDS.has(tok)) continue;
    const mapped = TOKEN_SYNONYMS[tok];
    if (mapped) out.push(...mapped);
    else out.push(tok);
  }
  return out;
}

/**
 * Canonical key for a keyword: expanded, de-duplicated, sorted tokens joined.
 * Word-order / abbreviation / attorney-lawyer invariant — two keywords with the
 * same canonical key are the same search target.
 */
export function semanticKey(s: string): string {
  return Array.from(new Set(expandTokens(s))).sort().join(" ");
}

/** Jaccard similarity (0..1) of two keywords' expanded token sets. */
function tokenSetSimilarity(a: string, b: string): number {
  const sa = new Set(expandTokens(a));
  const sb = new Set(expandTokens(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/**
 * Match threshold for the fuzzy fallback. Configurable via env so it can be
 * tuned without a deploy; defaults to a conservative 0.85 (near-identical token
 * sets only — exact canonical-key equality is always a match regardless).
 */
const MATCH_THRESHOLD = (() => {
  const raw = Number(process.env.CONTENT_DEDUP_MATCH_THRESHOLD);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.85;
})();

/**
 * True when two keywords refer to the same search target: exact canonical-key
 * equality, or token-set similarity at/above the configurable threshold.
 */
export function keywordsMatch(a: string, b: string, threshold = MATCH_THRESHOLD): boolean {
  const ka = semanticKey(a);
  const kb = semanticKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  return tokenSetSimilarity(a, b) >= threshold;
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
      if (keywordsMatch(r.topic ?? "", args.keyword) || keywordsMatch(r.title ?? "", args.keyword)) {
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
      if (keywordsMatch(r.primary_keyword ?? "", args.keyword)) {
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
      if (keywordsMatch(r.title ?? "", args.keyword) || keywordsMatch(r.keywords ?? "", args.keyword)) {
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
    const self = rows.find((r) => keywordsMatch(r.keyword, args.keyword));
    if (self?.cluster_id) {
      const sibling = rows.find(
        (r) =>
          r.cluster_id === self.cluster_id &&
          !keywordsMatch(r.keyword, args.keyword) &&
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
        // Title is the same target, or the full multi-word phrase appears on the page.
        if (keywordsMatch(p.title ?? "", args.keyword) || (target.includes(" ") && hay.includes(target))) {
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
    const n = semanticKey(s ?? "");
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

/** A registry match keyed by semantic key — what's covering a given keyword. */
export type CoverageMatch = {
  kind: DuplicateKind;
  /** "published" when the covering item is live, else "draft" (anything in flight). */
  badge: "published" | "draft";
  id: string;
  label: string;
  status?: string | null;
  /** Direct URL when the cover is a published page. */
  url?: string;
};

/** Kinds the user perceives as "live", so the row badges green not blue. */
function coverageBadge(kind: DuplicateKind, status?: string | null): "published" | "draft" {
  if (kind === "published") return "published";
  return (status ?? "").toLowerCase() === "published" ? "published" : "draft";
}

/**
 * Map of semantic key → what already covers it (draft / brief / board / published
 * page / cluster sibling), for annotating a whole list at once — e.g. the
 * Opportunities list, so each row knows whether it's already been actioned
 * elsewhere without a per-row findExistingContent call. Published coverage wins
 * over in-flight when both exist for the same key.
 */
export async function loadCoverageMap(tenantId: string): Promise<Map<string, CoverageMatch>> {
  const sb = getSupabaseAdmin();
  const map = new Map<string, CoverageMatch>();
  // Only overwrite when the new match is "stronger" (published beats in-flight).
  const put = (raw: string | null | undefined, m: CoverageMatch) => {
    const key = semanticKey(raw ?? "");
    if (!key) return;
    const prev = map.get(key);
    if (!prev || (m.badge === "published" && prev.badge !== "published")) map.set(key, m);
  };

  try {
    const { data } = await sb.from("content_drafts").select("id, title, topic, status").eq("tenant_id", tenantId).limit(4000);
    for (const r of (data ?? []) as Array<{ id: string; title: string | null; topic: string | null; status: string | null }>) {
      if ((r.status ?? "").toLowerCase() === "archived") continue;
      const m: CoverageMatch = { kind: "draft", badge: coverageBadge("draft", r.status), id: r.id, label: r.title || r.topic || "", status: r.status };
      put(r.topic, m);
      put(r.title, m);
    }
  } catch {
    /* fail soft */
  }
  try {
    const { data } = await sb.from("brief_suggestions").select("id, primary_keyword, status").eq("tenant_id", tenantId).limit(4000);
    for (const r of (data ?? []) as Array<{ id: string; primary_keyword: string | null; status: string | null }>) {
      if ((r.status ?? "").toLowerCase() === "rejected") continue;
      put(r.primary_keyword, { kind: "brief", badge: "draft", id: r.id, label: r.primary_keyword || "", status: r.status });
    }
  } catch {
    /* fail soft */
  }
  try {
    const { data } = await sb.from("content_pipeline").select("id, title, keywords, url, status").eq("tenant_id", tenantId).limit(4000);
    for (const r of (data ?? []) as Array<{ id: number; title: string | null; keywords: string | null; url: string | null; status: string | null }>) {
      const m: CoverageMatch = { kind: "pipeline", badge: coverageBadge("pipeline", r.status), id: String(r.id), label: r.title || r.keywords || "", status: r.status, url: r.url ?? undefined };
      put(r.title, m);
      put(r.keywords, m);
    }
  } catch {
    /* fail soft */
  }
  try {
    const { data } = await sb.from("site_pages").select("url, title, h1").eq("tenant_id", tenantId).limit(4000);
    for (const p of (data ?? []) as Array<{ url: string; title: string | null; h1: string | null }>) {
      const m: CoverageMatch = { kind: "published", badge: "published", id: p.url, label: p.title || p.url, url: p.url, status: "published" };
      put(p.title, m);
      put(p.h1, m);
    }
  } catch {
    /* fail soft */
  }
  return map;
}

export type DuplicateCount = {
  /** Number of duplicate GROUPS (a group = 2+ rows in one table sharing a key). */
  groups: number;
  /** Redundant rows = sum over groups of (size − 1). */
  redundantRows: number;
  /** Up to 10 example groups, for the side-by-side view. */
  samples: { table: "draft" | "brief" | "pipeline"; key: string; count: number }[];
};

export type DuplicateMember = {
  id: string;
  title: string;
  status: string | null;
  /** Where to open this item (draft viewer / decisions / board / live page). */
  href: string | null;
  createdAt: string | null;
};

export type DuplicateGroup = {
  table: "draft" | "brief" | "pipeline";
  /** Human source label for the column header. */
  source: string;
  /** Semantic key the members collapse to — the conflict heading. */
  key: string;
  members: DuplicateMember[];
};

const SOURCE_LABEL: Record<DuplicateGroup["table"], string> = {
  draft: "Drafts",
  brief: "Briefs (Decisions)",
  pipeline: "Production Board",
};

function groupsOf<T>(rows: T[], keyOf: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    const list = m.get(k) ?? [];
    list.push(r);
    m.set(k, list);
  }
  for (const [k, list] of m) if (list.length < 2) m.delete(k);
  return m;
}

async function safeRows<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch {
    return [];
  }
}

/**
 * List the duplicate GROUPS with their member items, for the side-by-side
 * conflict view. Scans WITHIN each table (a brief → its draft → its board row
 * for the same keyword is the normal happy path, NOT a duplicate — only repeats
 * inside one table are redundant) and groups by the registry semantic key, so
 * word-order / abbreviation variants collapse together. Fail-soft per table.
 */
export async function listContentDuplicates(tenantId: string): Promise<DuplicateGroup[]> {
  const sb = getSupabaseAdmin();

  const drafts = await safeRows(async () => {
    const { data } = await sb
      .from("content_drafts")
      .select("id, title, topic, format, status, created_at")
      .eq("tenant_id", tenantId)
      .limit(4000);
    return ((data ?? []) as Array<{ id: string; title: string | null; topic: string | null; format: string | null; status: string | null; created_at: string | null }>).filter(
      (r) => (r.status ?? "").toLowerCase() !== "archived",
    );
  });
  const briefs = await safeRows(async () => {
    const { data } = await sb
      .from("brief_suggestions")
      .select("id, primary_keyword, status, created_at")
      .eq("tenant_id", tenantId)
      .limit(4000);
    return ((data ?? []) as Array<{ id: string; primary_keyword: string | null; status: string | null; created_at: string | null }>).filter(
      (r) => (r.status ?? "").toLowerCase() !== "rejected",
    );
  });
  const pipeline = await safeRows(async () => {
    const { data } = await sb
      .from("content_pipeline")
      .select("id, title, keywords, status, url, created_at")
      .eq("tenant_id", tenantId)
      .limit(4000);
    return (data ?? []) as Array<{ id: number; title: string | null; keywords: string | null; status: string | null; url: string | null; created_at: string | null }>;
  });

  const out: DuplicateGroup[] = [];

  for (const [k, g] of groupsOf(drafts, (r) => {
    const sk = semanticKey(r.title || r.topic || "");
    return sk ? `${sk}::${(r.format ?? "").toLowerCase()}` : "";
  })) {
    out.push({
      table: "draft",
      source: SOURCE_LABEL.draft,
      key: k.split("::")[0],
      members: g.map((r) => ({
        id: r.id,
        title: r.title || r.topic || "(untitled)",
        status: r.status,
        href: `/content/drafts?id=${r.id}`,
        createdAt: r.created_at,
      })),
    });
  }
  for (const [k, g] of groupsOf(briefs, (r) => semanticKey(r.primary_keyword || ""))) {
    out.push({
      table: "brief",
      source: SOURCE_LABEL.brief,
      key: k,
      members: g.map((r) => ({
        id: r.id,
        title: r.primary_keyword || "(no keyword)",
        status: r.status,
        href: "/content/decisions",
        createdAt: r.created_at,
      })),
    });
  }
  for (const [k, g] of groupsOf(pipeline, (r) => semanticKey(r.title || r.keywords || ""))) {
    out.push({
      table: "pipeline",
      source: SOURCE_LABEL.pipeline,
      key: k,
      members: g.map((r) => ({
        id: String(r.id),
        title: r.title || r.keywords || "(untitled)",
        status: r.status,
        href: r.url || "/content-production",
        createdAt: r.created_at,
      })),
    });
  }

  return out;
}

/**
 * Count system-wide duplicate content for a tenant, for the Overview alert.
 * Derived from listContentDuplicates() so the scan logic lives in one place.
 */
export async function countContentDuplicates(tenantId: string): Promise<DuplicateCount> {
  const groups = await listContentDuplicates(tenantId);
  return {
    groups: groups.length,
    redundantRows: groups.reduce((n, g) => n + (g.members.length - 1), 0),
    samples: groups.slice(0, 10).map((g) => ({ table: g.table, key: g.key, count: g.members.length })),
  };
}
