"use client";

/**
 * "Archived as a duplicate of <keeper>" with Restore, or, on a live draft, a
 * small Archive control (Sept 28 spec, Appendix F). Archiving never deletes.
 */
import { useEffect, useState } from "react";

type Props = {
  draftId: string;
  status: string | null | undefined;
  metadata: Record<string, unknown> | null | undefined;
  onChanged: () => void;
};

type Archive = { duplicate_of: string | null; reason: string; archived_by: string | null; archived_at: string };

export function ArchiveBanner({ draftId, status, metadata, onChanged }: Props) {
  const info = (metadata?.archive as Archive | undefined) ?? null;
  const [keeperTitle, setKeeperTitle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setKeeperTitle(null);
    if (status !== "archived" || !info?.duplicate_of) return;
    fetch(`/api/content/drafts/${info.duplicate_of}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setKeeperTitle(d?.draft?.title ?? d?.draft?.topic ?? null))
      .catch(() => {});
  }, [status, info?.duplicate_of]);

  const call = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/content/drafts/${draftId}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data?.error ?? "That did not work.");
        return;
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  if (status === "archived") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-xs text-slate-800">
        <span>
          <span className="font-semibold">
            {info?.duplicate_of
              ? `Archived as a duplicate of ${keeperTitle ? `"${keeperTitle}"` : info.duplicate_of.slice(0, 8)}`
              : `Archived${info?.reason ? ` (${info.reason})` : ""}`}
          </span>
          {info?.archived_by ? ` by ${info.archived_by.split("@")[0]}` : ""}
          {info?.archived_at ? ` on ${new Date(info.archived_at).toLocaleDateString()}` : ""}. Nothing was deleted.
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void call({ action: "restore" })}
          className="rounded border border-slate-400 bg-white px-2 py-1 text-[11px] font-medium hover:bg-slate-50 disabled:opacity-50"
        >
          Restore
        </button>
        {msg && <span className="w-full text-[11px] text-rose-700">{msg}</span>}
      </div>
    );
  }

  const archive = () => {
    const keeper = window.prompt(
      'Archive this draft. Paste the id of the draft to KEEP if this is a duplicate, or type "off practice".',
    );
    if (!keeper?.trim()) return;
    const k = keeper.trim();
    void call(
      /^off\s*practice$/i.test(k)
        ? { action: "archive", reason: "Off practice" }
        : { action: "archive", reason: "Duplicate", duplicateOf: k },
    );
  };

  return (
    <div className="text-right">
      <button
        type="button"
        disabled={busy}
        onClick={archive}
        className="text-[11px] text-slate-500 underline hover:text-slate-800 disabled:opacity-50"
        title="Archive as a duplicate or as off practice. Nothing is deleted; Restore brings it back."
      >
        Archive…
      </button>
      {msg && <p className="text-[11px] text-rose-700">{msg}</p>}
    </div>
  );
}
