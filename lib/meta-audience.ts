/**
 * Instagram follower demographics -> the monthly report's InstagramAudience.
 *
 * Same conversion job as lib/linkedin-audience.ts and the same rule: each
 * distribution is normalised against its OWN sum, not against the follower
 * count. Meta omits followers whose city it cannot determine, so dividing by
 * total followers would under-report every row — a chart that looks plausible
 * and is wrong.
 *
 * ONE CALL, TWO DISTRIBUTIONS
 *
 * The age,gender breakdown returns a cell per combination ("35-44" + "F"), so
 * both the age and the gender distributions come out of it by collapsing the
 * other axis. That is one API call rather than two, and — more usefully — the
 * two charts are guaranteed to agree, because they are the same numbers summed
 * along different edges.
 */

import type { DemoRow, InstagramAudience } from "./social-audience";
import type { BreakdownResult } from "./meta-api";

/** How many rows of each distribution the report shows. */
const TOP_N = 8;

/** Meta's single-letter gender codes. U is "unspecified", not "unknown data". */
const GENDER_LABEL: Record<string, string> = { F: "Women", M: "Men", U: "Unspecified" };

/** ISO-3166 alpha-2 -> a name a reader recognises. */
function countryName(code: string): string {
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    return dn.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/**
 * Turn counted pairs into report rows.
 *
 * Sorted by size, capped, with the remainder folded into "Other" rather than
 * dropped — a distribution whose visible rows sum to 61% invites the reader to
 * assume the rest is missing data.
 *
 * `sortKey` overrides size ordering where sequence carries meaning: age bands
 * read as 18-24, 25-34, 35-44, and sorting those by popularity makes a chart
 * nobody can scan.
 */
export function toRows(
  counts: Map<string, number>,
  opts: { sortKey?: (label: string) => string; cap?: boolean } = {},
): { rows: DemoRow[]; described: number } {
  const entries = [...counts.entries()].filter(([label, n]) => label && n > 0);
  const sum = entries.reduce((a, [, n]) => a + n, 0);
  if (sum === 0) return { rows: [], described: 0 };

  const pct = (n: number) => Math.round((n / sum) * 1000) / 10;

  if (opts.sortKey) {
    const ordered = entries.sort((a, b) => opts.sortKey!(a[0]).localeCompare(opts.sortKey!(b[0])));
    return { rows: ordered.map(([label, n]) => ({ label, pct: pct(n) })), described: sum };
  }

  const ordered = entries.sort((a, b) => b[1] - a[1]);
  if (opts.cap === false) {
    return { rows: ordered.map(([label, n]) => ({ label, pct: pct(n) })), described: sum };
  }
  const head = ordered.slice(0, TOP_N).map(([label, n]) => ({ label, pct: pct(n) }));
  const tail = ordered.slice(TOP_N).reduce((a, [, n]) => a + n, 0);
  if (tail > 0) head.push({ label: "Other", pct: pct(tail) });
  return { rows: head, described: sum };
}

/** Collapse a two-key breakdown along one axis. */
function collapse(results: BreakdownResult[], keep: 0 | 1): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of results) {
    const key = r.dimension_values?.[keep];
    if (!key) continue;
    out.set(key, (out.get(key) ?? 0) + (r.value ?? 0));
  }
  return out;
}

function single(results: BreakdownResult[], label: (v: string) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of results) {
    const key = r.dimension_values?.[0];
    if (!key) continue;
    const name = label(key);
    out.set(name, (out.get(name) ?? 0) + (r.value ?? 0));
  }
  return out;
}

export type MappedInstagram = {
  audience: InstagramAudience;
  coverage: Record<string, { described: number; ofFollowers: number | null }>;
};

export function mapInstagramDemographics(
  input: {
    ageGender: BreakdownResult[];
    city: BreakdownResult[];
    country: BreakdownResult[];
  },
  followers: number | null,
): MappedInstagram {
  // Age bands sort by their own first number, so "5" in "5-12" does not sort
  // after "45-54" the way plain string ordering would put it.
  const ageOrder = (label: string) => String(parseInt(label, 10) || 0).padStart(3, "0");

  const age = toRows(collapse(input.ageGender, 0), { sortKey: ageOrder });
  const gender = toRows(
    new Map(
      [...collapse(input.ageGender, 1)].map(([k, v]) => [GENDER_LABEL[k] ?? k, v] as [string, number]),
    ),
    { cap: false },
  );
  const cities = toRows(single(input.city, (v) => v));
  const countries = toRows(single(input.country, countryName));

  const cov = (r: { described: number }) => ({
    described: r.described,
    ofFollowers: followers ? Math.round((r.described / followers) * 1000) / 10 : null,
  });

  return {
    audience: {
      totalFollowers: followers,
      ageGroups: age.rows,
      gender: gender.rows,
      topCities: cities.rows,
      topCountries: countries.rows,
    },
    coverage: {
      ageGroups: cov(age),
      gender: cov(gender),
      topCities: cov(cities),
      topCountries: cov(countries),
    },
  };
}
