"use client";

/**
 * Recent-playbook log — keeps the latest social-playbook generations in
 * localStorage so leaving and returning to the Content Studio / Social
 * Trends pages doesn't wipe the result. Mirrors lib/recent-trends.ts.
 *
 * We persist up to 10 runs, keyed by id. The pages restore the most recent
 * one on mount so the marketer never loses a generation to a page nav.
 */

export type SocialPlaybook = {
  hashtags?: { broad?: string[]; niche?: string[] };
  hooks?: string[];
  captions?: string[];
  best_times?: string;
  visual_ideas?: string[];
  platform_tips?: string[];
};

export type PlaybookRun = {
  id: string;
  topic: string;
  platform: string;
  playbook: SocialPlaybook;
  createdAt: string;
};

const STORAGE_KEY = "km_recent_playbook_runs";
const MAX_RUNS = 10;
const CHANGE_EVENT = "km:recent-playbook-runs";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readAll(): PlaybookRun[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PlaybookRun[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is PlaybookRun =>
        !!r &&
        typeof r === "object" &&
        typeof r.id === "string" &&
        typeof r.topic === "string" &&
        typeof r.platform === "string" &&
        typeof r.playbook === "object" &&
        typeof r.createdAt === "string",
    );
  } catch {
    return [];
  }
}

function writeAll(runs: PlaybookRun[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(runs.slice(0, MAX_RUNS)),
    );
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

export function savePlaybookRun(args: {
  topic: string;
  platform: string;
  playbook: SocialPlaybook;
}): PlaybookRun | null {
  if (!args.playbook || typeof args.playbook !== "object") return null;
  const run: PlaybookRun = {
    id: makeId(),
    topic: args.topic,
    platform: args.platform,
    playbook: args.playbook,
    createdAt: new Date().toISOString(),
  };
  const existing = readAll();
  writeAll([run, ...existing]);
  emitChange();
  return run;
}

export function listPlaybookRuns(limit = MAX_RUNS): PlaybookRun[] {
  return readAll().slice(0, limit);
}

export function latestPlaybookRun(): PlaybookRun | null {
  return readAll()[0] ?? null;
}

export function deletePlaybookRun(id: string): void {
  writeAll(readAll().filter((r) => r.id !== id));
  emitChange();
}

export function clearPlaybookRuns(): void {
  writeAll([]);
  emitChange();
}

export const PLAYBOOK_RUNS_CHANGE_EVENT = CHANGE_EVENT;
