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
    const restore = () => {
      // One live draft per topic (Oct 20 spec, Task A3): bringing this draft
      // back archives the version that was kept in its place.
      const swap = info?.duplicate_of
        ? `Restoring this draft archives ${keeperTitle ? `"${keeperTitle}"` : "the version we kept"} in its place, so two live drafts never share a keyword. Continue?`
        : "Restore this draft?";
      if (!window.confirm(swap)) return;
      void call({ action: "restore" });
    };
    const when = info?.archived_at ? new Date(info.archived_at).toLocaleDateString() : null;
    return (
      <div className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-xs text-slate-800">
        <p>
          <span className="font-semibold">
            Archived{when ? ` on ${when}` : ""}: {info?.reason ?? "no reason recorded"}.
          </span>
          {info?.duplicate_of && (
            <>
              {" "}The version we kept is{" "}
              <span className="font-medium">{keeperTitle ? `"${keeperTitle}"` : info.duplicate_of.slice(0, 8)}</span>.
            </>
          )}
          {info?.archived_by ? ` Archived by ${info.archived_by.split("@")[0]}.` : ""} This copy is read only.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {info?.duplicate_of && (
            <a
              href={`/content/drafts?id=${info.duplicate_of}`}
              className="rounded bg-brand px-2 py-1 text-[11px] font-medium text-white hover:bg-brand/90"
            >
              Open the version we kept
            </a>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={restore}
            className="rounded border border-slate-400 bg-white px-2 py-1 text-[11px] font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            Restore
          </button>
        </div>
        {msg && <p className="mt-1 text-[11px] text-rose-700">{msg}</p>}
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

/**
 * The whole review screen for an archived draft (Oct 20 spec, Task A3): the
 * banner and the text, read only. No Approve, Send back, Edit, Apply fix,
 * findings or compliance panels, so an archived copy can never be mistaken
 * for the live one.
 */
export function ArchivedDraftView({
  draftId,
  metadata,
  title,
  html,
  proseClass = "",
  onChanged,
}: {
  draftId: string;
  metadata: Record<string, unknown> | null | undefined;
  title: string | null | undefined;
  html: string;
  proseClass?: string;
  onChanged: () => void;
}) {
  return (
    <div className="space-y-3">
      <ArchiveBanner draftId={draftId} status="archived" metadata={metadata} onChanged={onChanged} />
      {title && <h3 className="text-base font-semibold text-slate-700">{title}</h3>}
      <div
        className={`max-h-[70vh] overflow-y-auto rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 ${proseClass}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
