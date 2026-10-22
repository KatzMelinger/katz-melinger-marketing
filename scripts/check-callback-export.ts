/**
 * Oct 20 spec, Task A19: the Needs callback export. Phone format, CSV
 * quoting, the 8 AM New York gate in both daylight and standard time, and a
 * PDF that is a well-formed file with one page per screenful of callers.
 *
 *   node scripts/run.mjs scripts/check-callback-export.ts
 */
import { callbacksCsv, callbacksPdf, formatPhone, nyHour, parseRecipients, type CallbackRow } from "../lib/callback-export";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

check("phone 10 digits", formatPhone("2124600047") === "212-460-0047");
check("phone with country code", formatPhone("+1 (212) 460-0047") === "212-460-0047");

// 8 AM New York: 12:00 UTC in daylight time, 13:00 UTC in standard time.
check("8 AM in July is 12:00 UTC", nyHour(Date.parse("2026-07-15T12:00:00Z")) === 8);
check("8 AM in January is 13:00 UTC", nyHour(Date.parse("2026-01-15T13:00:00Z")) === 8);
check("13:00 UTC in July is 9 AM", nyHour(Date.parse("2026-07-15T13:00:00Z")) === 9);

check("recipients from a comma list", parseRecipients("A@x.com, b@y.com,nope").join("|") === "a@x.com|b@y.com");

const row = (i: number): CallbackRow => ({
  phone: "2125550100",
  displayPhone: "(212) 555-0100",
  name: i === 0 ? 'Smith, "Jo"' : `Caller ${i}`,
  lastTry: "2026-10-20T11:54:00Z",
  tries: 2,
  source: "Google Organic",
  firstTime: i % 2 === 0,
  lastStatus: i % 3 === 0 ? "Voicemail" : "Missed",
  notes: null,
  language: "en",
});
const rows = Array.from({ length: 60 }, (_, i) => row(i));
const csv = callbacksCsv(rows);
check("CSV quotes commas and quotes", csv.split("\r\n")[1].startsWith('"Smith, ""Jo""",212-555-0100,'));
check("CSV header row", csv.startsWith("Name,Phone,Last attempt,Result,Tries,Source,Caller,Done,Notes\r\n"));
check("CSV last attempt is New York time", csv.includes("Oct 20, 2026, 7:54 AM") || csv.includes("Oct 20, 2026 7:54 AM"));

const pdf = callbacksPdf(rows, { from: "2026-10-01", to: "2026-10-20" }).toString("latin1");
const pages = (pdf.match(/\/Type \/Page /g) ?? []).length;
check("PDF header and trailer", pdf.startsWith("%PDF-1.4") && pdf.trimEnd().endsWith("%%EOF"));
check("PDF splits 60 callers over 3 pages", pages === 3, `${pages} pages`);
const xref = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
check("PDF xref offset points at the xref table", pdf.slice(xref, xref + 4) === "xref");
const empty = callbacksPdf([], { from: "2026-10-01", to: "2026-10-20" }).toString("latin1");
check("an empty list still makes a one-page PDF", (empty.match(/\/Type \/Page /g) ?? []).length === 1 && empty.includes("Nobody is waiting"));

console.log(failed ? `\n${failed} failed` : "\nAll passed");
process.exit(failed ? 1 : 0);
