"use client";

/**
 * Client tab wrapper for /reviews. Keeps the existing server-rendered overview
 * (passed as `children`) as the "Overview" tab, and mounts the client-side
 * review-generation workflow as the "Request reviews" tab. Initial tab can be
 * deep-linked via ?tab=requests.
 */

import { useState, type ReactNode } from "react";

import { ReviewRequestsPanel } from "@/components/review-requests-panel";

type Tab = "overview" | "requests";

export function ReviewsTabs({
  initialTab,
  children,
}: {
  initialTab?: string;
  children: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>(
    initialTab === "requests" ? "requests" : "overview",
  );

  const tabBtn = (id: Tab, label: string) => (
    <button
      onClick={() => setTab(id)}
      className={`border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
        tab === id
          ? "border-brand text-brand"
          : "border-transparent text-slate-500 hover:text-slate-700"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-8">
      <div className="flex gap-6 border-b border-[#e2e8f0]">
        {tabBtn("overview", "Overview")}
        {tabBtn("requests", "Request reviews")}
      </div>
      {/* Conditionally render (not just hide): the overview's Recharts
          ResponsiveContainers spin remeasuring inside a display:none parent.
          `children` is static server-rendered JSX, so re-showing is cheap. */}
      {tab === "overview" ? children : null}
      {tab === "requests" ? <ReviewRequestsPanel /> : null}
    </div>
  );
}
