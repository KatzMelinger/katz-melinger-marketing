/**
 * The /calls stat cards, source table and "needs callback" list, checked on
 * fixture rows (Diana's spec section 8).
 *
 *   node scripts/run.mjs scripts/check-calls-stats.ts
 *
 * Read-only, no DB. The rows below are shaped like what /api/calls returns.
 */
import {
  bySource,
  callStatus,
  computeCallStats,
  firmLocalDayEndExclusiveUTC,
  firmLocalDayStartUTC,
  monthToDate,
  needsCallback,
  sourceLabel,
  type CallStatsRow,
  type RecoveryRow,
} from "../lib/calls-stats";

const NOW = Date.parse("2026-09-29T16:00:00Z"); // noon in New York
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const daysAgo = (d: number) => minsAgo(d * 24 * 60);

let n = 0;
const row = (over: Partial<CallStatsRow>): CallStatsRow => ({
  id: `c${++n}`,
  customer_name: null,
  customer_phone_number: null,
  source_name: "Website pool",
  marketing_source: null,
  call_type: null,
  duration: 0,
  answered: false,
  voicemail: false,
  direction: "inbound",
  start_time: daysAgo(1),
  first_call: false,
  score: null,
  ...over,
});

const RANGE: CallStatsRow[] = [
  row({ answered: true, duration: 120, marketing_source: "Google Organic", score: { overall_score: 80 } }),
  row({ answered: true, duration: 60, marketing_source: "Google Organic", score: { overall_score: 90 } }),
  row({ answered: true, duration: 300, marketing_source: "SearchGPT" }),
  row({ voicemail: true, answered: true, duration: 40, marketing_source: "Google Organic" }),
  row({ marketing_source: "Direct" }), // missed
  row({ call_type: "abandoned", marketing_source: "Direct" }), // missed
  row({ call_type: "in_progress", start_time: minsAgo(5), marketing_source: "Direct" }), // ringing
  row({ call_type: "in_progress", start_time: minsAgo(45) }), // stale in_progress -> missed
  row({ start_time: minsAgo(10) }), // no call_type, fresh, no duration -> ringing
  row({ answered: true, duration: 30, direction: "outbound", marketing_source: "Direct" }),
];

