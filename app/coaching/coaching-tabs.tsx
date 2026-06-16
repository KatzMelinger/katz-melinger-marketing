"use client";

/**
 * Unified coaching workspace. Folds the former "Sales Coach" page
 * (/settings/sales-training — the rubric + SOPs the AI uses to score calls)
 * into the same surface as per-rep coaching rollups, since one configures the
 * scoring the other reports on. Two tabs, one place.
 *
 * The initial tab can be deep-linked via ?tab=rubric (used by the legacy
 * /settings/sales-training redirect).
 */

import { useState } from "react";

import { CoachingClient } from "@/app/coaching/coaching-client";
import { SalesTrainingClient } from "@/app/settings/sales-training/sales-training-client";

type TabId = "coaching" | "rubric";

const COPY: Record<TabId, string> = {
  coaching:
    "Per-rep rollups from AI-scored calls — average score, trend, and the rubric dimensions each person most consistently loses points on. Use this to target 1:1 coaching.",
  rubric:
    "The materials and rubric the AI uses to score every call. Defaults come from the firm's SOPs (5.1.x and 5.2.x). Edit a rubric dimension and the change applies to every future scoring run.",
};

export function CoachingTabs({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<TabId>(initialTab === "rubric" ? "rubric" : "coaching");

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
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Coaching</h1>
        <p className="mt-1 text-sm text-slate-500">{COPY[tab]}</p>
        <div className="mt-4 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
          {tabBtn("coaching", "Agent Coaching")}
          {tabBtn("rubric", "Sales Coach")}
        </div>
      </div>

      {tab === "coaching" ? <CoachingClient /> : <SalesTrainingClient />}
    </div>
  );
}
