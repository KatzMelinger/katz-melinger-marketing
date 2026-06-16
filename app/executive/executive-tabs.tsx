"use client";

/**
 * Executive workspace. Folds the former /reporting page (board-ready
 * weekly/monthly reports) in alongside the executive dashboard, since both are
 * cross-funnel period-over-period views of the same spend→revenue funnel.
 * Two tabs, one place.
 *
 * The initial tab can be deep-linked via ?tab=reporting (used by the legacy
 * /reporting redirect).
 */

import { useState } from "react";

import { ExecutiveClient } from "@/app/executive/executive-client";
import { ReportingClient } from "@/app/reporting/reporting-client";

type TabId = "executive" | "reporting";

const COPY: Record<TabId, string> = {
  executive:
    "One board, end to end: spend → site sessions → calls → intakes → matters → revenue. Pick a date range and every figure compares against the equally-long period before it.",
  reporting:
    "Board-ready marketing reports. Switch between the weekly operating pulse and the monthly strategic review — every figure compares against the equally-long period before it. Print or save to PDF to circulate.",
};

export function ExecutiveTabs({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<TabId>(initialTab === "reporting" ? "reporting" : "executive");

  const tabBtn = (id: TabId, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
        tab === id
          ? "bg-white text-slate-900 ring-1 ring-brand/50"
          : "text-slate-500 hover:bg-slate-50/60 hover:text-slate-900"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {tab === "reporting" ? "Reporting" : "Executive dashboard"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{COPY[tab]}</p>
        <div className="mt-4 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
          {tabBtn("executive", "Executive")}
          {tabBtn("reporting", "Reporting")}
        </div>
      </div>

      {tab === "reporting" ? <ReportingClient /> : <ExecutiveClient />}
    </div>
  );
}
