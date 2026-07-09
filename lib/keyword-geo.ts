/**
 * Keyword geo classifier — used by /seo/keywords + /seo/keywords/competitive
 * to filter DataForSEO data down to NY/NJ-relevant keywords (and slice by city).
 *
 * DataForSEO returns US-wide rankings; for a NY/NJ-only firm, anything mentioning
 * a non-target state is incidental noise. This classifier:
 *
 *   - Tags each keyword with a state ("ny", "nj", "other", or null)
 *   - Tags it with a region (nyc, long_island, westchester, north_nj, etc)
 *   - Returns the matched city term so the UI can show a badge
 */

export type KeywordRegion =
  | "nyc"            // any of the 5 boroughs
  | "long_island"    // Nassau / Suffolk / LI
  | "westchester"    // Westchester county / Yonkers / White Plains
  | "upstate_ny"     // Buffalo, Rochester, Albany, Syracuse, etc.
  | "north_nj"       // Newark, Jersey City, Hoboken, Paterson, etc.
  | "central_nj"     // New Brunswick, Trenton, Princeton
  | "south_nj"       // Camden, Cherry Hill, Atlantic City
  | null;

export type KeywordState = "ny" | "nj" | "other_state" | null;

export type KeywordGeo = {
  state: KeywordState;
  region: KeywordRegion;
  city: string | null;
};

// --- City → region mapping. ---
// First match wins. Each entry is a list of substring matches against the
// lowercased keyword (with a leading + trailing space wrapper to enforce
// word boundaries on short tokens like " ny ").

const NYC_BOROUGHS: { city: string; matches: string[] }[] = [
  { city: "Manhattan", matches: ["manhattan"] },
  { city: "Brooklyn", matches: ["brooklyn"] },
  { city: "Queens", matches: [" queens "] },
  { city: "Bronx", matches: [" bronx "] },
  { city: "Staten Island", matches: ["staten island"] },
  { city: "NYC", matches: ["nyc", "new york city"] },
];

const LONG_ISLAND: { city: string; matches: string[] }[] = [
  { city: "Long Island", matches: ["long island"] },
  { city: "Nassau", matches: ["nassau"] },
  { city: "Suffolk", matches: ["suffolk"] },
];

const WESTCHESTER: { city: string; matches: string[] }[] = [
  { city: "Westchester", matches: ["westchester"] },
  { city: "Yonkers", matches: ["yonkers"] },
  { city: "White Plains", matches: ["white plains"] },
  { city: "New Rochelle", matches: ["new rochelle"] },
];

const UPSTATE_NY: { city: string; matches: string[] }[] = [
  { city: "Albany", matches: ["albany"] },
  { city: "Buffalo", matches: ["buffalo"] },
  { city: "Rochester", matches: ["rochester"] },
  { city: "Syracuse", matches: ["syracuse"] },
];

const NORTH_NJ: { city: string; matches: string[] }[] = [
  { city: "Newark", matches: ["newark"] },
  { city: "Jersey City", matches: ["jersey city"] },
  { city: "Hoboken", matches: ["hoboken"] },
  { city: "Paterson", matches: ["paterson"] },
  { city: "Elizabeth", matches: ["elizabeth nj"] },
  { city: "Bergen", matches: ["bergen county"] },
  { city: "Essex", matches: ["essex county"] },
];

const CENTRAL_NJ: { city: string; matches: string[] }[] = [
  { city: "New Brunswick", matches: ["new brunswick"] },
  { city: "Trenton", matches: ["trenton"] },
  { city: "Princeton", matches: ["princeton"] },
  { city: "Edison", matches: ["edison nj"] },
];

const SOUTH_NJ: { city: string; matches: string[] }[] = [
  { city: "Camden", matches: ["camden"] },
  { city: "Cherry Hill", matches: ["cherry hill"] },
  { city: "Atlantic City", matches: ["atlantic city"] },
];

// Generic "in NY" / "in NJ" matchers as fallbacks when no city is named.
const NY_GENERIC = [" ny ", " ny,", " ny.", " new york", "new york state"];
const NJ_GENERIC = [" nj ", " nj,", " nj.", " new jersey"];

// Out-of-state matchers (any state name, common abbreviations with word
// boundaries, and major metro names not in NY/NJ).
const OTHER_STATE_TERMS = [
  // States
  "california", "texas", "florida", "illinois", "massachusetts",
  "pennsylvania", "ohio", "michigan", "georgia", "north carolina",
  "south carolina", "washington", "colorado", "arizona", "nevada",
  "oregon", "minnesota", "wisconsin", "missouri", "tennessee",
  "virginia", "maryland", "kentucky", "indiana", "louisiana",
  "alabama", "mississippi", "arkansas", "oklahoma", "kansas",
  "iowa", "utah", "new mexico", "connecticut", "hawaii", "alaska",
  // State abbreviations with word boundaries
  " ca ", " ca,", " ca.", " tx ", " fl ", " il ", " ma ", " pa ",
  " oh ", " mi ", " ga ", " nc ", " sc ", " wa ", " co ", " az ",
  " nv ", " or ", " mn ", " wi ", " mo ", " tn ", " va ", " md ",
  " ky ", " in ", " la ", " al ", " ms ", " ar ", " ok ", " ks ",
  " ia ", " ut ", " nm ", " ct ", " hi ", " ak ",
  // Major non-NY/NJ metros
  "los angeles", "san francisco", "san diego", "oakland",
  "houston", "dallas", "austin", "san antonio",
  "miami", "orlando", "tampa", "jacksonville",
  "chicago", "boston", "philadelphia", "pittsburgh",
  "cleveland", "columbus", "detroit", "atlanta",
  "charlotte", "raleigh", "seattle", "denver", "phoenix",
  "las vegas", "portland", "minneapolis", "milwaukee",
  "nashville", "memphis", "richmond", "baltimore",
];

