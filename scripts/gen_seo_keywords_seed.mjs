/**
 * One-off: parse a Semrush Position Tracking "rankings" CSV export and emit an
 * idempotent SQL seed for public.seo_keywords.
 *
 * Usage: node scripts/gen_seo_keywords_seed.mjs <input.csv> <output.sql>
 *
 * - Semicolon-delimited, with a metadata preamble before the real header.
 * - Pulls the firm's latest-date position + landing URL columns
 *   (*.www.katzmelinger.com/*_<YYYYMMDD> and _landing).
 * - "-" / blank position => NULL (not ranking in top 100).
 */

import { readFileSync, writeFileSync } from "node:fs";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: node gen_seo_keywords_seed.mjs <input.csv> <output.sql>");
  process.exit(1);
}

const raw = readFileSync(inPath, "utf8");
const lines = raw.split(/\r?\n/);

// Minimal semicolon-CSV field splitter that respects double-quoted fields.
function splitRow(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ";") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

// Find the real header row (starts with "Keyword;").
const headerIdx = lines.findIndex((l) => /^Keyword;/i.test(l));
if (headerIdx === -1) {
  console.error("Could not find header row starting with 'Keyword;'");
  process.exit(1);
}
const header = splitRow(lines[headerIdx]);

// Locate the firm's latest position + landing columns.
const posRe = /^\*\.www\.katzmelinger\.com\/\*_(\d{8})$/;
const landingRe = /^\*\.www\.katzmelinger\.com\/\*_(\d{8})_landing$/;
let latestDate = "";
let posCol = -1;
let landingCol = -1;
header.forEach((name, i) => {
  const pm = name.match(posRe);
  if (pm && pm[1] > latestDate) {
    latestDate = pm[1];
    posCol = i;
  }
});
header.forEach((name, i) => {
  const lm = name.match(landingRe);
  if (lm && lm[1] === latestDate) landingCol = i;
});

const kwCol = header.findIndex((h) => /^Keyword$/i.test(h));
const intentCol = header.findIndex((h) => /^Intents?$/i.test(h));

const checkedAt = latestDate
  ? `${latestDate.slice(0, 4)}-${latestDate.slice(4, 6)}-${latestDate.slice(6, 8)}`
  : null;

const sqlEsc = (s) => s.replace(/'/g, "''");
const seen = new Set();
const valueRows = [];

for (let i = headerIdx + 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) continue;
  const cols = splitRow(line);
  const keyword = (cols[kwCol] ?? "").trim();
  if (!keyword) continue;
  const key = keyword.toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);

  const rankRaw = (cols[posCol] ?? "").trim();
  const rankNum = Number.parseInt(rankRaw, 10);
  const rank = Number.isFinite(rankNum) && rankNum > 0 ? String(rankNum) : "NULL";

  const url = (cols[landingCol] ?? "").trim();
  const urlSql = url ? `'${sqlEsc(url)}'` : "NULL";

  const intent = (cols[intentCol] ?? "").trim();
  const note = intent
    ? `Semrush PT import; intent=${intent}`
    : "Semrush PT import";

  valueRows.push(
    `  ('${sqlEsc(keyword)}', ${rank}, ${urlSql}, ${checkedAt ? `'${checkedAt}'::timestamptz` : "NULL"}, '${sqlEsc(note)}')`,
  );
}

const sql = `-- ============================================================================
-- Seed public.seo_keywords from Semrush Position Tracking export
-- Source: ${inPath.split(/[\\/]/).pop()}  |  Period end: ${latestDate}
-- Rows: ${valueRows.length}  |  Idempotent: on conflict (keyword) do nothing
-- ============================================================================
-- Imports the firm's tracked keywords with their latest position + landing URL.
-- search_volume / difficulty are left NULL and filled by the daily refresh cron
-- (/api/seo/tracked-keywords/refresh) or a manual "Refresh" in the tracker.

insert into public.seo_keywords (keyword, current_rank, url, last_checked_at, notes)
values
${valueRows.join(",\n")}
on conflict (keyword) do nothing;
`;

writeFileSync(outPath, sql, "utf8");
console.log(
  `Wrote ${valueRows.length} rows to ${outPath} (posCol=${posCol}, landingCol=${landingCol}, latestDate=${latestDate})`,
);
