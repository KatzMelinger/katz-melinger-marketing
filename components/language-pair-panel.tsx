"use client";

/**
 * English and Spanish versions as a pair (Oct 20 spec, Task A13). Paired
 * versions publish with hreflang tags pointing at each other.
 */
import { useCallback, useEffect, useState } from "react";

type Candidate = { id: string; title: string; status: string };

export function LanguagePairPanel({ draftId }: { draftId: string }) {
  const [language, setLanguage] = useState<"en" | "es">("en");
  const [pair, setPair] = useState<Candidate | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [choice, setChoice] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/content/drafts/${draftId}/language-pair`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        setLanguage(j.language);
        setPair(j.pair);
        setCandidates(j.candidates ?? []);
      })
      .catch(() => {});
  }, [draftId]);
  useEffect(load, [load]);

  const save = async (otherId: string | null) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/content/drafts/${draftId}/language-pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otherId }),
      });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? (otherId ? "Paired." : "Unpaired.") : (j.error ?? "Failed."));
      load();
    } finally {
      setBusy(false);
    }
  };

  const other = language === "es" ? "English" : "Spanish";
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{other} version</div>
      {pair ? (
        <div className="mt-1 flex items-center justify-between gap-2 text-xs">
          <a href={`/content/drafts?id=${pair.id}`} className="text-brand hover:underline">
            {pair.title} ({pair.status})
          </a>
          <button onClick={() => void save(null)} disabled={busy} className="rounded border border-slate-300 px-2 py-0.5 text-[11px] hover:bg-slate-50 disabled:opacity-50">
            Unpair
          </button>
        </div>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <select value={choice} onChange={(e) => setChoice(e.target.value)} className="max-w-xs rounded border border-slate-300 px-2 py-1">
            <option value="">Choose the {other} draft…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} ({c.status})
              </option>
            ))}
          </select>
          <button onClick={() => void save(choice)} disabled={busy || !choice} className="rounded border border-slate-300 px-2 py-0.5 text-[11px] hover:bg-slate-50 disabled:opacity-50">
            Pair
          </button>
        </div>
      )}
      <p className="mt-1 text-[11px] text-slate-500">Paired versions publish with hreflang tags pointing at each other.</p>
      {msg && <p className="mt-1 text-[11px] text-slate-600">{msg}</p>}
    </div>
  );
}
