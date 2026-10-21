/**
 * Calibrate the quality checks (Oct 20 spec, Task A8) before any of them may
 * block: run them on the katzmelinger.com pages that already perform
 * (Search Console, last 90 days: average position 10 or better, or at least
 * 10 clicks). A check that fails more than 20 percent of those pages has the
 * wrong threshold and must be adjusted before it is turned on.
 *
 *   node scripts/run.mjs scripts/calibrate-quality-checks.ts [--limit 40]
 *
 * Read-only. Writes the report Diana receives to
 * scripts/out/quality-calibration.md. Each page is fetched live, its HTML
 * turned into Markdown headings and paragraphs, split into an article
 * (lib/draft-frame.ts splitDraft) and checked with the page's top query as
 * its keyword. The checks that need DataForSEO (search intent, topic
 * coverage) are left out here: one SERP call per page; run them separately
 * when the budget allows.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const TENANT = process.env.DEFAULT_TENANT_ID || "00000000-0000-0000-0000-000000000001";
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) : 40;

const { gscQueries } = await import("../lib/gsc-queries");
const { splitDraft } = await import("../lib/draft-frame");
const { qualityChecks } = await import("../lib/quality-checks");
const { safeFetch } = await import("../lib/url-safety");

type Row = { query: string; page?: string; clicks: number; impressions: number; position: number };
const g = await gscQueries(TENANT, { days: 90, withPage: true, rowLimit: 5000 });
if (!g.ok) throw new Error(`Search Console: ${g.error}`);
const rows = g.rows as Row[];

// Per page: clicks, impression-weighted position, and the top query by clicks.
const pages = new Map<string, { clicks: number; impr: number; posSum: number; top: Row }>();
for (const r of rows) {
  if (!r.page) continue;
  const p = pages.get(r.page) ?? { clicks: 0, impr: 0, posSum: 0, top: r };
  p.clicks += r.clicks;
  p.impr += r.impressions;
  p.posSum += r.position * r.impressions;
  if (r.clicks > p.top.clicks) p.top = r;
  pages.set(r.page, p);
}
const performing = [...pages]
  .map(([url, p]) => ({ url, clicks: p.clicks, position: p.impr ? p.posSum / p.impr : 99, keyword: p.top.query }))
  .filter((p) => p.position <= 10 || p.clicks >= 10)
  .filter((p) => !/\/(attorney|tag|category|page)\//.test(p.url))
  .sort((a, b) => b.clicks - a.clicks)
  .slice(0, LIMIT);

function htmlToMarkdown(html: string): string {
  const main = html.match(/<(?:main|article)[\s\S]*?<\/(?:main|article)>/i)?.[0] ?? html;
  return main
    .replace(/<(script|style|noscript|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n\n# $1\n\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n### $1\n\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<\/p>|<br\s*\/?>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n");
}

const tally = new Map<string, { label: string; pass: number; total: number; gaps: string[] }>();
let checked = 0;
for (const p of performing) {
  let html = "";
  try {
    const res = await safeFetch(p.url, { timeoutMs: 20_000, headers: { "User-Agent": "Mozilla/5.0 (compatible; HuraqanCalibration/1.0)" } });
    if (!res.ok) continue;
    html = await res.text();
  } catch {
    continue;
  }
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null;
  const { content } = splitDraft(htmlToMarkdown(html), { title });
  const slug = new URL(p.url).pathname;
  const hasFaqSchema = /"@type"\s*:\s*"FAQPage"/.test(html);
  const practice = /collect|judgment|creditor|debt/i.test(p.url) ? "collections" : "employment";
  for (const c of qualityChecks({ content, keyword: p.keyword, metaTitle: title, slug, practice, hasFaqSchema })) {
    const t = tally.get(c.key) ?? { label: c.label, pass: 0, total: 0, gaps: [] };
    t.total++;
    if (c.pass) t.pass++;
    else if (t.gaps.length < 3) t.gaps.push(`${slug}: ${c.gap}`);
    tally.set(c.key, t);
  }
  checked++;
}

const lines = [
  `# Quality check calibration (${new Date().toISOString().slice(0, 10)})`,
  "",
  `Performing pages (Search Console, last 90 days: average position 10 or better, or 10+ clicks): ${performing.length} selected, ${checked} read.`,
  "",
  "A check may block only when it passes at least 80 percent of these pages (Oct 20 spec, Task A8). Until then it is information only.",
  "",
  "| Check | Passes | Rate | Can block? |",
  "| --- | --- | --- | --- |",
  ...[...tally.values()].map((t) => {
    const rate = t.total ? Math.round((t.pass / t.total) * 100) : 0;
    return `| ${t.label} | ${t.pass} of ${t.total} | ${rate}% | ${rate >= 80 ? "yes" : "not yet: threshold to adjust"} |`;
  }),
  "",
  "## Examples of failures on performing pages",
  ...[...tally.values()].flatMap((t) => (t.gaps.length ? ["", `**${t.label}**`, ...t.gaps.map((g2) => `- ${g2}`)] : [])),
  "",
  "Not calibrated here: search intent and People Also Ask coverage (they need one DataForSEO call per page).",
];
mkdirSync("scripts/out", { recursive: true });
writeFileSync("scripts/out/quality-calibration.md", lines.join("\n") + "\n");
console.log(lines.join("\n"));
