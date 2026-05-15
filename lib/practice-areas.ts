/**
 * Canonical list of practice areas used across Content Studio forms,
 * brand-voice scoping, and analytics. Keep this in sync with the dropdown
 * on /content/batch and the practice_areas array stored on content_skills.
 */

export const PRACTICE_AREAS = [
  "General",
  "Wage & Hour",
  "Discrimination",
  "Class Action",
  "Judgment Enforcement",
  "Severance",
] as const;

export type PracticeArea = (typeof PRACTICE_AREAS)[number];
