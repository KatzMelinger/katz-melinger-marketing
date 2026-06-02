"use client";

/**
 * Recent-intelligence log — persists the latest Topics and SEO-Metadata
 * generations from the Content Intelligence page in localStorage, so leaving
 * and returning to the page (or reloading) keeps the results on screen until
 * the user explicitly re-runs the generator.
 *
 * Mirrors lib/recent-trends.ts and lib/recent-playbooks.ts (which already do
 * this for the Trending and Social tabs). We keep up to 10 runs per tool.
 */

export type TopicsRunItem = {
  headline: string;
  summary: string;
  practiceArea: string;
  contentType: string;
  relevance: string;
};

export type TopicsRun = {
  id: string;
  practiceArea: string;
  topics: TopicsRunItem[];
  createdAt: string;
};

export type MetadataResult = {
  metaTitle?: string;
  metaDescription?: string;
  urlSlug?: string;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  ogTitle?: string;
  ogDescription?: string;
  schemaType?: string;
  internalLinkSuggestions?: string[];
  headerOutline?: string[];
  targetWordCount?: number;
  seoTips?: string[];
};

export type MetadataRun = {
  id: string;
  topic: string;
  pageType: string;
  metadata: MetadataResult;
  createdAt: string;
};

const TOPICS_KEY = "km_recent_topics_runs";
const METADATA_KEY = "km_recent_metadata_runs";
const MAX_RUNS = 10;
const CHANGE_EVENT = "km:recent-intelligence-runs";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readAll<T>(key: string): T[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll<T>(key: string, runs: T[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(runs.slice(0, MAX_RUNS)));
  } catch {
    /* quota exceeded — non-fatal */
  }
}

function emitChange(): void {
  if (!isBrowser()) return;
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

function makeId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---- Topics ----------------------------------------------------------------

export function saveTopicsRun(args: {
  practiceArea: string;
  topics: TopicsRunItem[];
}): TopicsRun | null {
  if (!Array.isArray(args.topics) || args.topics.length === 0) return null;
  const run: TopicsRun = {
    id: makeId(),
    practiceArea: args.practiceArea,
    topics: args.topics,
    createdAt: new Date().toISOString(),
  };
  writeAll(TOPICS_KEY, [run, ...readAll<TopicsRun>(TOPICS_KEY)]);
  emitChange();
  return run;
}

export function latestTopicsRun(): TopicsRun | null {
  return readAll<TopicsRun>(TOPICS_KEY)[0] ?? null;
}

// ---- Metadata --------------------------------------------------------------

export function saveMetadataRun(args: {
  topic: string;
  pageType: string;
  metadata: MetadataResult;
}): MetadataRun | null {
  if (!args.metadata || typeof args.metadata !== "object") return null;
  const run: MetadataRun = {
    id: makeId(),
    topic: args.topic,
    pageType: args.pageType,
    metadata: args.metadata,
    createdAt: new Date().toISOString(),
  };
  writeAll(METADATA_KEY, [run, ...readAll<MetadataRun>(METADATA_KEY)]);
  emitChange();
  return run;
}

export function latestMetadataRun(): MetadataRun | null {
  return readAll<MetadataRun>(METADATA_KEY)[0] ?? null;
}

export const INTELLIGENCE_RUNS_CHANGE_EVENT = CHANGE_EVENT;
