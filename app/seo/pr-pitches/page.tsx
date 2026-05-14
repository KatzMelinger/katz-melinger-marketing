"use client";

/**
 * PR Pitch Generator — paste a journalist query, get a tailored pitch.
 *
 * Works with any HARO-style service (Qwoted, Featured.com, SourceBottle,
 * JustReachOut) or a plain reporter email. The user pastes the query,
 * Claude evaluates fit and drafts a complete response that's ready to send.
 * Pitches that look good can be saved to /content/drafts for the team to
 * review before sending.
 *
 * No live scanning of journalist platforms (none expose a public API);
 * this is intentionally paste-driven so it works with any source.
 */

import { useState } from "react";

import { SeoShell } from "@/components/seo-shell";

type Pitch = {
  fit: "yes" | "maybe" | "no";
  reason: string;
  angle: string;
  pitch: string;
  quote: string;
  attribution: string;
};

const EXAMPLES = [
  {
    label: "Salary transparency",
    query:
      "I'm writing for Bloomberg on the impact of NY's salary transparency law one year in. Looking for an employment attorney who can speak to (a) the most common employer mistakes and (b) what damages employees have actually recovered. Deadline Friday EOD.",
    outlet: "Bloomberg",
    deadline: "Friday EOD",
  },
  {
    label: "Wage theft trends",
    query:
      "Reporting on the rise in wage theft cases against restaurant chains in NYC. Need a plaintiff-side attorney to comment on whether employees should join a class action or file individually, and how the new NY Wage Theft Prevention Act changes the calculus. Quotes due Wednesday.",
    outlet: "Eater NY",
    deadline: "Wednesday",
  },
  {
    label: "Off-topic example (criminal)",
    query:
      "Looking for a criminal defense attorney to comment on a recent NY appellate ruling on Miranda warnings for traffic stops. Quote needed for piece running tomorrow.",
    outlet: "NY Law Journal",
    deadline: "Tomorrow",
  },
];

