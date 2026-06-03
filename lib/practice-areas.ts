/**
 * Practice areas — now DB-backed and editable in-app.
 *
 * The canonical list lives in the `practice_areas` table and is edited on
 * /settings/practice-areas. Use `getPracticeAreas()` (server) or fetch
 * `/api/practice-areas` (client) to read the live list.
 *
 * `DEFAULT_PRACTICE_AREAS` is the seed + fallback used when the table is
 * empty/unreachable. `PRACTICE_AREAS` is kept as an alias for older
 * synchronous imports — prefer the DB-backed accessors for anything new.
 */

import { getSupabaseAdmin } from "./supabase-server";

export const DEFAULT_PRACTICE_AREAS = [
  "Wage & Hour",
  "Discrimination",
  "Class Action",
  "Judgment Enforcement",
  "Severance",
] as const;

/** @deprecated Prefer getPracticeAreas() (live) or DEFAULT_PRACTICE_AREAS. */
export const PRACTICE_AREAS = DEFAULT_PRACTICE_AREAS;

export type PracticeArea = string;

/**
 * Live practice-area labels in display order. Falls back to
 * DEFAULT_PRACTICE_AREAS when the table is empty or unreachable, so callers
 * never get an empty dropdown.
 */
export async function getPracticeAreas(): Promise<string[]> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("practice_areas")
      .select("label")
      .order("sort_order", { ascending: true });
    if (error || !data || data.length === 0) return [...DEFAULT_PRACTICE_AREAS];
    const labels = data
      .map((r) => (typeof r.label === "string" ? r.label.trim() : ""))
      .filter(Boolean);
    return labels.length > 0 ? labels : [...DEFAULT_PRACTICE_AREAS];
  } catch {
    return [...DEFAULT_PRACTICE_AREAS];
  }
}
