"use client";

/**
 * Recent-search log for SEO pages — stored in localStorage so it survives
 * navigation without round-tripping to Supabase. Each SEO surface (keywords,
 * competitors, cannibalization, etc.) calls `recordSearch(scope, query)`
 * whenever the user runs a search. The /seo/recent page (and a chips strip
 * on each search page) read back the last N for that scope or globally.
 */

export type RecentSearchScope =
  | "keywords"
  | "competitors"
  | "cannibalization"
  | "internal-links"
  | "opportunities"
  | "technical"
  | "battles"
  | "backlinks";

export type RecentSearch = {
  scope: RecentSearchScope;
  query: string;
  createdAt: string;
};

const STORAGE_KEY = "km_seo_recent_searches";
const MAX_PER_SCOPE = 10;
const MAX_TOTAL = 50;

const SCOPE_LABELS: Record<RecentSearchScope, string> = {
  keywords: "Keywords",
  competitors: "Competitors",
  cannibalization: "Cannibalization",
  "internal-links": "Internal Links",
  opportunities: "Opportunities",
  technical: "Technical SEO",
  battles: "Keyword Battles",
  backlinks: "Backlinks",
};

const SCOPE_HREFS: Record<RecentSearchScope, (q: string) => string> = {
  keywords: (q) => `/seo/keywords?q=${encodeURIComponent(q)}`,
  competitors: (q) => `/seo/competitors/${encodeURIComponent(q)}`,
  cannibalization: (q) => `/seo/cannibalization?q=${encodeURIComponent(q)}`,
  "internal-links": (q) => `/seo/internal-links?q=${encodeURIComponent(q)}`,
  opportunities: (q) => `/seo/opportunities?q=${encodeURIComponent(q)}`,
  technical: (q) => `/seo/technical?url=${encodeURIComponent(q)}`,
  battles: (q) => `/seo/keywords/competitive?competitor=${encodeURIComponent(q)}`,
  backlinks: (q) => `/seo/backlinks?q=${encodeURIComponent(q)}`,
};

export function labelForScope(scope: RecentSearchScope): string {
  return SCOPE_LABELS[scope] ?? scope;
}

export function hrefForSearch(item: RecentSearch): string {
  const builder = SCOPE_HREFS[item.scope];
  return builder ? builder(item.query) : `/seo`;
}

function readAll(): RecentSearch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentSearch[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function writeAll(items: RecentSearch[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_TOTAL)));
  } catch {
    /* quota / disabled storage — ignore */
  }
}

/**
 * Record a search. No-op if `query` is empty or only whitespace. De-dupes by
 * (scope, query) — the newest occurrence wins, older ones bubble out of the
 * MAX_PER_SCOPE window.
 */
export function recordSearch(scope: RecentSearchScope, query: string): void {
  const trimmed = query.trim();
  if (!trimmed) return;

  const all = readAll();
  const filtered = all.filter(
    (item) => !(item.scope === scope && item.query.toLowerCase() === trimmed.toLowerCase()),
  );
  filtered.unshift({ scope, query: trimmed, createdAt: new Date().toISOString() });

  // Enforce per-scope cap.
  const seen = new Map<RecentSearchScope, number>();
  const capped: RecentSearch[] = [];
  for (const item of filtered) {
    const count = seen.get(item.scope) ?? 0;
    if (count >= MAX_PER_SCOPE) continue;
    seen.set(item.scope, count + 1);
    capped.push(item);
  }
  writeAll(capped);
  // Notify same-tab listeners (storage event only fires on other tabs).
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent("km:recent-searches"));
    } catch {
      /* ignore */
    }
  }
}

export function listRecent(scope?: RecentSearchScope, limit = 10): RecentSearch[] {
  const all = readAll();
  const filtered = scope ? all.filter((item) => item.scope === scope) : all;
  return filtered.slice(0, limit);
}

export function clearRecent(scope?: RecentSearchScope): void {
  if (!scope) {
    writeAll([]);
    return;
  }
  const all = readAll();
  writeAll(all.filter((item) => item.scope !== scope));
}
