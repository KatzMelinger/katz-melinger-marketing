"use client";

/**
 * The Ready checklist (Oct 20 spec, Task A4): each item with a check or the
 * exact reason it fails. The same list Approve enforces and the Production
 * Board's "Ready for Diana" column reads; nothing else blocks Approve.
 */
import type { Readiness } from "@/lib/draft-readiness";

export function ReadinessChecklist({ readiness, compact = false }: { readiness: Readiness | null; compact?: boolean }) {
  if (!readiness || !readiness.applicable) return null;
  const failing = readiness.items.filter((i) => !i.pass);
  return (
    <div
      className={`rounded-lg border p-3 ${readiness.ready ? "border-emerald-200 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}
    >
      <div className={`text-sm font-semibold ${readiness.ready ? "text-emerald-900" : "text-amber-900"}`}>
        {readiness.ready
          ? "Ready for Diana"
          : `Not ready: ${failing.length} item${failing.length === 1 ? "" : "s"} to resolve`}
      </div>
      <ul className="mt-2 space-y-1.5">
        {readiness.items
          .filter((i) => !compact || !i.pass || i.pending)
          .map((i) => (
            <li key={i.key} className="text-xs">
              <div className="flex items-start gap-1.5">
                <span
                  aria-hidden
                  className={`mt-px font-bold ${i.pending ? "text-slate-400" : i.pass ? "text-emerald-600" : "text-rose-600"}`}
                >
                  {i.pending ? "○" : i.pass ? "✓" : "✗"}
                </span>
                <span className={i.pending ? "text-slate-500" : "text-slate-800"}>{i.label}</span>
              </div>
              {i.reasons.map((r, n) => (
                <p key={n} className="ml-5 mt-0.5 text-[11px] text-rose-800">
                  {r}
                </p>
              ))}
              {(i.notes ?? []).map((r, n) => (
                <p key={`n${n}`} className="ml-5 mt-0.5 text-[11px] text-slate-500">
                  {r}
                </p>
              ))}
            </li>
          ))}
      </ul>
    </div>
  );
}
