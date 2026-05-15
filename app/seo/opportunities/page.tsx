"use client";

/**
 * SEO Opportunity Radar.
 *
 * Surfaces keyword quick wins (competitor outranks us), missing target
 * keywords, long-tail content ideas, and link-building gaps. Each
 * keyword/idea row has the same Ideas + Create actions as /seo/keywords.
 *
 * Multi-batch: every keyword/idea row has a checkbox. The sticky bar at
 * the bottom turns the selection into a serial generation queue — one
 * /api/content/draft call per keyword, progress shown as it advances,
 * and every resulting draft is tagged with its originating section so
 * the drafts library shows where it came from.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import {
  ContentActionsRow,
  useContentActions,
} from "@/components/content-actions";
import { formatNumber, SeoShell } from "@/components/seo-shell";

type BatchFormatKey =
  | "blog"
  | "linkedin"
  | "twitter"
  | "facebook"
  | "instagram"
  | "email"
  | "podcast";

const BATCH_FORMATS: { id: BatchFormatKey; label: string; hint: string }[] = [
  { id: "blog", label: "Blog post", hint: "800-1200 words" },
  { id: "linkedin", label: "LinkedIn", hint: "350-450 words" },
  { id: "twitter", label: "Twitter/X thread", hint: "5-7 tweets" },
  { id: "facebook", label: "Facebook", hint: "200-280 words" },
  { id: "instagram", label: "Instagram caption", hint: "150-220 words" },
  { id: "email", label: "Email newsletter", hint: "subject + body" },
  { id: "podcast", label: "Podcast script", hint: "5-7 min solo" },
];

type OpportunitiesResponse = {
  selectedCompetitor?: string;
  competitors?: string[];
  quickWins?: Array<{
    keyword: string;
    opportunityScore: number;
    competitorPosition: number;
    ourPosition: number;
  }>;
  missingTargetKeywords?: string[];
  longTailSuggestions?: string[];
  topLinkGaps?: Array<{ domain: string; opportunity: string }>;
  summary?: { keywordQuickWins: number; toxicLinksToDisavow: number };
};

type OriginSection = "opportunity_quickwin" | "opportunity_missing" | "opportunity_longtail";

type BatchResult = {
  keyword: string;
  section: OriginSection;
  ok: boolean;
  batchId?: string;
  drafts?: Array<{ id: string; format: string; title: string | null }>;
  error?: string;
};

const ORIGIN_LABEL: Record<OriginSection, string> = {
  opportunity_quickwin: "Quick win",
  opportunity_missing: "Missing target",
  opportunity_longtail: "Long-tail",
};

const selectionKey = (section: OriginSection, keyword: string) =>
  `${section}::${keyword}`;

export default function SeoOpportunitiesPage() {
  const searchParams = useSearchParams();
  const competitor = searchParams?.get("competitor") ?? "";

  const [data, setData] = useState<OpportunitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const ca = useContentActions();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchFormats, setBatchFormats] = useState<Set<BatchFormatKey>>(
    new Set(["blog", "linkedin", "twitter"]),
  );
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    done: number;
    total: number;
    current: string | null;
  }>({ done: 0, total: 0, current: null });
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);

  useEffect(() => {
    setLoading(true);
    setSelected(new Set());
    setBatchResults([]);
    const query = competitor ? `?competitor=${encodeURIComponent(competitor)}` : "";
    fetch(`/api/seo/opportunities${query}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setData(d as OpportunitiesResponse))
      .finally(() => setLoading(false));
  }, [competitor]);

  const toggleSelect = (section: OriginSection, keyword: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = selectionKey(section, keyword);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };
  const isSelected = (section: OriginSection, keyword: string) =>
    selected.has(selectionKey(section, keyword));

  const selectAll = (items: Array<{ section: OriginSection; keyword: string }>) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = items.every((i) => next.has(selectionKey(i.section, i.keyword)));
      for (const i of items) {
        const k = selectionKey(i.section, i.keyword);
        if (allOn) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  };

  const toggleFormat = (f: BatchFormatKey) => {
    setBatchFormats((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };

  const runBatch = async () => {
    if (selected.size === 0 || batchRunning || batchFormats.size === 0) return;
    const items: Array<{ section: OriginSection; keyword: string }> = Array.from(selected).map(
      (key) => {
        const [section, ...rest] = key.split("::");
        return { section: section as OriginSection, keyword: rest.join("::") };
      },
    );
    const formats = Array.from(batchFormats);

    setBatchRunning(true);
    setBatchResults([]);
    setBatchProgress({ done: 0, total: items.length, current: null });

    for (const item of items) {
      setBatchProgress((p) => ({ ...p, current: item.keyword }));
      try {
        const res = await fetch("/api/content/batches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic: item.keyword,
            practiceArea: "General",
            formats,
            targetKeywords: [item.keyword],
            origin_source: item.section,
            origin_context: {
              source_keyword: item.keyword,
              opportunity_section: ORIGIN_LABEL[item.section],
              competitor: competitor || undefined,
            },
          }),
        });
        const json = await res.json();
        const ok = !!json?.batch_id && Array.isArray(json?.drafts) && json.drafts.length > 0;
        setBatchResults((r) => [
          ...r,
          {
            keyword: item.keyword,
            section: item.section,
            ok,
            batchId: json?.batch_id,
            drafts: Array.isArray(json?.drafts) ? json.drafts : undefined,
            error: !ok ? json?.error ?? "Generation failed" : undefined,
          },
        ]);
      } catch (e) {
        setBatchResults((r) => [
          ...r,
          {
            keyword: item.keyword,
            section: item.section,
            ok: false,
            error: e instanceof Error ? e.message : "Network error",
          },
        ]);
      }
      setBatchProgress((p) => ({ done: p.done + 1, total: p.total, current: null }));
    }

    setBatchRunning(false);
    setSelected(new Set());
  };

  const quickWins = useMemo(() => data?.quickWins ?? [], [data]);
  const missing = useMemo(() => data?.missingTargetKeywords ?? [], [data]);
  const longTail = useMemo(() => data?.longTailSuggestions ?? [], [data]);

  const allSelectable: Array<{ section: OriginSection; keyword: string }> = useMemo(
    () => [
      ...quickWins.map((r) => ({ section: "opportunity_quickwin" as const, keyword: r.keyword })),
      ...missing.map((k) => ({ section: "opportunity_missing" as const, keyword: k })),
      ...longTail.map((k) => ({ section: "opportunity_longtail" as const, keyword: k })),
    ],
    [quickWins, missing, longTail],
  );

  const allSelected =
    allSelectable.length > 0 &&
    allSelectable.every((i) => selected.has(selectionKey(i.section, i.keyword)));

  return (
    <SeoShell
      title="SEO Opportunity Radar"
      subtitle="Prioritized keyword and backlink opportunities based on competitor gaps and legal search demand."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Selected competitor</p>
          <p className="mt-2 text-lg font-semibold">{data?.selectedCompetitor || "—"}</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Keyword quick wins</p>
          <p className="mt-2 text-2xl font-semibold">
            {formatNumber(data?.summary?.keywordQuickWins ?? 0)}
          </p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Missing target terms</p>
          <p className="mt-2 text-2xl font-semibold">
            {formatNumber(data?.missingTargetKeywords?.length ?? 0)}
          </p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Toxic links to review</p>
          <p className="mt-2 text-2xl font-semibold">
            {formatNumber(data?.summary?.toxicLinksToDisavow ?? 0)}
          </p>
        </article>
      </section>

      <section className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
        <h2 className="text-lg font-semibold">Competitor selector</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {(data?.competitors ?? []).map((domain) => (
            <Link
              key={domain}
              href={`/seo/opportunities?competitor=${encodeURIComponent(domain)}`}
              className="rounded border border-[#e2e8f0] bg-[#ffffff] px-3 py-1 text-xs text-slate-700 hover:border-[#185FA5] hover:text-slate-900"
            >
              {domain}
            </Link>
          ))}
        </div>
      </section>

      {allSelectable.length > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-[#e2e8f0] bg-slate-50 px-4 py-2 text-xs">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => selectAll(allSelectable)}
              disabled={batchRunning}
            />
            <span className="text-slate-700">
              Select all opportunities on this page ({allSelectable.length})
            </span>
          </label>
          <span className="text-slate-500">
            Tick a row to add it to the batch queue at the bottom of the page.
          </span>
        </div>
      )}

      <section className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
        <h2 className="text-lg font-semibold">Keyword quick wins</h2>
        <p className="mt-1 text-xs text-slate-500">
          Keywords where the competitor outranks us. Click <b>Ideas</b> for AI angles,{" "}
          <b>Create</b> for a draft, or check the box to queue this keyword for batch generation.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-[#e2e8f0] text-slate-500 text-xs">
              <tr>
                <th className="pb-2 pr-3 font-medium w-8"></th>
                <th className="pb-2 pr-3 font-medium">Keyword</th>
                <th className="pb-2 pr-3 font-medium">Their pos</th>
                <th className="pb-2 pr-3 font-medium">Our pos</th>
                <th className="pb-2 pr-3 font-medium">Opportunity</th>
                <th className="pb-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500">
                    Loading opportunities…
                  </td>
                </tr>
              )}
              {!loading && quickWins.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500">
                    No quick wins for this competitor.
                  </td>
                </tr>
              )}
              {quickWins.map((row) => (
                <tr
                  key={row.keyword}
                  className="border-b border-[#e2e8f0]/60 text-slate-700 last:border-0 hover:bg-slate-50"
                >
                  <td className="py-2 pr-3">
                    <input
                      type="checkbox"
                      checked={isSelected("opportunity_quickwin", row.keyword)}
                      onChange={() => toggleSelect("opportunity_quickwin", row.keyword)}
                      disabled={batchRunning}
                    />
                  </td>
                  <td className="py-2 pr-3 text-slate-900">{row.keyword}</td>
                  <td className="py-2 pr-3 tabular-nums">{row.competitorPosition}</td>
                  <td className="py-2 pr-3 tabular-nums">
                    {row.ourPosition || "Not ranking"}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{row.opportunityScore}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <ContentActionsRow
                      keyword={row.keyword}
                      actions={ca}
                      originSource="opportunity_quickwin"
                      originContext={{
                        source_keyword: row.keyword,
                        opportunity_section: ORIGIN_LABEL.opportunity_quickwin,
                        competitor: competitor || undefined,
                        competitor_position: row.competitorPosition,
                        our_position: row.ourPosition,
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
          <h2 className="text-lg font-semibold">Missing target keywords</h2>
          <p className="mt-1 text-xs text-slate-500">
            Tracked targets the firm doesn&apos;t rank for yet.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {missing.length === 0 && !loading && (
              <li className="text-xs text-slate-400">All targets ranking.</li>
            )}
            {missing.map((kw) => (
              <li
                key={kw}
                className="flex items-center justify-between gap-2 rounded-md border border-[#e2e8f0] bg-[#ffffff] px-3 py-2"
              >
                <label className="flex items-center gap-2 flex-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isSelected("opportunity_missing", kw)}
                    onChange={() => toggleSelect("opportunity_missing", kw)}
                    disabled={batchRunning}
                  />
                  <span className="text-slate-900">{kw}</span>
                </label>
                <ContentActionsRow
                  keyword={kw}
                  actions={ca}
                  originSource="opportunity_missing"
                  originContext={{
                    source_keyword: kw,
                    opportunity_section: ORIGIN_LABEL.opportunity_missing,
                  }}
                />
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
          <h2 className="text-lg font-semibold">Long-tail content ideas</h2>
          <p className="mt-1 text-xs text-slate-500">
            Suggested long-tail variations to capture additional search demand.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {longTail.length === 0 && !loading && (
              <li className="text-xs text-slate-400">No suggestions returned.</li>
            )}
            {longTail.map((kw) => (
              <li
                key={kw}
                className="flex items-center justify-between gap-2 rounded-md border border-[#e2e8f0] bg-[#ffffff] px-3 py-2"
              >
                <label className="flex items-center gap-2 flex-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isSelected("opportunity_longtail", kw)}
                    onChange={() => toggleSelect("opportunity_longtail", kw)}
                    disabled={batchRunning}
                  />
                  <span className="text-slate-700">{kw}</span>
                </label>
                <ContentActionsRow
                  keyword={kw}
                  actions={ca}
                  originSource="opportunity_longtail"
                  originContext={{
                    source_keyword: kw,
                    opportunity_section: ORIGIN_LABEL.opportunity_longtail,
                  }}
                />
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
        <h2 className="text-lg font-semibold">Link-building opportunities</h2>
        <p className="mt-1 text-xs text-slate-500">
          Domains worth pursuing for backlinks. (Ideas/Create don&apos;t apply — these are outreach
          targets, not content ideas.)
        </p>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          {(data?.topLinkGaps ?? []).map((item) => (
            <li key={item.domain} className="rounded-md border border-[#e2e8f0] bg-[#ffffff] px-3 py-2">
              <p className="font-medium text-slate-900">{item.domain}</p>
              <p className="text-xs text-slate-500">{item.opportunity}</p>
            </li>
          ))}
        </ul>
      </section>

      {batchResults.length > 0 && !batchRunning && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-5">
          <h2 className="text-base font-semibold text-emerald-900">
            Batch results · {batchResults.filter((r) => r.ok).length} of {batchResults.length} keywords processed ·{" "}
            {batchResults.reduce((sum, r) => sum + (r.drafts?.length ?? 0), 0)} drafts total
          </h2>
          <ul className="mt-3 space-y-2 text-xs">
            {batchResults.map((r, i) => (
              <li
                key={`${r.keyword}-${i}`}
                className="rounded border border-white bg-white px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        r.ok ? "bg-emerald-500" : "bg-red-500"
                      }`}
                      aria-hidden
                    />
                    <span className="text-slate-700 font-medium">{r.keyword}</span>
                    <span className="text-[10px] uppercase tracking-wider text-slate-400">
                      {ORIGIN_LABEL[r.section]}
                    </span>
                    {r.ok && r.drafts && (
                      <span className="text-[10px] text-slate-500">
                        · {r.drafts.length} draft{r.drafts.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  {!r.ok && <span className="text-red-600">{r.error}</span>}
                </div>
                {r.ok && r.drafts && r.drafts.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {r.drafts.map((d) => (
                      <Link
                        key={d.id}
                        href={`/content/drafts?id=${encodeURIComponent(d.id)}`}
                        className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-700 hover:border-[#185FA5] hover:text-[#185FA5]"
                      >
                        {d.format}
                      </Link>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(selected.size > 0 || batchRunning) && (
        <div className="sticky bottom-4 z-30 rounded-xl border border-[#185FA5] bg-white px-4 py-3 shadow-lg space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              {batchRunning ? (
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    Generating {batchProgress.done + (batchProgress.current ? 1 : 0)} of{" "}
                    {batchProgress.total}
                    {batchProgress.current ? `: ${batchProgress.current}` : "…"}
                  </p>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full bg-[#185FA5] transition-all"
                      style={{
                        width: `${
                          batchProgress.total === 0
                            ? 0
                            : (batchProgress.done / batchProgress.total) * 100
                        }%`,
                      }}
                    />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-900">
                  <span className="font-medium">{selected.size}</span> keyword
                  {selected.size === 1 ? "" : "s"} × {batchFormats.size} format
                  {batchFormats.size === 1 ? "" : "s"} ={" "}
                  <span className="font-medium">
                    {selected.size * batchFormats.size}
                  </span>{" "}
                  draft{selected.size * batchFormats.size === 1 ? "" : "s"} to generate
                </p>
              )}
            </div>

            <button
              onClick={() => setSelected(new Set())}
              disabled={batchRunning || selected.size === 0}
              className="text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Clear
            </button>

            <button
              onClick={runBatch}
              disabled={batchRunning || selected.size === 0 || batchFormats.size === 0}
              className="text-xs px-3 py-1.5 rounded bg-[#185FA5] text-white font-medium hover:bg-[#1f6fb8] disabled:opacity-50"
              title={batchFormats.size === 0 ? "Pick at least one format" : ""}
            >
              {batchRunning ? "Generating…" : `Generate`}
            </button>
          </div>

          {!batchRunning && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 mr-1">
                  Preset:
                </span>
                <button
                  onClick={() => setBatchFormats(new Set(["blog"]))}
                  className="text-[11px] px-2 py-0.5 rounded border border-blue-500/40 bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium"
                >
                  Website
                </button>
                <button
                  onClick={() =>
                    setBatchFormats(
                      new Set([
                        "linkedin",
                        "twitter",
                        "facebook",
                        "instagram",
                        "podcast",
                      ]),
                    )
                  }
                  className="text-[11px] px-2 py-0.5 rounded border border-violet-500/40 bg-violet-50 text-violet-700 hover:bg-violet-100 font-medium"
                >
                  Social media
                </button>
                <button
                  onClick={() => setBatchFormats(new Set(["email"]))}
                  className="text-[11px] px-2 py-0.5 rounded border border-amber-500/40 bg-amber-50 text-amber-700 hover:bg-amber-100 font-medium"
                >
                  Email
                </button>
                <button
                  onClick={() =>
                    setBatchFormats(new Set(BATCH_FORMATS.map((f) => f.id)))
                  }
                  className="text-[11px] px-2 py-0.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-100"
                >
                  All
                </button>
                {batchFormats.size > 0 && (
                  <button
                    onClick={() => setBatchFormats(new Set())}
                    className="text-[11px] px-2 py-0.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-100"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 mr-1">
                  Formats:
                </span>
                {BATCH_FORMATS.map((f) => {
                  const on = batchFormats.has(f.id);
                  return (
                    <button
                      key={f.id}
                      onClick={() => toggleFormat(f.id)}
                      title={f.hint}
                      className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                        on
                          ? "border-[#185FA5] bg-[#185FA5]/10 text-[#185FA5]"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                      }`}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {ca.modal}
    </SeoShell>
  );
}
