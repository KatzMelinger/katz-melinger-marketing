"use client";

/**
 * The Sources panel (Oct 20 spec, Task A7): every legal claim in the article
 * with its verdict, the source link and the quoted passage, so Diana and the
 * attorney can see the evidence. "Check sources" checks the claims that have
 * no result for this version.
 */
import { useCallback, useEffect, useState } from "react";

type Claim = {
  hash: string;
  sentence: string;
  type: string;
  kb_label: string | null;
  source_url: string | null;
  standing: "primary" | "reproduction" | "not_allowed";
  quote: string | null;
  verdict: "supported" | "contradicted" | "not_found" | "no_entry" | "answered";
  reason: string;
  closest?: string | null;
  question: string | null;
};
type Payload = { framed: boolean; attorney?: string | null; checkedAt?: string | null; claims: Claim[]; unchecked: { sentence: string; type: string }[] };

const VERDICT: Record<Claim["verdict"], { label: string; cls: string }> = {
  supported: { label: "Supported", cls: "bg-emerald-100 text-emerald-800" },
  answered: { label: "Attorney approved", cls: "bg-emerald-100 text-emerald-800" },
  contradicted: { label: "Contradicted", cls: "bg-rose-100 text-rose-800" },
  not_found: { label: "Needs a decision", cls: "bg-amber-100 text-amber-800" },
  no_entry: { label: "Needs a decision", cls: "bg-amber-100 text-amber-800" },
};

export function SourcesPanel({ draftId, nonce = 0, onChecked }: { draftId: string; nonce?: number; onChecked?: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/content/drafts/${draftId}/source-check`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setData(j as Payload | null))
      .catch(() => {});
  }, [draftId]);
  useEffect(load, [load, nonce]);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/content/drafts/${draftId}/source-check`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? `Checked ${j.checked} claim${j.checked === 1 ? "" : "s"}; ${j.reused} unchanged from the last check.` : (j.error ?? "The check failed."));
      load();
      onChecked?.();
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;
  if (!data.framed) return <p className="text-xs text-slate-500">Sources are checked once the draft is in the October 20 frame.</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Sources · {data.claims.length + data.unchecked.length} legal claim{data.claims.length + data.unchecked.length === 1 ? "" : "s"}
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || data.unchecked.length === 0}
          className="rounded border border-brand px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand/5 disabled:opacity-50"
          title={data.unchecked.length === 0 ? "Every claim has a result for this version" : undefined}
        >
          {busy ? "Checking…" : data.unchecked.length ? `Check sources (${data.unchecked.length})` : "All checked"}
        </button>
      </div>
      {msg && <p className="text-[11px] text-slate-600">{msg}</p>}
      {data.unchecked.length > 0 && (
        <p className="text-[11px] text-amber-800">
          {data.unchecked.length} claim{data.unchecked.length === 1 ? " has" : "s have"} not been checked against a source on this version.
        </p>
      )}
      <ul className="space-y-2">
        {data.claims.map((c) => (
          <li key={c.hash} className="rounded-md border border-slate-200 p-2 text-xs">
            <div className="flex items-start gap-2">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${VERDICT[c.verdict].cls}`}>{VERDICT[c.verdict].label}</span>
              <span className="text-slate-800">{c.sentence}</span>
            </div>
            {c.quote && (
              <blockquote className="mt-1.5 border-l-2 border-slate-300 pl-2 text-[11px] italic text-slate-600">&ldquo;{c.quote}&rdquo;</blockquote>
            )}
            <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-slate-500">
              {c.kb_label && <span>Entry: {c.kb_label}</span>}
              {c.source_url && (
                <a href={c.source_url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                  Source{c.standing === "reproduction" ? " (reproduction of official text)" : ""}
                </a>
              )}
            </div>
            {c.question && (
              <p className="mt-1 text-[11px] text-amber-900">
                For {data.attorney ?? "the reviewing attorney"}: {c.question}
                {c.closest ? ` Closest passage: "${c.closest.slice(0, 220)}"` : ""}
              </p>
            )}
            {c.verdict === "contradicted" && <p className="mt-1 text-[11px] text-rose-800">{c.reason}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
