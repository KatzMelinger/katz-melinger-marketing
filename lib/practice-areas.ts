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

// NOTE: keep this module free of server-only imports (next/headers, Supabase) —
// it's imported by client components for the constants below. The DB-backed
// accessor lives in lib/practice-areas-store.ts (server-only).

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

// getPracticeAreas() now lives in lib/practice-areas-store.ts (server-only).
