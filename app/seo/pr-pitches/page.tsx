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

import { useMemo, useState } from "react";

import { SeoShell } from "@/components/seo-shell";
import { parseHaroDigest, type HaroQuery } from "@/lib/haro-parser";

type Pitch = {
  fit: "yes" | "maybe" | "no";
  reason: string;
  angle: string;
  pitch: string;
  quote: string;
  attribution: string;
};

type ScreenResult = {
  index: number;
  fit: "yes" | "maybe" | "no";
  reason: string;
  angle: string;
};

type Mode = "single" | "haro";

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
  const [mode, setMode] = useState<Mode>("single");

  // Single-query mode
  const [query, setQuery] = useState("");
  const [outlet, setOutlet] = useState("");
  const [journalistName, setJournalistName] = useState("");
  const [deadline, setDeadline] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pitch, setPitch] = useState<Pitch | null>(null);
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);

  // HARO digest mode
  const [digestText, setDigestText] = useState("");
  const [parsedQueries, setParsedQueries] = useState<HaroQuery[]>([]);
  const [screening, setScreening] = useState(false);
  const [screenResults, setScreenResults] = useState<Record<number, ScreenResult>>({});
  const [perQueryPitch, setPerQueryPitch] = useState<Record<number, Pitch>>({});
  const [perQueryBusy, setPerQueryBusy] = useState<number | null>(null);
  const [showFitFilter, setShowFitFilter] = useState<"all" | "yes" | "maybe">("yes");

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

  // --- HARO digest workflow ---------------------------------------------

  const parseDigest = () => {
    setError(null);
    setScreenResults({});
    setPerQueryPitch({});
    const parsed = parseHaroDigest(digestText);
    setParsedQueries(parsed);
    if (parsed.length === 0) {
      setError("Couldn't find any queries in this digest. Paste the full email body, not just the table of contents.");
    }
  };

  const screenAll = async () => {
    if (parsedQueries.length === 0) return;
    setScreening(true);
    setError(null);
    try {
      const res = await fetch("/api/seo/pr-pitches/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queries: parsedQueries.map((q) => ({
            summary: q.summary,
            query: q.query,
            category: q.category,
            outlet: q.outlet,
            deadline: q.deadline,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Failed to screen queries");
        return;
      }
      const map: Record<number, ScreenResult> = {};
      for (const r of (json.results as ScreenResult[]) ?? []) map[r.index] = r;
      setScreenResults(map);
      // Auto-switch to "yes" filter if any fits found, else "all".
      const hasYes = Object.values(map).some((r) => r.fit === "yes");
      setShowFitFilter(hasYes ? "yes" : "all");
    } finally {
      setScreening(false);
    }
  };

  const draftPitchForQuery = async (idx: number) => {
    const q = parsedQueries[idx];
    if (!q) return;
    setPerQueryBusy(idx);
    setError(null);
    try {
      const res = await fetch("/api/seo/pr-pitches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q.query,
          outlet: q.outlet,
          deadline: q.deadline,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Failed to generate pitch");
        return;
      }
      setPerQueryPitch((m) => ({ ...m, [idx]: json.pitch as Pitch }));
    } finally {
      setPerQueryBusy(null);
    }
  };

  const filteredQueries = useMemo(() => {
    if (Object.keys(screenResults).length === 0) return parsedQueries;
    return parsedQueries.filter((_q, i) => {
      const fit = screenResults[i]?.fit;
      if (showFitFilter === "all") return true;
      if (showFitFilter === "yes") return fit === "yes";
      if (showFitFilter === "maybe") return fit === "yes" || fit === "maybe";
      return true;
    });
  }, [parsedQueries, screenResults, showFitFilter]);

  const screenCounts = useMemo(() => {
    const c = { yes: 0, maybe: 0, no: 0 };
    for (const r of Object.values(screenResults)) c[r.fit]++;
    return c;
  }, [screenResults]);

  return (
    <SeoShell
      title="PR Pitch Generator"
      subtitle="Single reporter email? Use Single mode. Morning HARO digest? Use HARO mode — paste the whole email and screen all 30-50 queries at once."
    >
      <div className="flex items-center gap-1 rounded-lg border border-[#e2e8f0] bg-white p-1 w-fit">
        <button
          onClick={() => setMode("single")}
          className={`text-xs px-3 py-1.5 rounded ${
            mode === "single"
              ? "bg-brand text-white"
              : "text-slate-700 hover:bg-slate-100"
          }`}
        >
          Single query
        </button>
        <button
          onClick={() => setMode("haro")}
          className={`text-xs px-3 py-1.5 rounded ${
            mode === "haro"
              ? "bg-brand text-white"
              : "text-slate-700 hover:bg-slate-100"
          }`}
        >
          HARO digest
        </button>
      </div>

      {mode === "haro" && (
        <>
          <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Paste HARO digest</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Copy the whole HARO email body (Cmd/Ctrl+A → Cmd/Ctrl+C in your inbox) and
                  paste here. We&apos;ll split it into individual queries and screen each one in
                  a single Claude call (~30 sec for 40 queries).
                </p>
              </div>
            </div>
            <textarea
              value={digestText}
              onChange={(e) => setDigestText(e.target.value)}
              placeholder="Paste the full HARO digest email body here…"
              className="h-64 w-full rounded-md border border-[#e2e8f0] px-3 py-2 text-xs font-mono"
            />
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <button
                onClick={parseDigest}
                disabled={!digestText.trim()}
                className="text-sm px-4 py-2 rounded border border-brand text-brand hover:bg-brand/5 disabled:opacity-50"
              >
                1. Parse digest
              </button>
              <button
                onClick={screenAll}
                disabled={parsedQueries.length === 0 || screening}
                className="text-sm px-4 py-2 rounded bg-brand text-white hover:bg-brand/90 disabled:opacity-50"
              >
                {screening
                  ? "Screening…"
                  : `2. Screen all ${parsedQueries.length || ""} queries`.trim()}
              </button>
              {parsedQueries.length > 0 && (
                <span className="text-xs text-slate-500">
                  {parsedQueries.length} queries detected
                </span>
              )}
              {Object.keys(screenResults).length > 0 && (
                <span className="text-xs text-slate-700 ml-2">
                  <span className="text-emerald-700 font-semibold">✓ {screenCounts.yes} yes</span>
                  {" · "}
                  <span className="text-amber-700">~ {screenCounts.maybe} maybe</span>
                  {" · "}
                  <span className="text-slate-500">✕ {screenCounts.no} no</span>
                </span>
              )}
            </div>
            {error && (
              <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
          </section>

          {parsedQueries.length > 0 && (
            <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <h2 className="text-lg font-semibold text-slate-900">
                  Queries
                  {Object.keys(screenResults).length > 0 && ` (${filteredQueries.length} of ${parsedQueries.length})`}
                </h2>
                {Object.keys(screenResults).length > 0 && (
                  <div className="flex items-center gap-1 rounded-lg border border-[#e2e8f0] bg-white p-1">
                    <button
                      onClick={() => setShowFitFilter("yes")}
                      className={`text-xs px-2 py-1 rounded ${
                        showFitFilter === "yes"
                          ? "bg-emerald-600 text-white"
                          : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      Fit only
                    </button>
                    <button
                      onClick={() => setShowFitFilter("maybe")}
                      className={`text-xs px-2 py-1 rounded ${
                        showFitFilter === "maybe"
                          ? "bg-amber-600 text-white"
                          : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      Yes + Maybe
                    </button>
                    <button
                      onClick={() => setShowFitFilter("all")}
                      className={`text-xs px-2 py-1 rounded ${
                        showFitFilter === "all"
                          ? "bg-slate-700 text-white"
                          : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      All
                    </button>
                  </div>
                )}
              </div>

              <ul className="space-y-3">
                {filteredQueries.length === 0 && (
                  <li className="text-sm text-slate-500">
                    No queries match this filter. Try widening to "All".
                  </li>
                )}
                {filteredQueries.map((q) => {
                  // Map filtered query back to its original index in parsedQueries
                  const idx = parsedQueries.indexOf(q);
                  const screen = screenResults[idx];
                  const pitchData = perQueryPitch[idx];
                  const isBusy = perQueryBusy === idx;
                  return (
                    <li
                      key={idx}
                      className="rounded-lg border border-[#e2e8f0] bg-white p-4"
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-slate-500 font-mono">
                              #{q.number}
                            </span>
                            {screen && <FitBadge fit={screen.fit} />}
                            {q.category && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-700">
                                {q.category}
                              </span>
                            )}
                            {q.outlet && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded border border-violet-200 bg-violet-50 text-violet-700">
                                {q.outlet}
                              </span>
                            )}
                            {q.deadline && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700">
                                ⏰ {q.deadline}
                              </span>
                            )}
                          </div>
                          <p className="mt-2 text-sm font-medium text-slate-900">
                            {q.summary || q.query.slice(0, 100)}
                          </p>
                          {screen && (
                            <p className="mt-1 text-xs italic text-slate-600">{screen.reason}</p>
                          )}
                          <details className="mt-2 text-xs text-slate-600">
                            <summary className="cursor-pointer text-brand hover:underline">
                              Show full query
                            </summary>
                            <p className="mt-1 whitespace-pre-wrap text-slate-700">{q.query}</p>
                            {q.requirements && (
                              <p className="mt-1 text-slate-600">
                                <b>Requirements:</b> {q.requirements}
                              </p>
                            )}
                          </details>
                        </div>
                        {screen && screen.fit !== "no" && !pitchData && (
                          <button
                            onClick={() => draftPitchForQuery(idx)}
                            disabled={isBusy}
                            className="shrink-0 text-xs px-3 py-1.5 rounded bg-brand text-white hover:bg-brand/90 disabled:opacity-50"
                          >
                            {isBusy ? "Drafting…" : "Draft pitch"}
                          </button>
                        )}
                      </div>
                      {pitchData && (
                        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50/50 p-3 space-y-2">
                          <p className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">
                            Drafted pitch
                          </p>
                          <blockquote className="border-l-4 border-brand pl-3 py-1 text-xs italic text-slate-800">
                            &ldquo;{pitchData.quote}&rdquo;
                            <span className="block mt-1 text-[10px] not-italic text-slate-500">
                              — {pitchData.attribution}
                            </span>
                          </blockquote>
                          <pre className="whitespace-pre-wrap rounded border border-[#e2e8f0] bg-white p-2 text-xs text-slate-800 font-sans">
                            {pitchData.pitch}
                          </pre>
                          <div className="flex gap-2 flex-wrap">
                            <button
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(pitchData.pitch);
                                  alert("Pitch copied.");
                                } catch {
                                  alert("Could not copy.");
                                }
                              }}
                              className="text-xs px-2 py-1 rounded border border-[#e2e8f0] hover:border-brand hover:text-brand"
                            >
                              📋 Copy pitch
                            </button>
                            <button
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(
                                    `"${pitchData.quote}"\n\n— ${pitchData.attribution}`,
                                  );
                                  alert("Quote copied.");
                                } catch {
                                  alert("Could not copy.");
                                }
                              }}
                              className="text-xs px-2 py-1 rounded border border-[#e2e8f0] hover:border-brand hover:text-brand"
                            >
                              📋 Copy quote
                            </button>
                            {q.email && (
                              <a
                                href={`mailto:${q.email}?subject=Re: ${encodeURIComponent(q.summary)}&body=${encodeURIComponent(pitchData.pitch)}`}
                                className="text-xs px-2 py-1 rounded bg-brand text-white hover:bg-brand/90"
                              >
                                ✉ Open email reply
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}

      {mode === "single" && (
        <>
      <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h2 className="text-lg font-semibold text-slate-900">New pitch</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500">Try an example:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                onClick={() => loadExample(ex)}
                className="text-xs px-2 py-1 rounded border border-[#e2e8f0] text-slate-700 hover:border-brand hover:text-brand"
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
            className="text-sm px-4 py-2 rounded bg-brand text-white hover:bg-brand/90 disabled:opacity-50"
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
        <section className="rounded-xl border border-brand/30 bg-white p-5 shadow-sm space-y-4">
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
                    className="text-xs px-2 py-0.5 rounded border border-[#e2e8f0] hover:border-brand hover:text-brand"
                  >
                    📋 Copy
                  </button>
                </div>
                <blockquote className="mt-1 border-l-4 border-brand pl-3 py-1 text-sm italic text-slate-800">
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
                      className="text-xs px-2 py-0.5 rounded border border-[#e2e8f0] hover:border-brand hover:text-brand"
                    >
                      📋 Copy pitch
                    </button>
                    <button
                      onClick={saveAsDraft}
                      disabled={savingDraft || !!savedDraftId}
                      className="text-xs px-2 py-0.5 rounded bg-brand text-white hover:bg-brand/90 disabled:opacity-50"
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
                      className="text-brand hover:underline"
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

        </>
      )}

      <section className="rounded-xl border border-[#e2e8f0] bg-slate-50 p-5">
        <h3 className="text-sm font-semibold text-slate-900">Where to find journalist queries</h3>
        <ul className="mt-2 space-y-1 text-xs text-slate-700 ml-4 list-disc">
          <li>
            <b>HARO (Help a Reporter Out)</b> — helpareporter.com — 3 daily email digests with
            30-50 queries; use HARO mode above to bulk-screen
          </li>
          <li>
            <b>Qwoted</b> (free + paid) — qwoted.com — journalist briefs by topic
          </li>
          <li>
            <b>Featured.com</b> (free) — featured.com — owns the HARO brand now
          </li>
          <li>
            <b>SourceBottle</b> (free) — sourcebottle.com — daily email digest
          </li>
          <li>
            <b>JustReachOut</b> (paid) — justreachout.io — curated by topic
          </li>
          <li>
            Direct outreach via reporter Twitter/LinkedIn — paste any DM or email in Single mode
          </li>
        </ul>
        <p className="mt-2 text-[11px] text-slate-500">
          None of these services expose a public API for automated query scanning, so this tool is
          paste-driven. HARO mode is optimized for the daily email format; Single mode works for
          everything else.
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
