"use client";

/**
 * Publishing to WordPress, safely (Oct 20 spec, Task A12): the plugin first
 * saves a WordPress draft (or, for a live page, a pending version) and reports
 * a preview link; "Publish live" is a separate step; a published page is
 * checked live and can be rolled back in one click. Buttons only for people
 * with publishing permission.
 */
import { useState } from "react";

type Wp = {
  state?: string;
  queued?: boolean;
  preview_url?: string | null;
  url?: string | null;
  go_live_requested?: boolean;
  rollback_requested?: boolean;
};
type LiveCheck = { at: string; url: string; pass: boolean; problems: string[]; linksChecked: number };

export function WordPressPublishPanel({
  draftId,
  status,
  metadata,
  canPublish,
  onChanged,
}: {
  draftId: string;
  status: string;
  metadata: Record<string, unknown> | null;
  canPublish: boolean;
  onChanged: () => void;
}) {
  const wp = ((metadata?.wp_publish as Wp | undefined) ?? {}) as Wp;
  const live = (metadata?.live_check as LiveCheck | undefined) ?? null;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const act = async (action: "go_live" | "rollback" | "live_check") => {
    if (action === "rollback" && !window.confirm("Restore the previous version of this page on the website?")) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/content/drafts/${draftId}/wp-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? (j.message ?? (j.liveCheck ? (j.liveCheck.pass ? "Live page check passed." : "Live page check found problems.") : "Done.")) : (j.error ?? "That did not work."));
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const btn = "mt-2 w-full rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <div className="space-y-2">
      {status === "approved" && wp.state === "wp_draft" && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
          <div className="text-sm font-semibold text-sky-900">Saved on WordPress, not live yet</div>
          <p className="mt-0.5 text-xs text-sky-700">Read it on the site first, then publish it live.</p>
          {wp.preview_url && (
            <a href={wp.preview_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium text-brand hover:underline">
              Open the WordPress preview
            </a>
          )}
          {wp.go_live_requested ? (
            <p className="mt-2 text-xs text-sky-800">Publish live requested: the site plugin does it on its next sync.</p>
          ) : (
            <button onClick={() => void act("go_live")} disabled={busy || !canPublish} className={`${btn} bg-brand text-white hover:bg-brand/90`} title={canPublish ? undefined : "Publishing permission required"}>
              {busy ? "Working…" : "Publish live"}
            </button>
          )}
        </div>
      )}
      {status === "published" && (
        <div className={`rounded-lg border p-3 ${live && !live.pass ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
          <div className="text-sm font-semibold text-slate-900">Live page</div>
          {wp.url && (
            <a href={wp.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand hover:underline">
              {wp.url}
            </a>
          )}
          {live ? (
            <div className="mt-1 text-xs">
              <p className={live.pass ? "text-emerald-800" : "text-rose-800"}>
                {live.pass ? "Live page check passed" : "Live page check found problems"} ({new Date(live.at).toLocaleString()}, {live.linksChecked} links checked)
              </p>
              {live.problems.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-rose-800">
                  {live.problems.slice(0, 8).map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="mt-1 text-xs text-slate-600">Not checked yet.</p>
          )}
          {wp.rollback_requested && <p className="mt-1 text-xs text-amber-800">Roll back requested: the site plugin restores the previous version on its next sync.</p>}
          {canPublish && (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => void act("live_check")} disabled={busy} className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
                Re-check live page
              </button>
              <button onClick={() => void act("rollback")} disabled={busy || wp.rollback_requested} className={`${btn} border border-rose-300 bg-white text-rose-700 hover:bg-rose-50`}>
                Roll back
              </button>
            </div>
          )}
        </div>
      )}
      {msg && <p className="text-[11px] text-slate-600">{msg}</p>}
    </div>
  );
}
