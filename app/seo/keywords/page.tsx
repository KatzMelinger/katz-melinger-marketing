"use client";

/**
 * SEO keyword tracker — extended detail.
 *
 * Adds previous position + position delta (movement arrow), CPC, traffic
 * value, competition, URL the keyword ranks for, plus column sorting and
 * a search filter. Data comes from /api/seo/keywords backed by Semrush
 * domain_organic.
 */

import { useEffect, useMemo, useState } from "react";

import { SeoShell, formatNumber } from "@/components/seo-shell";

type KeywordRow = {
  keyword: string;
  position: number;
  previousPosition: number;
  positionDelta: number;
  searchVolume: number;
  keywordDifficulty: number;
  trendScore: number;
  estimatedTraffic: number;
  cpc: number;
  trafficCost: number;
  competition: number;
  url: string;
};

type KeywordResponse = {
  tracked?: Array<KeywordRow & { isTargetKeyword?: boolean }>;
  missingTargets?: string[];
  trendingKeywords?: Array<{ keyword: string; searchVolume: number; trendScore: number }>;
  longTailSuggestions?: string[];
  competitive?: Array<{
    keyword: string;
    competitorPosition: number;
    ourPosition: number;
    opportunityScore: number;
    domain: string;
  }>;
};

type SortKey =
  | "keyword"
  | "position"
  | "positionDelta"
  | "searchVolume"
  | "keywordDifficulty"
  | "estimatedTraffic"
  | "cpc"
  | "trafficCost";

// Used to flag keywords that explicitly reference a non-target state. The
// firm is NY/NJ-only — anything mentioning these is almost certainly noise
// (Semrush returns US-wide data and the site shows up incidentally for
// out-of-state queries).
const NY_NJ_TERMS = [
  "new york", "ny ", " ny", "nyc", "manhattan", "brooklyn", "queens", "bronx",
  "staten island", "long island", "westchester",
  "new jersey", " nj", "nj ", "newark", "jersey city", "hoboken", "trenton",
];

const OTHER_STATE_TERMS = [
  "california", " ca ", " ca,", " ca.", "california", "los angeles", "san francisco",
  "san diego", "oakland", "sacramento",
  "texas", " tx", "houston", "dallas", "austin", "san antonio",
  "florida", " fl", "miami", "orlando", "tampa", "jacksonville",
  "illinois", " il", "chicago",
  "massachusetts", " ma ", "boston",
  "pennsylvania", " pa ", "philadelphia", "pittsburgh",
  "ohio", " oh", "cleveland", "columbus",
  "michigan", " mi ", "detroit",
  "georgia", " ga", "atlanta",
  "north carolina", "south carolina", "charlotte", "raleigh",
  "washington", "seattle", " dc",
  "colorado", "denver",
  "arizona", "phoenix",
  "nevada", "las vegas",
  "oregon", "portland",
  "minnesota", "minneapolis",
  "wisconsin", "milwaukee",
  "missouri", "st. louis", "kansas city",
  "tennessee", "nashville", "memphis",
  "virginia", "richmond",
  "maryland", "baltimore",
];

function classifyGeo(keyword: string): "ny_nj" | "other_state" | "generic" {
  const lc = " " + keyword.toLowerCase() + " ";
  for (const t of NY_NJ_TERMS) {
    if (lc.includes(t)) return "ny_nj";
  }
  for (const t of OTHER_STATE_TERMS) {
    if (lc.includes(t)) return "other_state";
  }
  return "generic";
}

