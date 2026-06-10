/**
 * Throwaway parity check: Semrush vs DataForSEO for katzmelinger.com.
 *
 * Pulls Semrush's top organic keywords for the domain, then looks up the same
 * keywords in DataForSEO (rank, volume, difficulty) and prints them side by
 * side so we can eyeball whether DataForSEO's data holds up before repointing
 * any production code.
 *
 * Run from the project root:
 *   node --env-file=.env.local scripts/dataforseo-parity.mjs
 *
 * Costs a few Semrush units + a few cents of DataForSEO balance.
 */

const DOMAIN = "katzmelinger.com";
const TOP_N = 10;
const LOCATION_CODE = 2840; // United States
const LANGUAGE_CODE = "en";

const SEMRUSH_KEY = process.env.SEMRUSH_API_KEY;
const DFS_LOGIN = process.env.DATAFORSEO_LOGIN;
const DFS_PASSWORD = process.env.DATAFORSEO_PASSWORD;

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

if (!SEMRUSH_KEY) die("SEMRUSH_API_KEY not set (run with --env-file=.env.local)");
if (!DFS_LOGIN || !DFS_PASSWORD) die("DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not set");

// ---------------------------------------------------------------------------
// Semrush — domain_organic, top N by traffic
// ---------------------------------------------------------------------------
async function semrushTopKeywords() {
  const params = new URLSearchParams({
    type: "domain_organic",
    key: SEMRUSH_KEY,
    domain: DOMAIN,
    database: "us",
    display_limit: String(TOP_N),
    display_sort: "tr_desc",
    export_columns: "Ph,Po,Nq,Cp,Ur",
  });
  const res = await fetch(`https://api.semrush.com/?${params}`);
  const text = await res.text();
  if (text.startsWith("ERROR")) die(`Semrush error: ${text.trim()}`);
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(";");
  return lines.slice(1).map((line) => {
    const cols = line.split(";");
    const row = {};
    headers.forEach((h, i) => (row[h] = cols[i] ?? ""));
    return {
      keyword: row["Keyword"],
      position: Number(row["Position"]) || null,
      volume: Number(row["Search Volume"]) || null,
      cpc: Number(row["CPC"]) || null,
    };
  });
}

// ---------------------------------------------------------------------------
// DataForSEO — POST helper
// ---------------------------------------------------------------------------
async function dfsPost(path, payload) {
  const auth = "Basic " + Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString("base64");
  const res = await fetch(`https://api.dataforseo.com/v3/${path}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify([payload]),
  });
  const json = await res.json();
  if (json.status_code !== 20000) die(`DataForSEO envelope error: ${json.status_message}`);
  const task = json.tasks?.[0];
  if (task?.status_code !== 20000) die(`DataForSEO task error: ${task?.status_message}`);
  return task.result?.[0]?.items ?? [];
}

async function dfsRankedMap() {
  const items = await dfsPost("dataforseo_labs/google/ranked_keywords/live", {
    target: DOMAIN,
    location_code: LOCATION_CODE,
    language_code: LANGUAGE_CODE,
    limit: 1000,
    order_by: ["ranked_serp_element.serp_item.rank_group,asc"],
    filters: [["ranked_serp_element.serp_item.type", "=", "organic"]],
  });
  const map = new Map();
  for (const it of items) {
    const kw = (it?.keyword_data?.keyword ?? "").toLowerCase().trim();
    if (!kw) continue;
    map.set(kw, {
      rank: it?.ranked_serp_element?.serp_item?.rank_group ?? null,
      volume: it?.keyword_data?.keyword_info?.search_volume ?? null,
      difficulty: it?.keyword_data?.keyword_properties?.keyword_difficulty ?? null,
    });
  }
  return map;
}

async function dfsOverviewMap(keywords) {
  const items = await dfsPost("dataforseo_labs/google/keyword_overview/live", {
    keywords,
    location_code: LOCATION_CODE,
    language_code: LANGUAGE_CODE,
  });
  const map = new Map();
  for (const it of items) {
    const kw = (it?.keyword ?? "").toLowerCase().trim();
    if (!kw) continue;
    map.set(kw, {
      volume: it?.keyword_info?.search_volume ?? null,
      cpc: it?.keyword_info?.cpc ?? null,
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Compare + print
// ---------------------------------------------------------------------------
function pad(s, n) {
  s = String(s ?? "—");
  return s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n);
}

async function main() {
  console.log(`\nParity check — ${DOMAIN} — top ${TOP_N} Semrush organic keywords\n`);

  const sr = await semrushTopKeywords();
  if (!sr.length) die("Semrush returned no keywords for this domain.");

  const [ranked, overview] = await Promise.all([
    dfsRankedMap(),
    dfsOverviewMap(sr.map((r) => r.keyword)),
  ]);

  console.log(
    pad("keyword", 34) +
      pad("SR pos", 8) +
      pad("DFS pos", 9) +
      pad("SR vol", 9) +
      pad("DFS vol", 9) +
      pad("DFS KD", 7),
  );
  console.log("-".repeat(76));

  let rankMatches = 0;
  let bothRanked = 0;
  for (const row of sr) {
    const k = row.keyword.toLowerCase().trim();
    const d = ranked.get(k);
    const o = overview.get(k);
    const dfsPos = d?.rank ?? null;
    const dfsVol = d?.volume ?? o?.volume ?? null;
    const dfsKd = d?.difficulty ?? null;

    if (row.position != null && dfsPos != null) {
      bothRanked++;
      if (Math.abs(row.position - dfsPos) <= 3) rankMatches++;
    }

    console.log(
      pad(row.keyword, 34) +
        pad(row.position, 8) +
        pad(dfsPos, 9) +
        pad(row.volume, 9) +
        pad(dfsVol, 9) +
        pad(dfsKd, 7),
    );
  }

  console.log("-".repeat(76));
  console.log(
    `\nRank agreement (within ±3 positions): ${rankMatches}/${bothRanked} keywords both sources ranked.`,
  );
  console.log(
    "Volumes will differ somewhat (different data sources) — look for same order of magnitude.\n",
  );
}

main().catch((e) => die(e?.stack || String(e)));
