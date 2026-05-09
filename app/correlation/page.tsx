"use client";

/**
 * Cross-channel content correlation.
 *
 * Joins the firm's tracked SEO keywords (with their landing URL) against the
 * citations the AI engines pulled in the latest AEO sweep. Shows three lists:
 *
 *   Double winners — pages that BOTH rank organically AND get cited by AI.
 *   These are the firm's strongest assets; they prove the formula works.
 *
 *   Rank-no-cite — pages that rank well but the AI ignores. Add schema, FAQs,
 *   definitions, source links — make them quotable.
 *
 *   Cite-no-rank — URLs the AI keeps citing that aren't even tracked in SEO.
 *   Add them to the tracked-keyword list and watch what they rank for.
 */

import { useEffect, useState } from "react";

type Joined = {
  url: string;
  organicRank: number | null;
  monthlyVolume: number;
  keywords: string[];
  aiCitationCount: number;
  aiProviders: string[];
  aiPrompts: number;
};

type Dashboard = {
  runDate: string | null;
  summary: {
    ranked: number;
    cited: number;
    doubleWinners: number;
    rankNoCite: number;
    citeNoRank: number;
  };
  doubleWinners: Joined[];
  rankNoCite: Joined[];
  citeNoRank: Joined[];
};

export default function CorrelationPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch("/api/correlation/dashboard")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Content correlation</h1>
        <p className="text-sm opacity-70 mt-1 max-w-2xl">
          Where does organic ranking overlap with AI citation? Joins tracked
          SEO keywords against the latest AEO sweep, surfacing double-winners
          (and the gaps on either side).
        </p>
        {data?.runDate && (
          <p className="text-xs opacity-60 mt-1">
            Latest AEO sweep: {new Date(data.runDate).toLocaleString()}
          </p>
        )}
      </div>

      {loading && <div className="border border-black/10 dark:border-white/10 rounded-lg p-10 text-center opacity-70 text-sm">Loading…</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Ranked URLs" value={data.summary.ranked} />
            <Stat label="Cited URLs" value={data.summary.cited} />
            <Stat label="Double winners" value={data.summary.doubleWinners} tone="emerald" />
            <Stat label="Rank, no cite" value={data.summary.rankNoCite} tone="amber" />
            <Stat label="Cite, no rank" value={data.summary.citeNoRank} tone="blue" />
          </div>

          <Group title="Double winners — rank AND cited by AI" tone="emerald" hint="These pages are doing both jobs. Use them as templates for new content.">
            <Table rows={data.doubleWinners} showCitations />
          </Group>

          <Group title="Rank but no AI citation" tone="amber" hint="Make these quotable: add FAQ blocks, definitions, statistics, source links, and Article/LegalService schema.">
            <Table rows={data.rankNoCite} showCitations={false} />
          </Group>

          <Group title="AI citing pages we don't track for SEO" tone="blue" hint="Add the queries these pages already rank for to the tracked-keyword list.">
            <Table rows={data.citeNoRank} showCitations />
          </Group>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "amber" | "blue";
}) {
  const color =
    tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "amber"
      ? "text-amber-700 dark:text-amber-400"
      : tone === "blue"
      ? "text-blue-700 dark:text-blue-400"
      : "";
  return (
    <div className="border border-black/10 dark:border-white/10 rounded-lg p-4">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs opacity-70 mt-1">{label}</div>
    </div>
  );
}

function Group({
  title,
  tone,
  hint,
  children,
}: {
  title: string;
  tone: "emerald" | "amber" | "blue";
  hint: string;
  children: React.ReactNode;
}) {
  const colors: Record<string, string> = {
    emerald: "border-emerald-500/30",
    amber: "border-amber-500/30",
    blue: "border-blue-500/30",
  };
  return (
    <div className={`border ${colors[tone]} rounded-lg overflow-hidden`}>
      <div className="px-4 py-3 border-b border-black/10 dark:border-white/10">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs opacity-60 mt-0.5">{hint}</div>
      </div>
      {children}
    </div>
  );
}

function Table({ rows, showCitations }: { rows: Joined[]; showCitations: boolean }) {
  if (rows.length === 0) {
    return <div className="p-6 text-center text-sm opacity-60">Nothing here.</div>;
  }
  return (
    <table className="w-full text-xs">
      <thead className="text-left opacity-60">
        <tr>
          <th className="px-4 py-2">URL</th>
          <th className="px-4 py-2 w-20 text-right">Rank</th>
          <th className="px-4 py-2 w-24 text-right">Vol/mo</th>
          {showCitations && (
            <>
              <th className="px-4 py-2 w-20 text-right">AI cites</th>
              <th className="px-4 py-2 w-32">Providers</th>
            </>
          )}
        </tr>
      </thead>
      <tbody className="divide-y divide-black/5 dark:divide-white/5">
        {rows.slice(0, 50).map((r) => (
          <tr key={r.url}>
            <td className="px-4 py-2">
              <div className="truncate"><a href={r.url} target="_blank" rel="noreferrer" className="underline opacity-90">{r.url}</a></div>
              {r.keywords.length > 0 && (
                <div className="text-[10px] opacity-60 mt-0.5 truncate">{r.keywords.join(" · ")}</div>
              )}
            </td>
            <td className="px-4 py-2 text-right opacity-80">{r.organicRank ?? "—"}</td>
            <td className="px-4 py-2 text-right opacity-80">{r.monthlyVolume.toLocaleString()}</td>
            {showCitations && (
              <>
                <td className="px-4 py-2 text-right opacity-80">{r.aiCitationCount}</td>
                <td className="px-4 py-2 text-[10px] opacity-70">{r.aiProviders.join(", ")}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
