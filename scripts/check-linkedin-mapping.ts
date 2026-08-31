/**
 * Tests the LinkedIn -> report mapping, which is the half that can be checked
 * without a token.
 *
 *   node scripts/run.mjs scripts/check-linkedin-mapping.ts
 *
 * The network half is scripts/check-linkedin.ts and needs real credentials.
 * Splitting them means the arithmetic — which is where a plausible-looking
 * wrong chart comes from — is verified now rather than after the token arrives.
 */
import { mapFollowerStatistics, toRows } from "@/lib/linkedin-audience";
import { staffCountLabel, urnId, type FollowerStatistics } from "@/lib/linkedin-api";

let pass = 0, fail = 0;
const t = (n: string, c: boolean) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n); } };
const near = (a: number, b: number) => Math.abs(a - b) < 0.15;

const bucket = (key: string, urn: string, organic: number, paid = 0) =>
  ({ [key]: urn, followerCounts: { organicFollowerCount: organic, paidFollowerCount: paid } });

console.log("URN and enum handling:");
t("urn:li:function:1 -> 1", urnId("urn:li:function:1") === "1");
t("a bare value passes through", urnId("SIZE_11_TO_50") === "SIZE_11_TO_50");
t("SIZE_11_TO_50 -> 11-50", staffCountLabel("SIZE_11_TO_50") === "11-50");
t("SIZE_10001_OR_MORE -> 10001+", staffCountLabel("SIZE_10001_OR_MORE") === "10001+");

console.log("\nPercentages are per bucket, not per follower base:");
const fnBuckets = [
  bucket("function", "urn:li:function:1", 300),
  bucket("function", "urn:li:function:2", 100),
];
const r = toRows(fnBuckets, "function", (raw) => ({ "urn:li:function:1": "Legal", "urn:li:function:2": "Sales" })[raw] ?? raw);
t("400 described from two rows", r.described === 400);
t("300/400 -> 75%", near(r.rows[0].pct, 75));
t("100/400 -> 25%", near(r.rows[1].pct, 25));
t("rows sum to 100 even though the base is larger", near(r.rows.reduce((a, x) => a + x.pct, 0), 100));
t("labels resolved", r.rows[0].label === "Legal");

console.log("\nPaid followers count too:");
const withPaid = toRows([bucket("function", "urn:li:function:1", 90, 10)], "function", (x) => x);
t("organic + paid = 100 described", withPaid.described === 100);

console.log("\nThe long tail is folded in, not dropped:");
const many = Array.from({ length: 12 }, (_, i) => bucket("industry", `urn:li:industry:${i}`, 100 - i));
const tail = toRows(many, "industry", (x) => x);
t("caps at 8 rows plus Other", tail.rows.length === 9);
t("last row is Other", tail.rows[8].label === "Other");
t("still sums to ~100", near(tail.rows.reduce((a, x) => a + x.pct, 0), 100));

console.log("\nEmpty and zero inputs do not invent data:");
t("undefined bucket -> no rows", toRows(undefined, "function", (x) => x).rows.length === 0);
t("all-zero counts -> no rows", toRows([bucket("function", "urn:li:function:1", 0)], "function", (x) => x).rows.length === 0);
t("all-zero -> described 0", toRows([bucket("function", "urn:li:function:1", 0)], "function", (x) => x).described === 0);

console.log("\nFull mapping into the report shape:");
const stats: FollowerStatistics = {
  followerCountsByFunction: [bucket("function", "urn:li:function:1", 600), bucket("function", "urn:li:function:2", 400)],
  followerCountsBySeniority: [bucket("seniority", "urn:li:seniority:3", 500)],
  followerCountsByIndustry: [bucket("industry", "urn:li:industry:43", 430)],
  followerCountsByStaffCountRange: [bucket("staffCountRange", "SIZE_11_TO_50", 250)],
  followerCountsByGeoCountry: [bucket("geo", "urn:li:geo:103644278", 800)],
};
const m = mapFollowerStatistics(stats, 2000, {
  functions: { "1": "Legal", "2": "Human Resources" },
  seniorities: { "3": "Manager" },
  industries: { "43": "Law Practice" },
});
t("totalFollowers carried through", m.audience.totalFollowers === 2000);
t("jobFunction mapped", m.audience.jobFunction[0].label === "Legal");
t("seniority mapped", m.audience.seniority[0].label === "Manager");
t("industry mapped", m.audience.industry[0].label === "Law Practice");
t("companySize readable", m.audience.companySize[0].label === "11-50");
t("location present", m.audience.location.length === 1);

console.log("\nCoverage is reported, so a partial breakdown is visible:");
t("industry describes 430 of 2000 -> 21.5%", near(m.coverage.industry.ofFollowers ?? 0, 21.5));
t("jobFunction describes 1000 -> 50%", near(m.coverage.jobFunction.ofFollowers ?? 0, 50));
t("industry rows still sum to 100 within their own bucket", near(m.audience.industry.reduce((a, x) => a + x.pct, 0), 100));

console.log("\nGeography falls back when LinkedIn uses the other shape:");
const viaRegion = mapFollowerStatistics(
  { followerCountsByRegion: [bucket("region", "urn:li:region:84", 120)] }, 500,
);
t("followerCountsByRegion is used when GeoCountry is absent", viaRegion.audience.location.length === 1);

console.log("\nUnresolved labels stay visible as URNs, never blank:");
const unresolved = mapFollowerStatistics(
  { followerCountsByFunction: [bucket("function", "urn:li:function:9", 10)] }, 100,
);
t("a missing label keeps the URN", unresolved.audience.jobFunction[0].label === "urn:li:function:9");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
