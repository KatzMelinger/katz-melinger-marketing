/**
 * System health (Oct 20 spec, Task A17), the pure parts, checked offline.
 *
 *   node scripts/run.mjs scripts/check-system-health.ts
 */
import { nextRun, previousRun, scheduledHealth, SCHEDULES } from "../lib/system-health";
import { estimateCents } from "../lib/ai-cost";
import type { JobRunRow } from "../lib/job-runs";

let failed = 0;
const check = (ok: boolean, what: string, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${what}${ok || !extra ? "" : `\n        ${extra}`}`);
};

const at = new Date("2026-10-21T10:30:00Z"); // a Wednesday
check(nextRun("0 * * * *", at)?.toISOString() === "2026-10-21T11:00:00.000Z", "hourly: next is the top of the hour");
check(nextRun("0 12 * * 1", at)?.toISOString() === "2026-10-26T12:00:00.000Z", "weekly Monday noon");
check(nextRun("0 13 * * 1-5", new Date("2026-10-23T14:00:00Z"))?.toISOString() === "2026-10-26T13:00:00.000Z", "weekdays: Friday afternoon -> Monday");
check(previousRun("0 */6 * * *", at)?.toISOString() === "2026-10-21T06:00:00.000Z", "every 6 hours: the last run");
check(nextRun("0 7 1 * *", at)?.toISOString() === "2026-11-01T07:00:00.000Z", "monthly on the 1st");
check(SCHEDULES.length >= 22 && SCHEDULES.some((s) => s.job === "/api/system/watchdog"), "every vercel.json job is listed, the watchdog included");

const run = (o: Partial<JobRunRow>): JobRunRow => ({ id: "x", job: "/api/calls/sync", started_at: "2026-10-21T10:00:05Z", finished_at: "2026-10-21T10:01:00Z", status: "ok", http_status: 200, error: null, duration_ms: 1, trigger: "cron", alerted: false, ...o });
check(scheduledHealth("/api/calls/sync", "0 * * * *", [run({})], at).problem === null, "ran at 10:00, checked 10:30: healthy");
check(/Missed/.test(scheduledHealth("/api/calls/sync", "0 * * * *", [run({ started_at: "2026-10-21T08:00:05Z" })], new Date("2026-10-21T10:30:00Z")).problem ?? ""), "last run 08:00, checked 10:30: missed");
check(/failed/.test(scheduledHealth("/api/calls/sync", "0 * * * *", [run({ status: "failed", error: "504" })], at).problem ?? ""), "a failed last run is a problem");
check(/2 hours/.test(scheduledHealth("/api/calls/sync", "0 * * * *", [run({ status: "running", started_at: "2026-10-21T07:00:00Z" })], at).problem ?? ""), "running over 2 hours is a problem");

check(estimateCents("claude-sonnet-4-5", { input_tokens: 1_000_000, output_tokens: 0 }) === 300, "Sonnet input: $3 per million tokens");
check(estimateCents("claude-haiku-4-5", { input_tokens: 0, output_tokens: 1_000_000 }) === 500, "Haiku output: $5 per million tokens");

console.log(failed === 0 ? "\nall passed" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