function matchAny(haystack: string, table: { city: string; matches: string[] }[]): { city: string } | null {
  for (const entry of table) {
    for (const m of entry.matches) {
      if (haystack.includes(m)) return { city: entry.city };
    }
  }
  return null;
}

export function classifyKeywordGeo(keyword: string): KeywordGeo {
  // Pad with spaces so " ny " word-boundary matches work on edges.
  const lc = " " + keyword.toLowerCase() + " ";

  // NYC + Long Island + Westchester all imply NY state.
  const nycMatch = matchAny(lc, NYC_BOROUGHS);
  if (nycMatch) return { state: "ny", region: "nyc", city: nycMatch.city };

  const liMatch = matchAny(lc, LONG_ISLAND);
  if (liMatch) return { state: "ny", region: "long_island", city: liMatch.city };

  const wcMatch = matchAny(lc, WESTCHESTER);
  if (wcMatch) return { state: "ny", region: "westchester", city: wcMatch.city };

  const upstateMatch = matchAny(lc, UPSTATE_NY);
  if (upstateMatch) return { state: "ny", region: "upstate_ny", city: upstateMatch.city };

  // NJ regions.
  const njNorthMatch = matchAny(lc, NORTH_NJ);
  if (njNorthMatch) return { state: "nj", region: "north_nj", city: njNorthMatch.city };

  const njCentralMatch = matchAny(lc, CENTRAL_NJ);
  if (njCentralMatch) return { state: "nj", region: "central_nj", city: njCentralMatch.city };

  const njSouthMatch = matchAny(lc, SOUTH_NJ);
  if (njSouthMatch) return { state: "nj", region: "south_nj", city: njSouthMatch.city };

  // Generic state mention without a specific city.
  if (NY_GENERIC.some((t) => lc.includes(t))) {
    return { state: "ny", region: null, city: null };
  }
  if (NJ_GENERIC.some((t) => lc.includes(t))) {
    return { state: "nj", region: null, city: null };
  }

  // Other states.
  if (OTHER_STATE_TERMS.some((t) => lc.includes(t))) {
    return { state: "other_state", region: null, city: null };
  }

  // No geo at all — generic legal term.
  return { state: null, region: null, city: null };
}

// --- UI helpers exported so pages share consistent option labels ---

export const STATE_FILTER_OPTIONS = [
  { value: "all", label: "All keywords" },
  { value: "ny_nj_and_generic", label: "NY/NJ + generic (default)" },
  { value: "ny_only", label: "NY only" },
  { value: "nj_only", label: "NJ only" },
  { value: "ny_nj_only", label: "NY + NJ only" },
  { value: "generic_only", label: "Generic only (no geo)" },
  { value: "other_state", label: "Other state (debug)" },
] as const;

export const REGION_FILTER_OPTIONS = [
  { value: "all", label: "All regions" },
  { value: "nyc", label: "NYC (all 5 boroughs)" },
  { value: "long_island", label: "Long Island" },
  { value: "westchester", label: "Westchester" },
  { value: "upstate_ny", label: "Upstate NY" },
  { value: "north_nj", label: "Northern NJ" },
  { value: "central_nj", label: "Central NJ" },
  { value: "south_nj", label: "Southern NJ" },
] as const;

export type StateFilter = (typeof STATE_FILTER_OPTIONS)[number]["value"];
export type RegionFilter = (typeof REGION_FILTER_OPTIONS)[number]["value"];

export function passesGeoFilter(
  geo: KeywordGeo,
  state: StateFilter,
  region: RegionFilter,
): boolean {
  // State filter.
  switch (state) {
    case "all":
      break;
    case "ny_nj_and_generic":
      if (geo.state === "other_state") return false;
      break;
    case "ny_only":
      if (geo.state !== "ny") return false;
      break;
    case "nj_only":
      if (geo.state !== "nj") return false;
      break;
    case "ny_nj_only":
      if (geo.state !== "ny" && geo.state !== "nj") return false;
      break;
    case "generic_only":
      if (geo.state !== null) return false;
      break;
    case "other_state":
      if (geo.state !== "other_state") return false;
      break;
  }

  // Region filter (only meaningful when state actually has a region).
  if (region !== "all") {
    if (geo.region !== region) return false;
  }
  return true;
}
