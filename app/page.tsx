/**
 * Home — the executive board.
 *
 * Nine departments rendered in mockup order. The three daily-driver
 * departments (SEO Content, On-Page SEO, Off-Page SEO) are expanded with live
 * KPI strips plus detail (pipeline strip, tables); the remaining six are
 * collapsed KPI summaries the user can expand on demand.
 *
 * Structure comes from `lib/departments.ts`; data from
 * `lib/dashboard-snapshots.ts`. Both are fetched here on the server in parallel
 * and the detail is passed as children into the client `DepartmentPanel`
 * (server/client interleaving), which owns only the expand/collapse state.
 *
 * Detail pages for the call log, attribution, and reputation that used to live
 * on this page remain at /calls, /attribution, and /reviews.
 */

import type { Metadata } from "next";
import { Suspense } from "react";

import { DepartmentPanel } from "@/components/department-panel";
import { DEPARTMENTS } from "@/lib/departments";
import { APP_NAME } from "@/lib/app-config";
import { getTenantConfig } from "@/lib/tenant-config";
import {
  getAiVisibilityKpis,
  getCampaignsKpis,
  getExecutiveKpis,
  getIntelligenceKpis,
  getLocalKpis,
  getOffPageSnapshot,
  getOnPageSnapshot,
  getSeoContentSnapshot,
  getSocialKpis,
  getWorkspaceKpis,
  type LabeledCount,
  type Row2,
} from "@/lib/dashboard-snapshots";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Home | ${APP_NAME}`,
  description:
    "Executive marketing overview — content, rankings, authority, and every department at a glance.",
};

const ACCENT = Object.fromEntries(DEPARTMENTS.map((d) => [d.key, d.accent])) as Record<string, string>;

function deptLabel(key: string): string {
  return DEPARTMENTS.find((d) => d.key === key)?.label ?? key;
}

export default async function Home() {
  const { firmName } = await getTenantConfig();
  return (
    <main className="mx-auto max-w-[1400px] space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Marketing Intelligence</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {firmName ? `${firmName} · ` : ""}Content, rankings, and authority across every department.
        </p>
      </header>
      <Suspense fallback={<BoardSkeleton />}>
        <Board />
      </Suspense>
    </main>
  );
}

async function Board() {
  const [
    executiveKpis,
    seoContent,
    onPage,
    offPage,
    aiKpis,
    localKpis,
    campaignKpis,
    socialKpis,
    intelKpis,
    workspaceKpis,
  ] = await Promise.all([
    getExecutiveKpis(),
    getSeoContentSnapshot(),
    getOnPageSnapshot(),
    getOffPageSnapshot(),
    getAiVisibilityKpis(),
    getLocalKpis(),
    getCampaignsKpis(),
    getSocialKpis(),
    getIntelligenceKpis(),
    getWorkspaceKpis(),
  ]);

  return (
    <div className="space-y-5">
      {/* Executive summary — the top-of-funnel board overview, full width. */}
      <DepartmentPanel
        panelKey="executive"
        label="Executive Summary"
        accent="#0f172a"
        kpis={executiveKpis}
        defaultExpanded
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            Spend → sessions → calls → intakes → matters → revenue, end to end.
          </p>
          <a
            href="/executive"
            className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900"
          >
            Open full executive dashboard →
          </a>
        </div>
      </DepartmentPanel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      {/* Row 1 — the three daily-driver departments, expanded. */}
      <DepartmentPanel
        panelKey="seo-content"
        index={1}
        label={deptLabel("seo-content")}
        accent={ACCENT["seo-content"]}
        kpis={seoContent.kpis}
        defaultExpanded
      >
        <div className="space-y-4">
          <PipelineStrip stages={seoContent.pipelineStages} accent={ACCENT["seo-content"]} />
          <DetailTable
            title="Top Content Opportunities"
            rightHeader="Volume"
            rows={seoContent.topOpportunities}
            href="/seo/opportunities"
          />
        </div>
      </DepartmentPanel>

      <DepartmentPanel
        panelKey="on-page-seo"
        index={2}
        label={deptLabel("on-page-seo")}
        accent={ACCENT["on-page-seo"]}
        kpis={onPage.kpis}
        defaultExpanded
      >
        <div className="space-y-4">
          <ChartPlaceholder label="Rankings Over Time" />
          <div className="grid gap-4 sm:grid-cols-2">
            <DetailTable title="Top Landing Pages" rightHeader="Pos." rows={onPage.topLandingPages} href="/seo/keywords" />
            <DetailTable title="Issues to Fix" rightHeader="" rows={onPage.issues} href="/seo/technical" />
          </div>
        </div>
      </DepartmentPanel>

      <DepartmentPanel
        panelKey="off-page-seo"
        index={3}
        label={deptLabel("off-page-seo")}
        accent={ACCENT["off-page-seo"]}
        kpis={offPage.kpis}
        defaultExpanded
      >
        <div className="space-y-4">
          <ChartPlaceholder label="Backlinks Over Time" />
          <div className="grid gap-4 sm:grid-cols-2">
            <DetailTable title="Top Link Sources" rightHeader="Links" rows={offPage.topLinkSources} href="/seo/backlinks" />
            <DetailTable title="Link Opportunities" rightHeader="" rows={offPage.linkOpportunities} href="/seo/link-strategy" />
          </div>
        </div>
      </DepartmentPanel>

      {/* Rows 2-3 — collapsed summary departments. Expanding reveals quick
          links into that department's pages (sourced from the taxonomy). */}
      <DepartmentPanel panelKey="ai-visibility" index={4} label={deptLabel("ai-visibility")} accent={ACCENT["ai-visibility"]} kpis={aiKpis} defaultExpanded>
        <DeptLinks deptKey="ai-visibility" />
      </DepartmentPanel>
      <DepartmentPanel panelKey="local-seo" index={5} label={deptLabel("local-seo")} accent={ACCENT["local-seo"]} kpis={localKpis} defaultExpanded>
        <DeptLinks deptKey="local-seo" />
      </DepartmentPanel>
      <DepartmentPanel panelKey="campaigns" index={6} label={deptLabel("campaigns")} accent={ACCENT["campaigns"]} kpis={campaignKpis} defaultExpanded>
        <DeptLinks deptKey="campaigns" />
      </DepartmentPanel>
      <DepartmentPanel panelKey="social" index={7} label={deptLabel("social")} accent={ACCENT["social"]} kpis={socialKpis} defaultExpanded>
        <DeptLinks deptKey="social" />
      </DepartmentPanel>
      <DepartmentPanel panelKey="intelligence" index={8} label={deptLabel("intelligence")} accent={ACCENT["intelligence"]} kpis={intelKpis} defaultExpanded>
        <DeptLinks deptKey="intelligence" />
      </DepartmentPanel>
      <DepartmentPanel panelKey="workspace" index={9} label={deptLabel("workspace")} accent={ACCENT["workspace"]} kpis={workspaceKpis} defaultExpanded>
        <DeptLinks deptKey="workspace" />
      </DepartmentPanel>
      </div>
    </div>
  );
}

function DeptLinks({ deptKey }: { deptKey: string }) {
  const dept = DEPARTMENTS.find((d) => d.key === deptKey);
  const items = (dept?.items ?? []).filter((it) => !it.adminOnly);
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => (
        <a
          key={it.href}
          href={it.href}
          className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900"
        >
          {it.label}
        </a>
      ))}
    </div>
  );
}

// ── Server-rendered detail pieces (passed as children into the panels) ───────

function PipelineStrip({ stages, accent }: { stages: LabeledCount[]; accent: string }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Content Pipeline</p>
      <div className="grid grid-cols-5 gap-2">
        {stages.map((s) => (
          <div key={s.label} className="rounded-lg border border-slate-100 bg-slate-50 p-2 text-center">
            <p className="text-lg font-semibold tabular-nums" style={{ color: accent }}>
              {s.value}
            </p>
            <p className="truncate text-[10px] uppercase tracking-wide text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailTable({
  title,
  rightHeader,
  rows,
  href,
}: {
  title: string;
  rightHeader: string;
  rows: Row2[];
  href: string;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">
          No data yet
        </p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.left}-${i}`} className="border-b border-slate-100 last:border-0">
                <td className="truncate py-1.5 pr-2 text-slate-700">{r.left}</td>
                <td className="py-1.5 text-right tabular-nums font-medium text-slate-900">{r.right}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <a href={href} className="mt-2 inline-block text-xs font-medium text-brand hover:underline">
        View all →
      </a>
    </div>
  );
}

function ChartPlaceholder({ label }: { label: string }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-400">
        Trend history coming soon
      </div>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
      ))}
    </div>
  );
}
