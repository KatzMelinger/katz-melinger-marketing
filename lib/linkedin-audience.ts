/**
 * LinkedIn follower statistics -> the monthly report's LinkedInAudience shape.
 *
 * The report stores every distribution as { label, pct } rows. LinkedIn returns
 * counts, so the conversion happens here, in one pure function that can be
 * tested without a token.
 *
 * WHY PERCENTAGES ARE COMPUTED PER BUCKET
 *
 * Each breakdown has its own total. Followers whose industry LinkedIn does not
 * know are simply absent from followerCountsByIndustry, so that bucket sums to
 * less than the follower count. Dividing every bucket by the overall follower
 * total would quietly under-report every row — a chart that looks plausible and
 * is wrong, which is worse than an empty one. Each distribution is therefore
 * normalised against its own sum, and coverage is reported separately so a
 * reader can see how much of the audience a breakdown actually describes.
 */

import type { DemoRow, LinkedInAudience } from "./social-audience";
import { staffCountLabel, urnId, type FollowerStatistics } from "./linkedin-api";

/** How many rows of each distribution the report shows. */
const TOP_N = 8;

type Bucket = Record<string, unknown> & {
  followerCounts?: { organicFollowerCount?: number; paidFollowerCount?: number };
};

/** Organic + paid. Both are followers of the page. */
function total(b: Bucket): number {
  const c = b.followerCounts ?? {};
  return (c.organicFollowerCount ?? 0) + (c.paidFollowerCount ?? 0);
}

/**
 * Turn one bucket list into report rows.
 *
 * `key` is the field holding the URN or enum; `label` resolves it to something
 * readable. Rows are sorted by size and capped, with the remainder folded into
 * "Other" rather than dropped — a distribution whose visible rows sum to 61%
 * invites the reader to assume the rest is missing data.
 */
export function toRows(
  buckets: Bucket[] | undefined,
  key: string,
  label: (raw: string) => string,
): { rows: DemoRow[]; described: number } {
  if (!buckets?.length) return { rows: [], described: 0 };

  const counted = buckets
    .map((b) => ({ raw: String(b[key] ?? ""), n: total(b) }))
    .filter((x) => x.raw && x.n > 0)
    .sort((a, b) => b.n - a.n);

  const sum = counted.reduce((acc, x) => acc + x.n, 0);
  if (sum === 0) return { rows: [], described: 0 };

  const pct = (n: number) => Math.round((n / sum) * 1000) / 10;
  const head = counted.slice(0, TOP_N).map((x) => ({ label: label(x.raw), pct: pct(x.n) }));

  const tail = counted.slice(TOP_N).reduce((acc, x) => acc + x.n, 0);
  if (tail > 0) head.push({ label: "Other", pct: pct(tail) });

  return { rows: head, described: sum };
}

export type MappedAudience = {
  audience: LinkedInAudience;
  /**
   * How much of the follower base each breakdown actually covers.
   *
   * Surfaced rather than hidden: "industry describes 43% of followers" is a
   * fact a reader of the report should have, and it is the number that explains
   * why two charts disagree.
   */
  coverage: Record<string, { described: number; ofFollowers: number | null }>;
};

export function mapFollowerStatistics(
  stats: FollowerStatistics,
  followers: number | null,
  labels: {
    functions?: Record<string, string>;
    seniorities?: Record<string, string>;
    industries?: Record<string, string>;
    geo?: Record<string, string>;
  } = {},
): MappedAudience {
  const viaMap = (map: Record<string, string> | undefined) => (raw: string) =>
    map?.[urnId(raw)] ?? raw;

  const fn = toRows(stats.followerCountsByFunction, "function", viaMap(labels.functions));
  const sen = toRows(stats.followerCountsBySeniority, "seniority", viaMap(labels.seniorities));
  const ind = toRows(stats.followerCountsByIndustry, "industry", viaMap(labels.industries));
  const size = toRows(stats.followerCountsByStaffCountRange, "staffCountRange", staffCountLabel);

  // Metro areas, not countries. followerCountsByGeoCountry exists and is 93.7%
  // "United States", which tells a New York employment firm nothing;
  // followerCountsByGeo resolves to "New York City Metropolitan Area, 1,267",
  // which is the number the report is actually for. Country data is the
  // fallback when the finer breakdown is absent.
  const geoBuckets = stats.followerCountsByGeo ?? stats.followerCountsByGeoCountry ?? stats.followerCountsByRegion;
  const geoKey = stats.followerCountsByGeo ? "geo" : stats.followerCountsByGeoCountry ? "geo" : "region";
  const loc = toRows(geoBuckets, geoKey, viaMap(labels.geo));
  const cov = (r: { described: number }) => ({
    described: r.described,
    ofFollowers: followers ? Math.round((r.described / followers) * 1000) / 10 : null,
  });

  return {
    audience: {
      totalFollowers: followers,
      jobFunction: fn.rows,
      seniority: sen.rows,
      industry: ind.rows,
      companySize: size.rows,
      location: loc.rows,
    },
    coverage: {
      jobFunction: cov(fn),
      seniority: cov(sen),
      industry: cov(ind),
      companySize: cov(size),
      location: cov(loc),
    },
  };
}
