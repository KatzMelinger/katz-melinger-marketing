"use client";

/**
 * Production report — how much content the team actually shipped, by type.
 * Sources: content_drafts (every generated/saved draft, carries `format`) and
 * the content_pipeline editorial board (carries `content_type` + `status`).
 * Neither API filters by date, so we pull recent rows and bucket them into the
 * current vs prior window client-side.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  BarRow,
  fmtNum,
  inRange,
  Kpi,
  type PeriodKey,
  prettyDate,
  pctDelta,
  ReportFrame,
  Section,
  windowForPeriod,
} from "@/app/reporting/report-ui";

type DraftRow = { id: string; format?: string; title?: string | null; topic?: string; status?: string; practice_area?: string | null; created_at?: string };
type PipelineItem = { id: number; title: string; content_type?: string; bucket?: string; status?: string; created_at?: string; status_updated_at?: string };
type PipelineStats = { total: number; byStatus?: Record<string, number>; byBucket?: Record<string, number> };

const FORMAT_LABELS: Record<string, string> = {
  blog: "Blog post",
  km_blog_post: "Blog post (KM)",
  km_practice_page: "Practice page",
  km_case_result: "Case result",
  linkedin: "LinkedIn",
  twitter: "X / Twitter",
  facebook: "Facebook",
  instagram: "Instagram",
  email: "Email",
  podcast: "Podcast",
  video_short: "Short video",
  video_long: "Long video",
};
function formatLabel(raw?: string): string {
  if (!raw) return "Other";
  return FORMAT_LABELS[raw] ?? raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function titleCase(raw?: string): string {
  if (!raw) return "—";
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ProductionReport({ period }: { period: PeriodKey }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [pipeline, setPipeline] = useState<PipelineItem[]>([]);
  const [pipelineStats, setPipelineStats] = useState<PipelineStats | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dRes, pRes] = await Promise.all([
        fetch(`/api/content/drafts?limit=200`, { cache: "no-store" }),
        fetch(`/api/content/pipeline`, { cache: "no-store" }),
      ]);
      const [dJson, pJson] = await Promise.all([
        dRes.ok ? dRes.json() : Promise.resolve({ drafts: [] }),
        pRes.ok ? pRes.json() : Promise.resolve({ items: [], stats: null }),
      ]);
      setDrafts((dJson.drafts ?? []) as DraftRow[]);
      setPipeline((pJson.items ?? []) as PipelineItem[]);
      setPipelineStats((pJson.stats ?? null) as PipelineStats | null);
    } catch (e) {
      setError((e as Error).message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const w = useMemo(() => windowForPeriod(period), [period]);

  const stats = useMemo(() => {
    const curDrafts = drafts.filter((d) => inRange(d.created_at ?? "", w.since, w.until));
    const priorDrafts = drafts.filter((d) => inRange(d.created_at ?? "", w.prevSince, w.prevUntil));

    // Count by format (current window).
    const byFormat = new Map<string, number>();
    for (const d of curDrafts) {
      const k = formatLabel(d.format);
      byFormat.set(k, (byFormat.get(k) ?? 0) + 1);
    }
    const formatRows = [...byFormat.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);

    // Pipeline: items published in this window, grouped by content_type.
    const publishedNow = pipeline.filter((p) => p.status === "published" && inRange(p.status_updated_at ?? p.created_at ?? "", w.since, w.until));
    const byType = new Map<string, number>();
    for (const p of publishedNow) {
      const k = titleCase(p.content_type) || "Other";
      byType.set(k, (byType.get(k) ?? 0) + 1);
    }
    const typeRows = [...byType.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);

    return {
      curCount: curDrafts.length,
      priorCount: priorDrafts.length,
      formatRows,
      publishedCount: publishedNow.length,
      typeRows,
      recent: [...curDrafts]
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
        .slice(0, 12),
      truncated: drafts.length >= 200,
    };
  }, [drafts, pipeline, w]);

  const maxFormat = Math.max(1, ...stats.formatRows.map((r) => r.count));
  const maxType = Math.max(1, ...stats.typeRows.map((r) => r.count));
  const inFlight = pipelineStats?.byStatus
    ? Object.entries(pipelineStats.byStatus).filter(([s]) => s !== "published")
    : [];

  if (loading) return <p className="text-slate-500">Compiling report…</p>;
  if (error) return <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">{error}</div>;

  return (
    <ReportFrame
      title={`Content Production — ${w.label}`}
      periodLabel={`${prettyDate(w.since)} – ${prettyDate(w.until)} (${w.days} days) · compared to ${prettyDate(w.prevSince)} – ${prettyDate(w.prevUntil)}`}
      footer="Counts are drawn from content_drafts (every generated/saved draft) and the content pipeline board. Drafts are bucketed by creation date; published counts use the pipeline status date. Up to 200 most-recent drafts are scanned per load."
    >
      <Section num={1} title="Output at a glance" blurb={`What the content team produced this ${w.periodWord}.`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Pieces created" value={fmtNum(stats.curCount)} pct={pctDelta(stats.curCount, stats.priorCount)} hint={`vs ${fmtNum(stats.priorCount)} ${w.priorWord}`} />
          <Kpi label="Published" value={fmtNum(stats.publishedCount)} hint="moved live this period" />
          <Kpi label="Distinct formats" value={fmtNum(stats.formatRows.length)} />
          <Kpi label="In the pipeline" value={fmtNum(inFlight.reduce((s, [, n]) => s + n, 0))} hint="not yet published" />
        </div>
        {stats.truncated ? (
          <p className="text-xs text-amber-700">Showing the 200 most-recent drafts — counts for a high-volume month may be conservative.</p>
        ) : null}
      </Section>

      <Section num={2} title="Created by content type" blurb="Every piece generated this period, grouped by format.">
        {stats.formatRows.length ? (
          <div className="space-y-2 rounded-xl border border-slate-200 p-4">
            {stats.formatRows.map((r) => (
              <BarRow key={r.label} label={r.label} value={r.count} max={maxFormat} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            No drafts created in this window. Generate content from the{" "}
            <Link href="/content/batch" className="text-[#4F46E5] hover:underline print:no-underline">Batch Generator</Link> or{" "}
            <Link href="/content" className="text-[#4F46E5] hover:underline print:no-underline">Marketing copy</Link>.
          </p>
        )}
      </Section>

      <Section num={3} title="Published by channel" blurb="Pieces that moved to “published” on the production board this period.">
        {stats.typeRows.length ? (
          <div className="space-y-2 rounded-xl border border-slate-200 p-4">
            {stats.typeRows.map((r) => (
              <BarRow key={r.label} label={r.label} value={r.count} max={maxType} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Nothing marked published this {w.periodWord} on the production board.</p>
        )}
      </Section>

      {inFlight.length ? (
        <Section num={4} title="Pipeline health" blurb="Current editorial backlog — work in progress not yet shipped.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {inFlight.map(([status, n]) => (
              <Kpi key={status} label={titleCase(status)} value={fmtNum(n)} />
            ))}
          </div>
          <p className="text-xs text-slate-400">
            Manage the queue on the{" "}
            <Link href="/content/pipeline" className="text-[#4F46E5] hover:underline print:no-underline">Production Board</Link>.
          </p>
        </Section>
      ) : null}

      {stats.recent.length ? (
        <Section num={inFlight.length ? 5 : 4} title="Recently produced" blurb="The latest pieces created in this window.">
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Title / topic</th>
                  <th className="px-3 py-2 font-medium">Format</th>
                  <th className="px-3 py-2 font-medium">Practice area</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.recent.map((d) => (
                  <tr key={d.id} className="text-slate-700">
                    <td className="px-3 py-2 font-medium text-slate-900">{d.title || d.topic || "Untitled"}</td>
                    <td className="px-3 py-2">{formatLabel(d.format)}</td>
                    <td className="px-3 py-2">{d.practice_area ?? "—"}</td>
                    <td className="px-3 py-2">{titleCase(d.status)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.created_at ? prettyDate(d.created_at) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}
    </ReportFrame>
  );
}
