"use client";

/**
 * Keyword Battles — head-to-head ranking gaps vs a tracked competitor.
 *
 * Client-side now (was server-rendered) so we can apply the same
 * NY/NJ + city filters from the lib/keyword-geo classifier. Pick a
 * competitor, narrow by state/region, sort by opportunity score.
 */

import { useEffect, useMemo, useState } from "react";

import { RecentSearchesStrip } from "@/components/recent-searches-strip";
import { SeoShell, formatNumber } from "@/components/seo-shell";
import {
  classifyKeywordGeo,
  passesGeoFilter,
  REGION_FILTER_OPTIONS,
  STATE_FILTER_OPTIONS,
  type RegionFilter,
  type StateFilter,
} from "@/lib/keyword-geo";
import { recordSearch } from "@/lib/recent-searches";

type Opportunity = {
  keyword: string;
  competitorPosition: number;
  ourPosition: number;
  opportunityScore: number;
  searchVolume: number;
};

type SortKey = "opportunityScore" | "searchVolume" | "competitorPosition" | "ourPosition";

export default function KeywordCompetitivePage() {
  const [trackedDomains, setTrackedDomains] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [loadingOpps, setLoadingOpps] = useState(false);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("ny_nj_and_generic");
  const [regionFilter, setRegionFilter] = useState<RegionFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("opportunityScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    if (search.trim().length < 3) return;
    const t = setTimeout(() => recordSearch("battles", search), 1200);
    return () => clearTimeout(t);
  }, [search]);

  // Whenever the user picks a competitor, log that selection too — it's the
  // real "search" on this page.
  useEffect(() => {
    if (selected) recordSearch("battles", selected);
  }, [selected]);

  useEffect(() => {
    setLoadingDomains(true);
    fetch("/api/seo/competitors", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const list = (d?.trackedDomains ?? []) as string[];
        setTrackedDomains(list);
        if (list[0]) setSelected((prev) => prev || list[0]);
      })
      .finally(() => setLoadingDomains(false));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoadingOpps(true);
    fetch(`/api/seo/keywords/competitive?domain=${encodeURIComponent(selected)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((d) => setOpportunities((d?.opportunities ?? []) as Opportunity[]))
      .finally(() => setLoadingOpps(false));
  }, [selected]);

  const filtered = useMemo(() => {
    const lc = search.trim().toLowerCase();
    return opportunities
      .filter((o) => {
        if (lc && !o.keyword.toLowerCase().includes(lc)) return false;
        const geo = classifyKeywordGeo(o.keyword);
        return passesGeoFilter(geo, stateFilter, regionFilter);
      })
      .sort((a, b) => {
        const aV = a[sortKey];
        const bV = b[sortKey];
        return sortDir === "asc" ? aV - bV : bV - aV;
      });
  }, [opportunities, search, stateFilter, regionFilter, sortKey, sortDir]);

  const setSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  };
  const arrow = (k: SortKey) => (sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  return (
    <SeoShell
      title="Keyword Battles"
      subtitle="Compare target rankings against specific competitors and prioritize high-impact gaps."
    >
      <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <h2 className="text-lg font-semibold">Choose competitor</h2>
        {loadingDomains && <p className="text-sm text-slate-500 mt-2">Loading…</p>}
        {!loadingDomains && trackedDomains.length === 0 && (
          <p className="text-sm text-slate-500 mt-2">
            No tracked competitors. Add one on{" "}
            <a href="/seo/competitors" className="text-brand hover:underline">
              /seo/competitors
            </a>
            .
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {trackedDomains.map((domain) => (
            <button
              key={domain}
              onClick={() => setSelected(domain)}
              className={`rounded border px-3 py-1 text-xs transition-colors ${
                selected === domain
                  ? "border-brand bg-brand text-white"
                  : "border-[#e2e8f0] bg-white text-slate-700 hover:border-brand"
              }`}
            >
              {domain}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h2 className="text-lg font-semibold">
            Head-to-head: <span className="text-brand">{selected || "—"}</span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search keywords…"
              className="px-3 py-1.5 text-sm rounded-md border border-[#e2e8f0] focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value as StateFilter)}
              className="px-3 py-1.5 text-sm rounded-md border border-[#e2e8f0]"
            >
              {STATE_FILTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value as RegionFilter)}
              className="px-3 py-1.5 text-sm rounded-md border border-[#e2e8f0]"
            >
              {REGION_FILTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-3">
          <RecentSearchesStrip scope="battles" limit={6} onPick={setSearch} />
        </div>

        {loadingOpps && <p className="text-sm text-slate-500">Loading…</p>}

        {!loadingOpps && filtered.length === 0 && opportunities.length > 0 && (
          <p className="text-sm text-slate-500">
            No keywords match the current filters. Loosen the state/region filter to see more.
          </p>
        )}

        {!loadingOpps && opportunities.length === 0 && selected && (
          <p className="text-sm text-slate-500">
            No competitive opportunities returned for {selected} — they may not outrank you on
            meaningful queries.
          </p>
        )}

        {filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-[#e2e8f0] text-slate-500 text-xs">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Keyword</th>
                  <ThButton onClick={() => setSort("competitorPosition")}>
                    Their pos{arrow("competitorPosition")}
                  </ThButton>
                  <ThButton onClick={() => setSort("ourPosition")}>
                    Our pos{arrow("ourPosition")}
                  </ThButton>
                  <ThButton onClick={() => setSort("searchVolume")}>
                    Volume{arrow("searchVolume")}
                  </ThButton>
                  <ThButton onClick={() => setSort("opportunityScore")}>
                    Opportunity{arrow("opportunityScore")}
                  </ThButton>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const geo = classifyKeywordGeo(row.keyword);
                  const badge = geo.city
                    ? geo.city
                    : geo.state === "ny"
                      ? "NY"
                      : geo.state === "nj"
                        ? "NJ"
                        : null;
                  return (
                    <tr
                      key={row.keyword}
                      className="border-b border-[#e2e8f0]/60 last:border-0 hover:bg-slate-50"
                    >
                      <td className="py-2 pr-3 text-slate-900">
                        {row.keyword}
                        {badge && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                            {badge}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{row.competitorPosition}</td>
                      <td className="py-2 pr-3 tabular-nums">{row.ourPosition || "—"}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatNumber(row.searchVolume)}</td>
                      <td className="py-2 tabular-nums">
                        <span className="px-1.5 py-0.5 rounded bg-brand/10 text-brand font-medium">
                          {Math.round(row.opportunityScore)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-slate-500 mt-3">
              Showing {filtered.length} of {opportunities.length} opportunities. Click any column
              header to sort.
            </p>
          </div>
        )}
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
        className="inline-flex items-center hover:text-brand"
      >
        {children}
      </button>
    </th>
  );
}
