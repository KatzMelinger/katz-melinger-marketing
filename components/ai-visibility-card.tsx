/**
 * AI Visibility Tracker card (Huraqan design system §13).
 *
 * Shows, per AI engine, whether the firm appears in AI-generated answers —
 * Cited / Partial / Not found — from the latest completed AEO run. Engines with
 * no API key read "Not connected"; engines not yet scanned read "No data". When
 * no run exists yet, a hint links to the AEO page to run one. Nothing here is
 * fabricated: every tile reflects real run data or a real not-configured state.
 *
 * Presentational only — data is fetched server-side in app/page.tsx.
 */

import Link from "next/link";

import type { AiVisibilitySnapshot, AiVisibilityStatus } from "@/lib/dashboard-snapshots";

const STATUS_META: Record<AiVisibilityStatus, { label: string; className: string }> = {
  cited: { label: "Cited", className: "text-emerald-600" },
  partial: { label: "Partial", className: "text-amber-600" },
  "not-found": { label: "Not found", className: "text-red-600" },
  "no-data": { label: "No data", className: "text-slate-400" },
  unconnected: { label: "Off", className: "text-slate-300" },
};

export function AiVisibilityCard({
  snapshot,
  firmName,
}: {
  snapshot: AiVisibilitySnapshot;
  firmName?: string | null;
}) {
  const { platforms, hasRun, selfMentionRatePct, runDate } = snapshot;
  const who = firmName ?? "your firm";

  return (
    <section className="overflow-hidden rounded-[10px] border border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-100 px-3.5 py-3">
        <div className="min-w-0">
          <div className="text-[12.5px] font-bold text-slate-900">AI visibility tracker</div>
          <div className="mt-0.5 truncate text-[10px] text-slate-400">
            Is {who} appearing in AI-generated answers?
          </div>
        </div>
        <Link href="/aeo" className="shrink-0 text-[11px] font-semibold text-brand hover:underline">
          Full AI report
        </Link>
      </header>

      {platforms.length === 0 ? (
        <div className="px-3.5 py-8 text-center text-[12px] text-slate-400">
          AI visibility data isn&apos;t available yet.{" "}
          <Link href="/aeo" className="font-medium text-brand hover:underline">
            Open AEO →
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 p-3.5 sm:grid-cols-4">
            {platforms.map((p) => {
              const meta = STATUS_META[p.status];
              return (
                <div
                  key={p.id}
                  className="rounded-md border border-slate-100 bg-slate-50 p-3 text-center"
                >
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    {p.label}
                  </div>
                  <div className={`mt-1.5 text-[15px] font-bold leading-none ${meta.className}`}>
                    {meta.label}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">{p.detail}</div>
                </div>
              );
            })}
          </div>
          <div className="border-t border-slate-100 px-3.5 py-2 text-[11px] text-slate-500">
            {hasRun ? (
              <>
                Mentioned in <span className="font-semibold text-slate-700">{selfMentionRatePct}%</span> of
                AI answers
                {runDate ? ` · last scan ${new Date(runDate).toLocaleDateString()}` : ""}
              </>
            ) : (
              <>
                No AEO scan yet —{" "}
                <Link href="/aeo" className="font-medium text-brand hover:underline">
                  run one
                </Link>{" "}
                to measure citations.
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
