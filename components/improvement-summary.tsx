"use client";

/**
 * The Improvement summary (Oct 20 spec, Task A9), at the top of the review
 * screen: what Huraqan improved on its own, with the data behind it, and what
 * still needs a person, each naming who and the exact question. "Improve to
 * Ready" runs the loop again (up to three passes).
 */
import { useState } from "react";
import type { ImprovementRecord } from "@/lib/improve-to-ready-shared";

export function ImprovementSummary({
  draftId,
  improvement,
  onDone,
}: {
  draftId: string;
  improvement: ImprovementRecord | null | undefined;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMsg("Analyzing, improving and re-checking (up to three passes; this can take a few minutes)…");
    try {
      const r = await fetch(`/api/content/drafts/${draftId}/improve`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? null : (j.error ?? "Improve to Ready failed."));
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-sky-900">Improvement summary</div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-50"
        >
          {busy ? "Improving…" : "Improve to Ready"}
        </button>
      </div>
      {msg && <p className="mt-1 text-[11px] text-slate-600">{msg}</p>}
      {!improvement ? (
        <p className="mt-1 text-xs text-slate-600">
          Not run yet on this draft. Improve to Ready fixes what the system can, checks every legal claim against its source,
          and leaves only the decisions a person must make.
        </p>
      ) : (
        <div className="mt-1.5 space-y-2 text-xs">
          <p className="text-[11px] text-slate-500">
            Last run {new Date(improvement.at).toLocaleString()} · {improvement.passes} pass{improvement.passes === 1 ? "" : "es"} ·{" "}
            {improvement.ready ? "Ready for Diana" : "not ready yet"}
          </p>
          <div>
            <div className="font-medium text-slate-800">Improved by Huraqan</div>
            {improvement.improved.length ? (
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-slate-700">
                {improvement.improved.map((i, n) => (
                  <li key={n}>
                    {i.what} <span className="text-slate-500">({i.source})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500">Nothing the system could fix.</p>
            )}
          </div>
          <div>
            <div className="font-medium text-slate-800">Needs a person</div>
            {improvement.human.length ? (
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-amber-900">
                {improvement.human.map((h, n) => (
                  <li key={n}>{h}</li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500">Nothing.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