let failed = 0;
const report = (ok: boolean, line: string) => {
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${line}`);
};
const eq = (got: unknown, want: unknown, what: string) =>
  report(JSON.stringify(got) === JSON.stringify(want), `${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

console.log("-- status ---------------------------------------------------------");
eq(callStatus(RANGE[6], NOW), "In progress", "in_progress under 30 min");
eq(callStatus(RANGE[7], NOW), "Missed", "in_progress over 30 min");
eq(callStatus(RANGE[8], NOW), "In progress", "derived ringing (no call_type)");
eq(callStatus(row({ start_time: minsAgo(31) }), NOW), "Missed", "derived, 31 min old");
eq(callStatus(row({ call_type: "voicemail_transcription" }), NOW), "Voicemail", "voicemail_transcription");
eq(callStatus(row({ call_type: "abandonded" }), NOW), "Missed", "CallRail's own 'abandonded' spelling");

console.log("\n-- stat cards (8.1) -----------------------------------------------");
const stats = computeCallStats(RANGE, NOW);
eq(
  [stats.total, stats.answered, stats.voicemail, stats.missed, stats.inProgress],
  [10, 4, 1, 3, 2],
  "total / answered / VM / missed / ringing",
);
eq(stats.answeredRatePct, 40, "answered rate");
eq(stats.avgScore, 85, "avg score");
eq(stats.scored, 2, "scored count");
// The regression: the cards must not depend on the table's status filter. The
// page passes the whole range; prove that a filtered list WOULD have moved it.
const onlyMissed = RANGE.filter((r) => callStatus(r, NOW) === "Missed");
report(
  computeCallStats(onlyMissed, NOW).answeredRatePct !== stats.answeredRatePct,
  "a status-filtered list gives a different rate, so the cards must use the full range",
);

console.log("\n-- source labels + by-source table (8.3) --------------------------");
eq(sourceLabel({ marketing_source: "SearchGPT", source_name: "Website pool" }), "SearchGPT", "marketing source wins");
eq(sourceLabel({ marketing_source: "  ", source_name: "Website pool" }), "(tracking line) Website pool", "fallback");
eq(sourceLabel({ marketing_source: null, source_name: null }), "Unknown", "nothing");
const src = bySource(RANGE, NOW);
const direct = src.find((s) => s.source === "Direct");
eq(direct && [direct.calls, direct.answered, direct.unanswered, direct.unansweredPct], [3, 0, 2, 66.7], "Direct (outbound excluded, ringing not unanswered)");
const organic = src.find((s) => s.source === "Google Organic");
eq(organic && [organic.calls, organic.unanswered, organic.unansweredPct], [3, 1, 33.3], "Google Organic (VM is unanswered)");
eq(src.reduce((s, r) => s + r.calls, 0), 9, "inbound total");

console.log("\n-- needs callback (8.4) -------------------------------------------");
const CB: CallStatsRow[] = [
  // A: two missed tries, never answered, first-time caller -> listed, tries 2
  row({ customer_name: "Ana", customer_phone_number: "(212) 555-0101", start_time: daysAgo(3), first_call: true, marketing_source: "Google Organic" }),
  row({ customer_name: "Ana", customer_phone_number: "+1 212-555-0101", start_time: daysAgo(2), marketing_source: "SearchGPT" }),
  // B: missed then answered later -> NOT listed
  row({ customer_phone_number: "2125550102", start_time: daysAgo(3) }),
  row({ customer_phone_number: "2125550102", start_time: daysAgo(2), answered: true, duration: 90 }),
  // C: answered, then voicemail -> listed (repeat), tries 1
  row({ customer_name: "Carl", customer_phone_number: "2125550103", start_time: daysAgo(5), answered: true, duration: 200 }),
  row({ customer_name: "Carl", customer_phone_number: "2125550103", start_time: daysAgo(1.5), voicemail: true, answered: true }),
  // D: missed, then the firm called back and got through (outbound answered) -> NOT listed
  row({ customer_phone_number: "2125550104", start_time: daysAgo(2) }),
  row({ customer_phone_number: "2125550104", start_time: daysAgo(1), direction: "outbound", answered: true, duration: 60 }),
  // E: missed, marked reached AFTER it -> NOT listed
  row({ customer_phone_number: "2125550105", start_time: daysAgo(4) }),
  // F: marked reached BEFORE the latest miss -> listed again
  row({ customer_phone_number: "2125550106", start_time: daysAgo(1) }),
  // G: still ringing -> NOT listed yet
  row({ customer_phone_number: "2125550107", start_time: minsAgo(3), call_type: "in_progress" }),
  // H: no usable phone -> ignored
  row({ customer_phone_number: "anonymous", start_time: daysAgo(1) }),
];
const recovery = new Map<string, RecoveryRow>([
  ["2125550105", { phone: "2125550105", status: "reached", last_action_at: daysAgo(3) }],
  ["2125550106", { phone: "2125550106", status: "reached", last_action_at: daysAgo(10) }],
]);
const list = needsCallback(CB, recovery, NOW);
eq(list.map((c) => c.phone).sort(), ["2125550101", "2125550103", "2125550106"], "who is listed");
const ana = list.find((c) => c.phone === "2125550101");
eq(ana && [ana.name, ana.tries, ana.firstTime, ana.source, ana.lastStatus], ["Ana", 2, true, "SearchGPT", "Missed"], "Ana");
const carl = list.find((c) => c.phone === "2125550103");
eq(carl && [carl.tries, carl.firstTime, carl.lastStatus], [1, false, "Voicemail"], "Carl (repeat, VM)");
eq(list[0].phone, "2125550106", "newest last try first");

console.log("\n-- firm-local dates (8.2) -----------------------------------------");
eq(monthToDate(NOW), { from: "2026-09-01", to: "2026-09-29" }, "month to date");
eq(monthToDate(Date.parse("2026-10-01T02:00:00Z")), { from: "2026-09-01", to: "2026-09-30" }, "10pm Sept 30 in NY is still September");
eq(firmLocalDayStartUTC("2026-09-01"), "2026-09-01T04:00:00.000Z", "day start (EDT)");
eq(firmLocalDayEndExclusiveUTC("2026-09-29"), "2026-09-30T04:00:00.000Z", "day end exclusive");
eq(firmLocalDayStartUTC("2026-12-01"), "2026-12-01T05:00:00.000Z", "day start (EST)");

console.log(failed === 0 ? "\nall cases pass" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
