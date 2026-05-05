/**
 * Semrush helper for the keyword research feature.
 *
 * Replaces the SE Ranking integration the Replit version used. The two main
 * functions:
 *
 *   - getDomainKeywords(domain, ...) — pulls the domain_organic report
 *     (keywords the domain currently ranks for, with position/volume/etc).
 *     Mirrors the shape the original SE Ranking helper returned so callers
 *     don't have to change.
 *
 *   - getKeywordDifficulty(phrases) — calls phrase_kdi to fill in difficulty
 *     scores when domain_organic doesn't include them.
 *
 * Semrush returns CSV with `;` delimiters. We parse it into typed objects.
 *
 * MarketOS already uses Semrush on the SEO Overview page (Authority 26,
 * 3,595 keywords), so SEMRUSH_API_KEY is already configured in Vercel.
 */

const SEMRUSH_BASE = "https://api.semrush.com/";
const DEFAULT_DOMAIN = "katzmelinger.com";
const DEFAULT_DATABASE = "us"; // NY/NJ market — US database

export type SemrushKeywordRow = {
  keyword: string;
  position: number | null;
  previousPosition: number | null;
  positionDifference: number | null;
  volume: number | null;
  cpc: number | null;
  url: string | null;
  trafficPercent: number | null;
  competition: number | null;
  numberOfResults: number | null;
  difficulty: number | null; // filled in by getKeywordDifficulty if requested
};

function getApiKey(): string {
  const key = process.env.SEMRUSH_API_KEY;
  if (!key) {
    throw new Error(
      "SEMRUSH_API_KEY is not set. Add it to Vercel env vars (and .env.local for dev).",
    );
  }
  return key;
}

/**
 * Parses Semrush CSV (semicolon-delimited, first row is headers).
 * Returns an array of objects keyed by header name.
 */
function parseSemrushCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(";");
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(";");
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function toNum(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Maps a sort key from the original SE Ranking helper to the Semrush
 * display_sort parameter format. Falls back to traffic descending.
 */
function mapSort(
  sortBy: string | undefined,
  sortDir: "asc" | "desc" | undefined,
): string {
  const dir = sortDir === "asc" ? "asc" : "desc";
  const map: Record<string, string> = {
    traffic: `tr_${dir}`,
    position: `po_${dir}`,
    volume: `nq_${dir}`,
    cpc: `cp_${dir}`,
    competition: `co_${dir}`,
  };
  return map[sortBy ?? "traffic"] ?? `tr_${dir}`;
}

/**
 * Pulls the domain_organic report from Semrush — keywords the domain
 * currently ranks for in Google's top 100 organic results.
 *
 * Signature mirrors the original SE Ranking helper so the keywords route
 * doesn't need to change its call site.
 */
export async function getDomainKeywords(
  domain: string | undefined,
  database: string | undefined,
  limit: number = 200,
  offset: number = 0,
  sortBy: string = "traffic",
  sortDir: "asc" | "desc" = "desc",
): Promise<SemrushKeywordRow[]> {
  const key = getApiKey();
  const params = new URLSearchParams({
    type: "domain_organic",
    key,
    domain: domain ?? DEFAULT_DOMAIN,
    database: database ?? DEFAULT_DATABASE,
    display_limit: String(Math.min(Math.max(limit, 1), 1000)),
    display_offset: String(Math.max(offset, 0)),
    display_sort: mapSort(sortBy, sortDir),
    export_columns: "Ph,Po,Pp,Pd,Nq,Cp,Ur,Tr,Tc,Co,Nr,Td",
  });

  const res = await fetch(`${SEMRUSH_BASE}?${params.toString()}`, {
    method: "GET",
    // Semrush is fairly slow; give it room.
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`Semrush API error: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();

  // Semrush returns "ERROR ###" as plain text on failure, not CSV.
  if (text.startsWith("ERROR")) {
    // Empty result is a common case (e.g. tiny domain, niche query) — return [].
    if (/NOTHING\s*FOUND/i.test(text) || /50 ::/.test(text)) return [];
    throw new Error(`Semrush returned: ${text.trim()}`);
  }

  const rows = parseSemrushCsv(text);
  return rows.map((r) => ({
    keyword: r["Keyword"] ?? "",
    position: toNum(r["Position"]),
    previousPosition: toNum(r["Previous Position"]),
    positionDifference: toNum(r["Position Difference"]),
    volume: toNum(r["Search Volume"]),
    cpc: toNum(r["CPC"]),
    url: r["Url"] || null,
    trafficPercent: toNum(r["Traffic (%)"]),
    competition: toNum(r["Competition"]),
    numberOfResults: toNum(r["Number of Results"]),
    difficulty: null, // not in this report — call getKeywordDifficulty to enrich
  }));
}

/**
 * Look up keyword difficulty for one or more phrases via the phrase_kdi
 * endpoint. Returns a map of lowercase keyword -> difficulty (0-100).
 *
 * Semrush charges per phrase, so call this only when difficulty is needed.
 */
export async function getKeywordDifficulty(
  phrases: string[],
  database: string = DEFAULT_DATABASE,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (phrases.length === 0) return out;

  const key = getApiKey();

  // phrase_kdi accepts up to 100 phrases per request, semicolon-separated.
  const chunks: string[][] = [];
  for (let i = 0; i < phrases.length; i += 100) {
    chunks.push(phrases.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    const params = new URLSearchParams({
      type: "phrase_kdi",
      key,
      phrase: chunk.join(";"),
      database,
      export_columns: "Ph,Kd",
    });

    try {
      const res = await fetch(`${SEMRUSH_BASE}?${params.toString()}`, {
        method: "GET",
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) continue;

      const text = await res.text();
      if (text.startsWith("ERROR")) continue;

      const rows = parseSemrushCsv(text);
      for (const r of rows) {
        const phrase = r["Keyword"]?.toLowerCase().trim();
        const kd = toNum(r["Keyword Difficulty Index"]);
        if (phrase && kd !== null) out.set(phrase, kd);
      }
    } catch {
      // skip this chunk, keep going
    }
  }

  return out;
}

/**
 * Convenience: look up a single keyword on the firm's domain. Used by the
 * "add tracked keyword" flow to populate initial position/volume/difficulty.
 */
export async function lookupKeywordRanking(
  keyword: string,
  domain: string = DEFAULT_DOMAIN,
): Promise<{
  currentRank: number | null;
  searchVolume: number | null;
  difficulty: number | null;
  url: string | null;
}> {
  const normalized = keyword.toLowerCase().trim();

  try {
    // Pull a generous slice of the domain's keywords and search locally.
    // Cheaper than a per-keyword API call and matches the original behavior.
    const all = await getDomainKeywords(domain, undefined, 500, 0, "traffic", "desc");

    const exact = all.find((kw) => kw.keyword.toLowerCase().trim() === normalized);
    const partial =
      exact ??
      all.find(
        (kw) =>
          kw.keyword.toLowerCase().includes(normalized) ||
          normalized.includes(kw.keyword.toLowerCase()),
      );

    if (!partial) {
      // Not in the domain's ranking set. Still try to grab volume + KD for the
      // keyword itself so the user sees something useful.
      const kdMap = await getKeywordDifficulty([keyword]);
      const difficulty = kdMap.get(normalized) ?? null;
      return { currentRank: null, searchVolume: null, difficulty, url: null };
    }

    // Enrich with KD if missing.
    let difficulty = partial.difficulty;
    if (difficulty === null) {
      const kdMap = await getKeywordDifficulty([partial.keyword]);
      difficulty = kdMap.get(partial.keyword.toLowerCase().trim()) ?? null;
    }

    return {
      currentRank: partial.position,
      searchVolume: partial.volume,
      difficulty,
      url: partial.url,
    };
  } catch {
    return { currentRank: null, searchVolume: null, difficulty: null, url: null };
  }
}