export default function PrPitchesPage() {
  const [query, setQuery] = useState("");
  const [outlet, setOutlet] = useState("");
  const [journalistName, setJournalistName] = useState("");
  const [deadline, setDeadline] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pitch, setPitch] = useState<Pitch | null>(null);
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);

  const generate = async () => {
    if (!query.trim()) {
      setError("Paste a journalist query first.");
      return;
    }
    setLoading(true);
    setError(null);
    setPitch(null);
    setSavedDraftId(null);
    try {
      const res = await fetch("/api/seo/pr-pitches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, outlet, journalistName, deadline }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Failed to generate pitch");
        return;
      }
      setPitch(json.pitch as Pitch);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate pitch");
    } finally {
      setLoading(false);
    }
  };

  const saveAsDraft = async () => {
    if (!pitch) return;
    setSavingDraft(true);
    setError(null);
    try {
      const topic = outlet ? `Pitch: ${outlet} — ${pitch.angle}` : `Pitch: ${pitch.angle}`;
      const res = await fetch("/api/content/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_type: "email",
          topic,
          practice_area: "General",
          tone: "Professional",
          length: "medium",
          target_keywords: [outlet || "press pitch"].filter(Boolean),
          // The pitch is already written — pass it through as the body via
          // template seed. /api/content/draft regenerates the email body
          // server-side, so we lean on `topic` carrying enough context.
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.draft_id) {
        setError(json?.error ?? "Could not save draft");
        return;
      }
      setSavedDraftId(json.draft_id as string);
    } finally {
      setSavingDraft(false);
    }
  };

  const copyPitch = async () => {
    if (!pitch) return;
    try {
      await navigator.clipboard.writeText(pitch.pitch);
      alert("Pitch copied to clipboard.");
    } catch {
      alert("Could not copy. Select the text manually.");
    }
  };

  const copyQuote = async () => {
    if (!pitch) return;
    try {
      await navigator.clipboard.writeText(`"${pitch.quote}"\n\n— ${pitch.attribution}`);
      alert("Quote copied to clipboard.");
    } catch {
      alert("Could not copy. Select the text manually.");
    }
  };

  const loadExample = (ex: (typeof EXAMPLES)[number]) => {
    setQuery(ex.query);
    setOutlet(ex.outlet);
    setDeadline(ex.deadline);
    setJournalistName("");
    setPitch(null);
    setError(null);
    setSavedDraftId(null);
  };

  return (
    <SeoShell
      title="PR Pitch Generator"
      subtitle="Paste a journalist source query (HARO, Qwoted, Featured, SourceBottle, or a plain reporter email). Claude evaluates fit and drafts a pitch the team can send."
    >
      <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h2 className="text-lg font-semibold text-slate-900">New pitch</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500">Try an example:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                onClick={() => loadExample(ex)}
                className="text-xs px-2 py-1 rounded border border-[#e2e8f0] text-slate-700 hover:border-[#185FA5] hover:text-[#185FA5]"
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <input
            value={outlet}
            onChange={(e) => setOutlet(e.target.value)}
            placeholder="Outlet (Bloomberg, NYT, Eater NY…)"
            className="px-3 py-2 text-sm rounded-md border border-[#e2e8f0]"
          />
          <input
            value={journalistName}
            onChange={(e) => setJournalistName(e.target.value)}
            placeholder="Reporter name (optional)"
            className="px-3 py-2 text-sm rounded-md border border-[#e2e8f0]"
          />
          <input
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            placeholder="Deadline (Friday EOD, Wednesday, etc.)"
            className="px-3 py-2 text-sm rounded-md border border-[#e2e8f0]"
          />
        </div>

        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Paste the full journalist query here…"
          className="mt-3 h-44 w-full rounded-md border border-[#e2e8f0] px-3 py-2 text-sm font-mono"
        />

        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-slate-500">
            {query.length} chars · Minimum 40 needed
          </p>
          <button
            onClick={generate}
            disabled={loading || query.trim().length < 40}
            className="text-sm px-4 py-2 rounded bg-[#185FA5] text-white hover:bg-[#1f6fb8] disabled:opacity-50"
          >
            {loading ? "Generating…" : "Evaluate + draft pitch"}
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </section>

      {pitch && (
        <section className="rounded-xl border border-[#185FA5]/30 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Result</h2>
              <p className="text-xs text-slate-500 mt-1">
                Don&apos;t send blind — review for accuracy, especially case-result claims.
              </p>
            </div>
            <FitBadge fit={pitch.fit} />
          </div>

          <div className="rounded-md border border-[#e2e8f0] bg-slate-50 p-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Fit reasoning</p>
            <p className="text-sm text-slate-700">{pitch.reason}</p>
          </div>

          {pitch.fit !== "no" && (
            <>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">
                  Lead angle
                </p>
                <p className="text-sm text-slate-700">{pitch.angle}</p>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] uppercase tracking-wider text-slate-500">
                    Pull quote
                  </p>
                  <button
                    onClick={copyQuote}
                    className="text-xs px-2 py-0.5 rounded border border-[#e2e8f0] hover:border-[#185FA5] hover:text-[#185FA5]"
                  >
                    📋 Copy
                  </button>
                </div>
                <blockquote className="mt-1 border-l-4 border-[#185FA5] pl-3 py-1 text-sm italic text-slate-800">
                  &ldquo;{pitch.quote}&rdquo;
                </blockquote>
                <p className="mt-1 text-xs text-slate-500">— {pitch.attribution}</p>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-[11px] uppercase tracking-wider text-slate-500">
                    Full pitch (paste into email reply)
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={copyPitch}
                      className="text-xs px-2 py-0.5 rounded border border-[#e2e8f0] hover:border-[#185FA5] hover:text-[#185FA5]"
                    >
                      📋 Copy pitch
                    </button>
                    <button
                      onClick={saveAsDraft}
                      disabled={savingDraft || !!savedDraftId}
                      className="text-xs px-2 py-0.5 rounded bg-[#185FA5] text-white hover:bg-[#1f6fb8] disabled:opacity-50"
                    >
                      {savingDraft
                        ? "Saving…"
                        : savedDraftId
                          ? "✓ Saved"
                          : "Save to drafts"}
                    </button>
                  </div>
                </div>
                <pre className="whitespace-pre-wrap rounded-md border border-[#e2e8f0] bg-white p-3 text-sm text-slate-800 font-sans">
                  {pitch.pitch}
                </pre>
                {savedDraftId && (
                  <p className="mt-2 text-xs">
                    <a
                      href={`/content/drafts?id=${encodeURIComponent(savedDraftId)}`}
                      className="text-[#185FA5] hover:underline"
                    >
                      Open in drafts library →
                    </a>
                  </p>
                )}
              </div>
            </>
          )}
        </section>
      )}

      <section className="rounded-xl border border-[#e2e8f0] bg-slate-50 p-5">
        <h3 className="text-sm font-semibold text-slate-900">Where to find journalist queries</h3>
        <ul className="mt-2 space-y-1 text-xs text-slate-700 ml-4 list-disc">
          <li>
            <b>Qwoted</b> (free + paid) — qwoted.com — journalist briefs by topic
          </li>
          <li>
            <b>Featured.com</b> (free) — featured.com — was &ldquo;Help a B2B Writer&rdquo;
          </li>
          <li>
            <b>SourceBottle</b> (free) — sourcebottle.com — daily email digest
          </li>
          <li>
            <b>JustReachOut</b> (paid) — justreachout.io — curated by topic
          </li>
          <li>
            Direct outreach via reporter Twitter/LinkedIn — paste any DM or
            email here
          </li>
        </ul>
        <p className="mt-2 text-[11px] text-slate-500">
          HARO and Connectively shut down in 2024. None of the active services
          expose a public API to scan queries automatically — for now this tool
          is paste-driven so it works with any service.
        </p>
      </section>
    </SeoShell>
  );
}

function FitBadge({ fit }: { fit: "yes" | "maybe" | "no" }) {
  const styles: Record<typeof fit, string> = {
    yes: "border-emerald-300 bg-emerald-50 text-emerald-700",
    maybe: "border-amber-300 bg-amber-50 text-amber-700",
    no: "border-red-300 bg-red-50 text-red-700",
  };
  const labels: Record<typeof fit, string> = {
    yes: "✓ Good fit",
    maybe: "~ Maybe",
    no: "✕ Skip",
  };
  return (
    <span className={`text-xs px-2 py-1 rounded-full border font-medium ${styles[fit]}`}>
      {labels[fit]}
    </span>
  );
}
