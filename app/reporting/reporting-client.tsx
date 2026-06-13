"use client";

/**
 * Reporting shell — picks the report TYPE (Performance / Production / Trends /
 * Custom) and the PERIOD, then renders the matching report. The period options
 * depend on the type: standard reports use calendar windows (last week / last
 * month) plus rolling 30 days; Trends uses rolling 7 / 14 / 30-day windows.
 * Each report owns its own data loading; this component only holds the
 * selectors and the print button.
 */

import { useState } from "react";

import { CustomReport } from "@/app/reporting/custom-report";
import { PerformanceReport } from "@/app/reporting/performance-report";
import { ProductionReport } from "@/app/reporting/production-report";
import {
  PERIOD_LABEL,
  type PeriodKey,
  STANDARD_PERIODS,
  TRENDS_PERIODS,
} from "@/app/reporting/report-ui";
import { TrendsReport } from "@/app/reporting/trends-report";

type ReportType = "performance" | "production" | "trends" | "custom";

const TYPES: { key: ReportType; label: string; icon: string }[] = [
  { key: "performance", label: "Performance", icon: "📈" },
  { key: "production", label: "Production", icon: "📝" },
  { key: "trends", label: "Trends", icon: "🔀" },
  { key: "custom", label: "Custom", icon: "✨" },
];

function periodsFor(type: ReportType): PeriodKey[] {
  return type === "trends" ? TRENDS_PERIODS : STANDARD_PERIODS;
}

export function ReportingClient() {
  const [type, setType] = useState<ReportType>("performance");
  const [period, setPeriod] = useState<PeriodKey>("last-week");

  const periodOptions = periodsFor(type);

  function changeType(next: ReportType) {
    setType(next);
    const opts = periodsFor(next);
    if (!opts.includes(period)) setPeriod(opts[0]);
  }

  return (
    <div className="space-y-6">
      {/* Controls — hidden when printing. */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <div className="inline-flex flex-wrap gap-1 rounded-lg border border-[#e2e8f0] bg-white p-0.5">
          {TYPES.map((t) => (
            <button
              key={t.key}
              onClick={() => changeType(t.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                type === t.key ? "bg-[#4F46E5] text-white" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span aria-hidden className="mr-1">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        <div className="inline-flex flex-wrap gap-1 rounded-lg border border-[#e2e8f0] bg-white p-0.5">
          {periodOptions.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                period === p ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>

        <button
          onClick={() => window.print()}
          className="ml-auto rounded-lg border border-[#e2e8f0] bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ⎙ Print / Save PDF
        </button>
      </div>

      {type === "performance" ? <PerformanceReport period={period} /> : null}
      {type === "production" ? <ProductionReport period={period} /> : null}
      {type === "trends" ? <TrendsReport period={period} /> : null}
      {type === "custom" ? <CustomReport period={period} /> : null}
    </div>
  );
}
