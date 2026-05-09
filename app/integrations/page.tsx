"use client";

/**
 * Integrations health page.
 *
 * Lists every external service the dashboard talks to and shows whether it's
 * connected. For anything red/yellow, it tells the user exactly which env vars
 * are missing and what each integration unlocks.
 *
 * Never displays the actual secret values — only presence flags.
 */

import { useEffect, useState } from "react";

type Status = "connected" | "missing_env" | "needs_oauth" | "error";

type Integration = {
  id: string;
  label: string;
  category: "AI" | "Search" | "Social" | "Email" | "Calls" | "Database";
  status: Status;
  missing: string[];
  set: string[];
  hint?: string;
  feature_pages: string[];
};

type Payload = {
  integrations: Integration[];
  summary: {
    connected: number;
    missing_env: number;
    needs_oauth: number;
    error: number;
    total: number;
  };
};

const CATEGORY_ORDER: Integration["category"][] = ["Database", "AI", "Search", "Calls", "Email", "Social"];

function statusLabel(s: Status): string {
  switch (s) {
    case "connected":
      return "Connected";
    case "missing_env":
      return "Missing env vars";
    case "needs_oauth":
      return "Needs OAuth";
    case "error":
      return "Error";
  }
}

function statusTone(s: Status): { dot: string; pill: string } {
  switch (s) {
    case "connected":
      return { dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "missing_env":
      return { dot: "bg-red-500", pill: "bg-red-50 text-red-700 border-red-200" };
    case "needs_oauth":
      return { dot: "bg-amber-500", pill: "bg-amber-50 text-amber-700 border-amber-200" };
    case "error":
      return { dot: "bg-red-600", pill: "bg-red-100 text-red-800 border-red-300" };
  }
}

export default function IntegrationsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/integrations/status", { cache: "no-store" });
      const json = await res.json();
      setData(json);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Every external service the dashboard depends on. Anything red or
            amber blocks the features listed in the right column.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium border border-slate-300 hover:border-[#185FA5] hover:text-[#185FA5] disabled:opacity-50"
        >
          {loading ? "Checking…" : "Re-check"}
        </button>
      </div>

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <SummaryTile label="Total" value={data.summary.total} />
          <SummaryTile label="Connected" value={data.summary.connected} tone="emerald" />
          <SummaryTile label="Missing env" value={data.summary.missing_env} tone="red" />
          <SummaryTile label="Needs OAuth" value={data.summary.needs_oauth} tone="amber" />
          <SummaryTile label="Errors" value={data.summary.error} tone="red" />
        </div>
      )}

      {!data && loading && (
        <div className="border border-slate-200 rounded-lg p-10 text-center text-sm text-slate-500">
          Checking integrations…
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {CATEGORY_ORDER.filter((cat) => data.integrations.some((i) => i.category === cat)).map((cat) => (
            <div key={cat}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                {cat}
              </h2>
              <div className="space-y-2">
                {data.integrations
                  .filter((i) => i.category === cat)
                  .map((i) => (
                    <IntegrationRow key={i.id} integration={i} />
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "amber" | "red";
}) {
  const color =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "amber"
        ? "text-amber-700"
        : tone === "red"
          ? "text-red-700"
          : "text-slate-900";
  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}

function IntegrationRow({ integration }: { integration: Integration }) {
  const tones = statusTone(integration.status);
  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${tones.dot}`} aria-hidden />
          <span className="text-sm font-semibold">{integration.label}</span>
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium border ${tones.pill}`}>
            {statusLabel(integration.status)}
          </span>
        </div>
        <div className="flex flex-wrap gap-1 text-[11px] text-slate-500">
          {integration.feature_pages.map((p) => (
            <a key={p} href={p} className="px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 hover:border-[#185FA5] hover:text-[#185FA5]">
              {p}
            </a>
          ))}
        </div>
      </div>

      {integration.hint && (
        <p className="text-xs text-slate-600 mt-2">{integration.hint}</p>
      )}

      {(integration.missing.length > 0 || integration.set.length > 0) && (
        <div className="mt-3 grid sm:grid-cols-2 gap-3 text-xs">
          {integration.missing.length > 0 && (
            <div>
              <div className="font-medium text-red-700 mb-1">Missing env vars</div>
              <ul className="space-y-1">
                {integration.missing.map((e) => (
                  <li key={e}>
                    <code className="px-1.5 py-0.5 rounded bg-red-50 border border-red-200 text-red-800 font-mono text-[11px]">
                      {e}
                    </code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {integration.set.length > 0 && (
            <div>
              <div className="font-medium text-emerald-700 mb-1">Set</div>
              <ul className="space-y-1">
                {integration.set.map((e) => (
                  <li key={e}>
                    <code className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-mono text-[11px]">
                      {e}
                    </code>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
