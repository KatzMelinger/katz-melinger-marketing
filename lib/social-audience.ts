/**
 * Curated Monthly-Report audience demographics (Sections 5-6).
 *
 * Pure types + validation, NO server imports — safe to import from both the
 * client report page and the server route. Stored in
 * social_insights.report_audience as JSON. Every distribution is a list of
 * { label, pct } rows; `totalFollowers` is the platform's current audience size.
 */

export type DemoRow = { label: string; pct: number };

export type InstagramAudience = {
  totalFollowers: number | null;
  ageGroups: DemoRow[];
  gender: DemoRow[];
  topCities: DemoRow[];
  topCountries: DemoRow[];
};

export type LinkedInAudience = {
  totalFollowers: number | null;
  jobFunction: DemoRow[];
  seniority: DemoRow[];
  industry: DemoRow[];
  companySize: DemoRow[];
  location: DemoRow[];
};

export type ReportAudience = {
  instagram: InstagramAudience;
  linkedin: LinkedInAudience;
};

export const EMPTY_AUDIENCE: ReportAudience = {
  instagram: { totalFollowers: null, ageGroups: [], gender: [], topCities: [], topCountries: [] },
  linkedin: { totalFollowers: null, jobFunction: [], seniority: [], industry: [], companySize: [], location: [] },
};

// The label/pct lists on each platform, so validation can iterate generically.
const IG_LISTS = ["ageGroups", "gender", "topCities", "topCountries"] as const;
const LI_LISTS = ["jobFunction", "seniority", "industry", "companySize", "location"] as const;

function rows(raw: unknown): DemoRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const rec = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
      // Accept `label` or legacy `name` as the row key.
      const label = String(rec.label ?? rec.name ?? "").slice(0, 80);
      const pct = Number(rec.pct);
      return { label, pct: Number.isFinite(pct) ? pct : 0 };
    })
    .filter((r) => r.label);
}

function followers(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Coerce arbitrary input into a valid, fully-populated ReportAudience. */
export function sanitizeAudience(raw: unknown): ReportAudience {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ig = (o.instagram && typeof o.instagram === "object" ? o.instagram : {}) as Record<string, unknown>;
  const li = (o.linkedin && typeof o.linkedin === "object" ? o.linkedin : {}) as Record<string, unknown>;

  const instagram = { totalFollowers: followers(ig.totalFollowers) } as InstagramAudience;
  for (const k of IG_LISTS) instagram[k] = rows(ig[k]);

  const linkedin = { totalFollowers: followers(li.totalFollowers) } as LinkedInAudience;
  for (const k of LI_LISTS) linkedin[k] = rows(li[k]);

  return { instagram, linkedin };
}
