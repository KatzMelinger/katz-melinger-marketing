"use client";

/**
 * Version history (Oct 20 spec, Task A17): every saved version of the draft,
 * newest first, each restorable.
 */
import { useCallback, useEffect, useState } from "react";

type Version = { id: string; title: string | null; reason: string; saved_by: string | null; saved_at: string; words: number };

export function VersionsPanel({ draftId, nonce = 0, onRestored }: { draftId: string; nonce?: number; onRestored: () => void }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [recorded, setRecorded] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/content/drafts/${draftId}/versions`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        setVersions(j?.versions ?? []);
        setRecorded(j?.recorded !== false);
      })
      .catch(() => {});
  }, [draftId]);
  useEffect(load, [load, nonce]);

  const restore = async (v: Version) => {
    if (!window.confirm(`Restore the version from ${new Date(v.saved_at).toLocaleString()}? The current text is kept as a version first.`)) return;
    setBusy(v.id);
    setMsg(null);
    try {
      const r = await fetch(`/api/content/drafts/${draftId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: v.id }),
      });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? "Restored." : (j.error ?? "Restore failed."));
      load();
      if (r.ok) onRestored();
    } finally {
      setBusy(null);
    }
  };

  if (!versions) return null;
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Version history</div>
      {!recorded ? (
        <p className="mt-1 text-xs text-slate-500">Versions are kept once supabase/system_health_a17.sql has been run.</p>
      ) : versions.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">No earlier versions yet.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {versions.slice(0, 20).map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-700">
                {new Date(v.saved_at).toLocaleString()} · {v.reason}
                {v.saved_by ? ` · ${v.saved_by.split("@")[0]}` : ""} · {v.words} words
              </span>
              <button onClick={() => void restore(v)} disabled={busy === v.id} className="shrink-0 rounded border border-slate-300 px-2 py-0.5 text-[11px] hover:bg-slate-50 disabled:opacity-50">
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="mt-1 text-[11px] text-slate-600">{msg}</p>}
    </div>
  );
}
