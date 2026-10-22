"use client";

/**
 * Results (Oct 20 spec, Tasks A10 and A15): how each published page did at
 * 30 and 90 days, which content checks predict results, the corrections
 * made by hand that the system is re-checked against, and the quarterly scan
 * of every live page.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DashButton, DashCard, DashPill, DashSpinner } from "@/components/dashboard-ui";
import { PipelineStageNav } from "@/components/pipeline-stage-nav";
import type { CheckRow, ResultsPage, ResultSnapshot } from "@/lib/page-results";
import type { RegressionCase } from "@/lib/regression-cases";

type Scan = {
  url: string;
  title: string | null;
  scanned_at: string;
  kb_keys: string[];
  claims: number;
  trap_findings: { title: string; excerpt: string | null }[];
  source_entries: { sentence: string; verdict: string; reason: string; kb_key: string | null }[];
  error: string | null;
};
type Refresh = { kb_key: string; url: string; reason: string; draft_id: string | null; error: string | null; created_at: string };
type Data = {
  pages: ResultsPage[];
  report: CheckRow[];
  cases: RegressionCase[] | null;
  scans: Scan[] | null;
  livePages: number;
  refresh: Refresh[] | null;
  migrated: boolean;
  canConfirm: boolean;
  isAdmin: boolean;
};

const pct = (s: { pass: number; total: number }) => (s.total ? `${Math.round((s.pass / s.total) * 100)}% (${s.total})` : "—");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function Snap({ s }: { s?: ResultSnapshot }) {
  if (!s) return <span className="text-slate-400">not yet</span>;
  return (
    <span className="text-xs text-slate-700">
      pos {s.position ?? "none"} · {s.clicks} clicks · {s.impressions} impr · CTR {s.ctr}% · AI {s.ai_cited}/{s.ai_prompts} · {s.calls} calls · {s.forms} forms
    </span>
  );
}

export default function ResultsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [kbKey, setKbKey] = useState("");
  const [impact, setImpact] = useState<{ url: string; title: string | null; via: string; sentences: string[] }[] | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch("/api/content/results", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not load results.");
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: string, id?: string) => {
    setBusy(action + (id ?? ""));
    setNotice(null);
    try {
      const r = await fetch("/api/content/results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id }) });
      const j = await r.json().catch(() => ({}));
      setNotice(r.ok ? "Done." : (j.error ?? "Failed."));
      await load();
    } finally {
      setBusy(null);
    }
  };

  const lookImpact = async () => {
    if (!kbKey.trim()) return;
    setImpact(null);
    const r = await fetch(`/api/legal/kb-impact?key=${encodeURIComponent(kbKey.trim())}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    setImpact(j.pages ?? []);
  };
  const openRefreshes = async () => {
    setBusy("refresh");
    try {
      const r = await fetch("/api/legal/kb-impact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: kbKey.trim() }) });
      const j = await r.json().catch(() => ({}));
      setNotice(r.ok ? `Refresh drafts queued for ${j.pages} page${j.pages === 1 ? "" : "s"}. They appear on the Production board as they are written.` : (j.error ?? "Failed."));
    } finally {
      setBusy(null);
    }
  };

  if (error) return <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-red-700">{error}</div>;
  if (!data) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <DashSpinner />
      </div>
    );
  }

  const under = data.pages.filter((p) => p.results.underperforming);
  const scans = data.scans ?? [];
  const withErrors = scans.filter((s) => s.trap_findings.length || s.source_entries.some((e) => e.verdict === "contradicted"));

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <PipelineStageNav />
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Results</h1>
          <p className="mt-1 text-sm text-slate-600">
            How published pages did at 30 and 90 days, which checks predict results, the corrections the system now
            catches, and the quarterly check of every live page.
          </p>
        </div>
        <div className="flex gap-2">
          {data.isAdmin && (
            <>
              <DashButton onClick={() => void act("measure_now")} disabled={!!busy}>
                Measure now
              </DashButton>
              <DashButton onClick={() => void act("scan_now")} disabled={!!busy}>
                Scan 5 live pages
              </DashButton>
            </>
          )}
          <DashButton onClick={() => void load()}>Refresh</DashButton>
        </div>
      </div>
      {!data.migrated && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Run supabase/learn_results_a10_a15.sql to turn on regression cases, the live page scan and refresh requests.
        </p>
      )}
      {notice && <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">{notice}</p>}

      <DashCard>
        <h2 className="text-base font-semibold text-slate-900">Published pages ({data.pages.length})</h2>
        <p className="mt-1 text-xs text-slate-500">
          Underperforming at 90 days: outside the top 20 with fewer than 10 clicks, or not cited in any related AI answer.
          Those go to the <Link href="/content/refresh" className="text-brand hover:underline">Refresh Queue</Link> with the reason and the gaps.
        </p>
        {data.pages.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No pages published through Huraqan yet. Results start 30 days after the first one goes live.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {data.pages.map((p) => (
              <li key={p.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <a href={p.url} target="_blank" rel="noreferrer" className="font-medium text-slate-900 hover:underline">
                    {p.title ?? p.url}
                  </a>
                  <span className="text-xs text-slate-500">live {day(p.published_at)} · {p.keyword ?? "no keyword"}</span>
                  {p.results.underperforming ? <DashPill tone="amber">Underperforming</DashPill> : p.results.d90 ? <DashPill tone="emerald">Performing</DashPill> : null}
                </div>
                <div className="mt-1 grid gap-0.5">
                  <div>
                    <span className="mr-2 text-xs font-semibold text-slate-500">30 days</span>
                    <Snap s={p.results.d30} />
                  </div>
                  <div>
                    <span className="mr-2 text-xs font-semibold text-slate-500">90 days</span>
                    <Snap s={p.results.d90} />
                  </div>
                  {p.results.underperforming && <p className="text-xs text-amber-800">{p.results.underperforming.reasons.join(" ")}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {under.length > 0 && <p className="mt-2 text-xs text-slate-500">{under.length} underperforming.</p>}
      </DashCard>

      <DashCard>
        <h2 className="text-base font-semibold text-slate-900">Which checks predict results</h2>
        <p className="mt-1 text-xs text-slate-500">
          Pass rate of each content check on pages that performed and on pages that did not. Emailed to Diana on the 1st of
          each month. Thresholds change only with Diana&apos;s approval.
        </p>
        {data.report.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Needs pages with results first.</p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="pb-2 font-medium">Check</th>
                <th className="pb-2 font-medium">Performing</th>
                <th className="pb-2 font-medium">Underperforming</th>
                <th className="pb-2 font-medium">Predicts</th>
              </tr>
            </thead>
            <tbody>
              {data.report.map((r) => (
                <tr key={r.key} className="border-t border-slate-100">
                  <td className="py-1.5">{r.label}</td>
                  <td>{pct(r.performing)}</td>
                  <td>{pct(r.underperforming)}</td>
                  <td>{r.predicts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DashCard>

      <DashCard>
        <h2 className="text-base font-semibold text-slate-900">Corrections made by hand ({data.cases?.length ?? 0})</h2>
        <p className="mt-1 text-xs text-slate-500">
          Each correction Diana or an attorney makes in a draft becomes a case, re-run every day: it passes when the system
          now fixes or flags the original sentence. Fact corrections by Diana are learned once an attorney confirms them.
        </p>
        {!data.cases?.length ? (
          <p className="mt-3 text-sm text-slate-500">No corrections yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.cases.slice(0, 60).map((c) => (
              <li key={c.id} className={`rounded-md border p-2 text-sm ${c.enabled ? "border-slate-200" : "border-slate-100 opacity-60"}`}>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {c.last_result === "pass" ? <DashPill tone="emerald">Caught</DashPill> : c.last_result === "fail" ? <DashPill tone="red">Not caught</DashPill> : <DashPill tone="neutral">Not run yet</DashPill>}
                  {c.is_fact && <DashPill tone="violet">Fact</DashPill>}
                  {c.kb_status === "pending_attorney" && <DashPill tone="amber">Waiting for an attorney</DashPill>}
                  <span className="text-slate-500">
                    {c.by_email ?? "someone"} · {day(c.created_at)}
                    {c.draft_id ? (
                      <>
                        {" · "}
                        <Link href={`/content/drafts?id=${c.draft_id}`} className="text-brand hover:underline">
                          draft
                        </Link>
                      </>
                    ) : null}
                  </span>
                </div>
                <p className="mt-1 text-slate-500 line-through">{c.before_text}</p>
                <p className="text-slate-900">{c.after_text}</p>
                {c.last_detail && <p className="mt-1 text-xs text-slate-500">{c.last_detail}</p>}
                <div className="mt-1 flex gap-2">
                  {data.canConfirm && c.kb_status === "pending_attorney" && (
                    <DashButton onClick={() => void act("confirm_case", c.id)} disabled={!!busy}>
                      Confirm correction
                    </DashButton>
                  )}
                  {data.isAdmin && (
                    <DashButton onClick={() => void act(c.enabled ? "disable_case" : "enable_case", c.id)} disabled={!!busy}>
                      {c.enabled ? "Switch off" : "Switch on"}
                    </DashButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </DashCard>

      <DashCard>
        <h2 className="text-base font-semibold text-slate-900">Live pages</h2>
        <p className="mt-1 text-xs text-slate-500">
          Every blog and practice page on katzmelinger.com is checked once a quarter (traps and the source check), a batch
          each day. {scans.length} of {data.livePages} scanned; {withErrors.length} with errors.
        </p>
        {withErrors.length > 0 && (
          <ul className="mt-3 space-y-2">
            {withErrors.slice(0, 50).map((s) => (
              <li key={s.url} className="rounded-md border border-slate-200 p-2 text-sm">
                <a href={s.url} target="_blank" rel="noreferrer" className="font-medium text-slate-900 hover:underline">
                  {s.title ?? s.url}
                </a>
                <span className="ml-2 text-xs text-slate-500">scanned {day(s.scanned_at)}</span>
                <ul className="mt-1 list-disc pl-5 text-xs text-slate-700">
                  {s.trap_findings.map((t, i) => (
                    <li key={`t${i}`}>
                      {t.title}
                      {t.excerpt ? `: "${t.excerpt}"` : ""}
                    </li>
                  ))}
                  {s.source_entries
                    .filter((e) => e.verdict === "contradicted")
                    .map((e, i) => (
                      <li key={`s${i}`}>
                        Contradicted by the source: &quot;{e.sentence}&quot; ({e.reason})
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </DashCard>

      <DashCard>
        <h2 className="text-base font-semibold text-slate-900">Knowledge base change: affected pages</h2>
        <p className="mt-1 text-xs text-slate-500">
          When an attorney approves a knowledge base change on <Link href="/content/rules" className="text-brand hover:underline">Rules</Link>,
          every live page citing the entry gets a refresh draft, corrected by Improve to Ready. Look up an entry by its key here.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input value={kbKey} onChange={(e) => setKbKey(e.target.value)} placeholder="e.g. nj_minimum_wage" className="w-64 rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <DashButton onClick={() => void lookImpact()}>Show pages</DashButton>
          {impact && impact.length > 0 && (data.isAdmin || data.canConfirm) && (
            <DashButton onClick={() => void openRefreshes()} disabled={busy === "refresh"}>
              Open refresh drafts
            </DashButton>
          )}
        </div>
        {impact && (
          <ul className="mt-2 space-y-1 text-sm">
            {impact.length === 0 && <li className="text-slate-500">No scanned live page cites this entry.</li>}
            {impact.map((p) => (
              <li key={p.url}>
                <a href={p.url} target="_blank" rel="noreferrer" className="text-slate-900 hover:underline">
                  {p.title ?? p.url}
                </a>
                <span className="ml-2 text-xs text-slate-500">({p.via})</span>
                {p.sentences[0] && <p className="text-xs text-slate-500">&quot;{p.sentences[0]}&quot;</p>}
              </li>
            ))}
          </ul>
        )}
        {data.refresh && data.refresh.length > 0 && (
          <div className="mt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Refresh requests</div>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
              {data.refresh.slice(0, 30).map((r) => (
                <li key={`${r.kb_key}${r.url}${r.reason}`}>
                  {day(r.created_at)} · {r.kb_key} · {r.url} ·{" "}
                  {r.draft_id ? (
                    <Link href={`/content/drafts?id=${r.draft_id}`} className="text-brand hover:underline">
                      draft
                    </Link>
                  ) : r.error ? (
                    <span className="text-red-700">{r.error}</span>
                  ) : (
                    "waiting"
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </DashCard>
    </div>
  );
}