export default function SeoKeywordsPage() {
  const [data, setData] = useState<KeywordResponse | null>(null);
  const [competitive, setCompetitive] = useState<KeywordResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("estimatedTraffic");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showRanking, setShowRanking] = useState<"all" | "top10" | "top50" | "missing">("all");
  // Default hides out-of-state keywords since the firm is NY/NJ-only.
  const [geoFilter, setGeoFilter] = useState<"ny_nj_and_generic" | "ny_nj_only" | "all">("ny_nj_and_generic");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/seo/keywords", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/seo/keywords?competitor=nilawfirm.com", { cache: "no-store" }).then((r) =>
        r.json(),
      ),
    ])
      .then(([d, c]) => {
        setData(d);
        setCompetitive(c);
      })
      .finally(() => setLoading(false));
  }, []);

  const sorted = useMemo(() => {
    const rows = (data?.tracked ?? []).slice();
    const lc = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (lc && !r.keyword.toLowerCase().includes(lc)) return false;
      if (showRanking === "top10" && !(r.position > 0 && r.position <= 10)) return false;
      if (showRanking === "top50" && !(r.position > 0 && r.position <= 50)) return false;
      if (showRanking === "missing" && !(r.position === 0 || r.position > 100)) return false;
      const geo = classifyGeo(r.keyword);
      if (geoFilter === "ny_nj_only" && geo !== "ny_nj") return false;
      if (geoFilter === "ny_nj_and_generic" && geo === "other_state") return false;
      return true;
    });
    filtered.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // For position fields, lower number = better; we still let user sort asc/desc.
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const aNum = typeof av === "number" ? av : 0;
      const bNum = typeof bv === "number" ? bv : 0;
      return sortDir === "asc" ? aNum - bNum : bNum - aNum;
    });
    return filtered;
  }, [data, search, sortKey, sortDir, showRanking, geoFilter]);

  const setSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Default to descending for numeric, ascending for keyword.
      setSortDir(key === "keyword" ? "asc" : "desc");
    }
  };

  const sortIndicator = (key: SortKey) => (sortKey !== key ? "" : sortDir === "asc" ? " ▲" : " ▼");

  const top10Count = (data?.tracked ?? []).filter(
    (i) => i.position > 0 && i.position <= 10,
  ).length;
  const totalTracked = data?.tracked?.length ?? 0;
  const totalTraffic = (data?.tracked ?? []).reduce((sum, r) => sum + (r.estimatedTraffic ?? 0), 0);
  const totalTrafficValue = (data?.tracked ?? []).reduce(
    (sum, r) => sum + (r.trafficCost ?? 0),
    0,
  );

  return (
    <SeoShell
      title="Keyword Tracking & Research"
      subtitle="Target rankings, position movement, CPC value, competition, and competitor opportunity gaps."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Tracked keywords" value={formatNumber(totalTracked)} />
        <Stat label="Top 10 rankings" value={formatNumber(top10Count)} />
        <Stat label="Missing targets" value={formatNumber(data?.missingTargets?.length ?? 0)} />
        <Stat label="Est. monthly traffic" value={formatNumber(totalTraffic)} />
        <Stat
          label="Est. traffic value"
          value={"$" + Math.round(totalTrafficValue).toLocaleString()}
          hint="What this organic traffic would cost in paid search."
        />
      </section>

      <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h2 className="text-lg font-semibold">Target keyword tracker</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search keywords…"
              className="px-3 py-1.5 text-sm rounded-md border border-[#e2e8f0] focus:border-[#185FA5] focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30"
            />
            <select
              value={showRanking}
              onChange={(e) =>
                setShowRanking(e.target.value as "all" | "top10" | "top50" | "missing")
              }
              className="px-3 py-1.5 text-sm rounded-md border border-[#e2e8f0]"
            >
              <option value="all">All rankings</option>
              <option value="top10">Top 10</option>
              <option value="top50">Top 50</option>
              <option value="missing">Missing / unranked</option>
            </select>
            <select
              value={geoFilter}
              onChange={(e) =>
                setGeoFilter(e.target.value as "ny_nj_and_generic" | "ny_nj_only" | "all")
              }
              className="px-3 py-1.5 text-sm rounded-md border border-[#e2e8f0]"
              title="Hide keywords mentioning out-of-state locations (the firm is NY/NJ-only, but Semrush returns US-wide data)"
            >
              <option value="ny_nj_and_generic">NY/NJ + generic (default)</option>
              <option value="ny_nj_only">NY/NJ only</option>
              <option value="all">All geos (incl. CA, TX, etc.)</option>
            </select>
          </div>
        </div>

        {loading && !data && <p className="text-sm text-slate-500">Loading…</p>}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="border-b border-[#e2e8f0] text-slate-500 text-xs">
              <tr>
                <ThButton onClick={() => setSort("keyword")}>
                  Keyword{sortIndicator("keyword")}
                </ThButton>
                <ThButton onClick={() => setSort("position")}>
                  Pos{sortIndicator("position")}
                </ThButton>
                <ThButton onClick={() => setSort("positionDelta")}>
                  Δ{sortIndicator("positionDelta")}
                </ThButton>
                <ThButton onClick={() => setSort("searchVolume")}>
                  Volume/mo{sortIndicator("searchVolume")}
                </ThButton>
                <ThButton onClick={() => setSort("keywordDifficulty")}>
                  KD{sortIndicator("keywordDifficulty")}
                </ThButton>
                <ThButton onClick={() => setSort("cpc")}>
                  CPC{sortIndicator("cpc")}
                </ThButton>
                <ThButton onClick={() => setSort("estimatedTraffic")}>
                  Traffic{sortIndicator("estimatedTraffic")}
                </ThButton>
                <ThButton onClick={() => setSort("trafficCost")}>
                  Value{sortIndicator("trafficCost")}
                </ThButton>
                <th className="pb-2 pr-3 font-medium">URL</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-slate-500">
                    No keywords match these filters.
                  </td>
                </tr>
              )}
              {sorted.map((item) => {
                const geo = classifyGeo(item.keyword);
                return (
                <tr
                  key={item.keyword}
                  className="border-b border-[#e2e8f0]/60 text-slate-700 last:border-0 hover:bg-slate-50"
                >
                  <td className="py-2 pr-3 text-slate-900 font-medium">
                    {item.keyword}
                    {geo === "ny_nj" && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                        NY/NJ
                      </span>
                    )}
                    {geo === "other_state" && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                        out-of-state
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {item.position > 0 ? item.position : "—"}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    <PositionDelta delta={item.positionDelta} prev={item.previousPosition} />
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{formatNumber(item.searchVolume)}</td>
                  <td className="py-2 pr-3 tabular-nums">
                    <KdBadge kd={item.keywordDifficulty} />
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {item.cpc > 0 ? `$${item.cpc.toFixed(2)}` : "—"}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{formatNumber(item.estimatedTraffic)}</td>
                  <td className="py-2 pr-3 tabular-nums">
                    {item.trafficCost > 0 ? `$${Math.round(item.trafficCost)}` : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[#185FA5] hover:underline truncate block max-w-[300px]"
                        title={item.url}
                      >
                        {item.url.replace(/^https?:\/\/(www\.)?[^/]+/, "")}
                      </a>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Showing {sorted.length} of {totalTracked} keywords. Click any column header to sort.
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-5">
          <h2 className="text-lg font-semibold">Legal industry trends</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {(data?.trendingKeywords ?? []).map((item) => (
              <li
                key={item.keyword}
                className="rounded-md border border-[#e2e8f0] bg-white px-3 py-2"
              >
                <p className="text-slate-900">{item.keyword}</p>
                <p className="text-xs text-slate-500">
                  Volume {formatNumber(item.searchVolume)} · Trend {item.trendScore}
                </p>
              </li>
            ))}
          </ul>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-5">
          <h2 className="text-lg font-semibold">Long-tail opportunities</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {(data?.longTailSuggestions ?? []).map((keyword) => (
              <li
                key={keyword}
                className="rounded-md border border-[#e2e8f0] bg-white px-3 py-2"
              >
                {keyword}
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <h2 className="text-lg font-semibold">Competitor keyword opportunities</h2>
        <p className="text-xs text-slate-500 mt-1">
          Keywords where a tracked competitor outranks us with meaningful search volume.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="border-b border-[#e2e8f0] text-slate-500 text-xs">
              <tr>
                <th className="pb-2 pr-3 font-medium">Keyword</th>
                <th className="pb-2 pr-3 font-medium">Competitor pos</th>
                <th className="pb-2 pr-3 font-medium">Our pos</th>
                <th className="pb-2 pr-3 font-medium">Opportunity score</th>
                <th className="pb-2 font-medium">Domain</th>
              </tr>
            </thead>
            <tbody>
              {(competitive?.competitive ?? []).slice(0, 30).map((item) => (
                <tr
                  key={`${item.domain}-${item.keyword}`}
                  className="border-b border-[#e2e8f0]/60 last:border-0 hover:bg-slate-50"
                >
                  <td className="py-2 pr-3 text-slate-900">{item.keyword}</td>
                  <td className="py-2 pr-3 tabular-nums">{item.competitorPosition}</td>
                  <td className="py-2 pr-3 tabular-nums">
                    {item.ourPosition > 0 ? item.ourPosition : "—"}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{Math.round(item.opportunityScore)}</td>
                  <td className="py-2 text-slate-600">{item.domain}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </SeoShell>
  );
}

function ThButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <th className="pb-2 pr-3 font-medium">
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center hover:text-[#185FA5]"
      >
        {children}
      </button>
    </th>
  );
}

function PositionDelta({ delta, prev }: { delta: number; prev: number }) {
  if (!delta) {
    if (prev > 0) return <span className="text-slate-400">—</span>;
    return <span className="text-emerald-700 text-xs font-medium">NEW</span>;
  }
  if (delta > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-medium">
        ↑ {delta}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-red-700 text-xs font-medium">
      ↓ {Math.abs(delta)}
    </span>
  );
}

function KdBadge({ kd }: { kd: number }) {
  if (!kd) return <span className="text-slate-400">—</span>;
  const tone =
    kd < 30 ? "emerald" : kd < 60 ? "amber" : "red";
  const colors: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium border ${colors[tone]}`}>
      {kd}
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <article className="rounded-xl border border-[#e2e8f0] bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </article>
  );
}
