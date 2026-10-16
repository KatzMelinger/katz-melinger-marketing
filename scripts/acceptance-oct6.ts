/**
 * Acceptance run: Diana's Oct 6 spec, Task 14, and the Sept 28 acceptance test
 * from step 2. Read-only against the live database, using the app's own check
 * code, so it checks what the app would show.
 *
 *   node scripts/run.mjs scripts/acceptance-oct6.ts              report
 *   node scripts/run.mjs scripts/acceptance-oct6.ts --analyze    re-run analysis on 43fb024e first
 *
 * Each line is PASS, FAIL or CHECK (needs a person in the app). Writes the
 * report to scripts/out/acceptance-oct6.md as well.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

import { getSupabaseAdmin } from "../lib/supabase-server";
import { loadEnabledTraps } from "../lib/trap-gate";
import { matchTrap } from "../lib/known-traps";
import { hasWebPage } from "../lib/draft-metadata";
import { countClosingCtas, countDisclaimers } from "../lib/legal-disclaimers";
import { checkRequiredElements } from "../lib/required-elements";
import { getOperatingBrief } from "../lib/social-operating-brief";
import { blockingFeeHits, findFeeLanguage } from "../lib/fee-language";
import { firmFactFindings } from "../lib/firm-fact-findings";
import { checkValuesAgainst } from "../lib/legal-value-check";
import { getThresholds } from "../lib/legal-knowledge-base";
import { statuteFindings, loadStatuteTable } from "../lib/legal-statute-check";
import { autoRewrite } from "../lib/auto-rewrite";
import { closingCtaFor } from "../lib/closing-cta";
import { quoteStillPresent } from "../lib/finding-currency";
import { isDecision } from "../lib/finding-severity";
import { isStyleFinding } from "../lib/finding-merge";
import { quoteText } from "../lib/finding-currency";
import { bySource, needsCallback, type CallStatsRow } from "../lib/calls-stats";
import { contentGap, type GapView } from "../lib/content-gaps";
import { readFixLog } from "../lib/legal-fix-log";
import { listFindings } from "../lib/content-findings-store";
import { keywordProblem } from "../lib/keyword-guard";
import { primaryKeyword } from "../lib/draft-metadata";

const T = "00000000-0000-0000-0000-000000000001";
const GENDER = "43fb024e-2cf3-4e9d-a4b0-aaae28a9d2fe";
const lines: string[] = [];
const tally = { PASS: 0, FAIL: 0, CHECK: 0 };
const out = (s: string) => {
  lines.push(s);
  console.log(s);
};
const res = (ok: boolean | null, label: string, detail = "") => {
  const tag = ok === null ? "CHECK" : ok ? "PASS" : "FAIL";
  tally[tag]++;
  out(`- **${tag}** ${label}${detail ? `: ${detail}` : ""}`);
};

type Draft = { id: string; title: string | null; topic: string | null; status: string; format: string | null; body: string | null; metadata: Record<string, unknown> | null; seo_brief: Record<string, unknown> | null; practice_area: string | null };

async function main() {
  const sb = getSupabaseAdmin();
  const { data: draftsRaw } = await sb
    .from("content_drafts")
    .select("id, title, topic, status, format, body, metadata, seo_brief, practice_area")
    .eq("tenant_id", T)
    .limit(3000);
  const drafts = (draftsRaw ?? []) as Draft[];
  const open = drafts.filter((d) => !["archived", "published"].includes(d.status));
  const openWeb = open.filter((d) => hasWebPage((d.format ?? "").trim()) && (d.body ?? "").trim());
  const byPrefix = (p: string) => drafts.find((d) => d.id.startsWith(p));

  if (process.argv.includes("--analyze")) {
    const g = byPrefix("43fb024e")!;
    const { analyzeDraft } = await import("../lib/content-analysis");
    out(`Re-running analysis on 43fb024e…`);
    await analyzeDraft({
      draftId: g.id,
      body: g.body ?? "",
      title: g.title,
      topic: g.topic,
      format: g.format,
      practiceArea: g.practice_area,
      targetKeywords: [primaryKeyword(g)].filter(Boolean),
      tenantId: T,
      notify: false,
    });
  }

  out(`# Acceptance run, Oct 6 spec Task 14 and Sept 28 test`);
  out(`Run ${new Date().toISOString()} against the live database. ${openWeb.length} open website drafts.`);

  // ---------------------------------------------------------------- Oct 6 Task 14
  out(`\n## Oct 6 spec, Task 14`);
  const traps = (await loadEnabledTraps(T)).traps;
  const criticalHits: string[] = [];
  for (const d of openWeb) {
    for (const t of traps.filter((x) => x.severity === "critical")) {
      if (matchTrap(t, d.body ?? "", { title: d.title, topic: d.topic, isWebPage: true }).length) criticalHits.push(`${d.id.slice(0, 8)} "${t.label}"`);
    }
  }
  res(criticalHits.length === 0, "No critical trap fires on any open website draft", criticalHits.length ? `${criticalHits.length}: ${criticalHits.slice(0, 12).join("; ")}` : `${traps.length} traps run`);

  const ctaBad = openWeb.filter((d) => countClosingCtas(d.body ?? "") !== 1).map((d) => `${d.id.slice(0, 8)} (${countClosingCtas(d.body ?? "")})`);
  res(ctaBad.length === 0, `Every open website draft has "Call today at" exactly once`, ctaBad.join(", "));
  const discBad = openWeb.filter((d) => countDisclaimers(d.body ?? "") !== 1).map((d) => `${d.id.slice(0, 8)} (${countDisclaimers(d.body ?? "")})`);
  res(discBad.length === 0, `Every open website draft has the disclaimer exactly once`, discBad.join(", "));

  // 43fb024e
  const g = byPrefix("43fb024e")!;
  const brief = await getOperatingBrief(T);
  const cta = await closingCtaFor(T);
  const thresholds = await getThresholds(T);
  const gb = g.body ?? "";
  out(`\n### 43fb024e "${g.title}" (status ${g.status})`);
  res(!checkValuesAgainst(gb, thresholds).some((f) => f.severity === "critical"), "No knowledge base error (NYCHRL four or more, NYSHRL deadline)");
  const missing = checkRequiredElements({ body: gb, title: g.title, cta, neverInContentPhones: brief.neverInContentPhones });
  res(missing.length === 0, "Attorney Advertising first, locked CTA and disclaimer at the end, all required elements", missing.map((m) => m.code).join(", "));
  res(!/<script/i.test(gb), "No <script> in the body");
  res(blockingFeeHits(findFeeLanguage(gb)).length === 0, "No fee sentence");
  const gFindings = await listFindings(g.id);
  const gOpen = gFindings.filter((f) => f.status === "open" || f.status === "in_progress");
  res(!gFindings.some((f) => f.ruleId === "unclassified"), "Zero unclassified findings");
  const log = readFixLog(g.metadata ?? {});
  const live = log.changes.filter((c) => !c.undone_at);
  res(live.length > 0, "Changes made lists the corrections", `${live.length} live changes, ${log.reviewed_at ? `reviewed ${log.reviewed_at.slice(0, 10)}` : "NOT yet marked Reviewed (Ready to approve stays off until it is)"}`);
  const decisions = gOpen.filter(isDecision);
  res(decisions.length <= 5, "Needs a decision has five items or fewer", `${decisions.length}: ${decisions.map((f) => f.title).slice(0, 5).join(" | ")}`);
  const keys = gOpen.filter((f) => f.excerpt).map((f) => quoteText(f.excerpt!));
  res(new Set(keys).size === keys.length, "No two open findings quote the same sentence");
  res(!gOpen.some(isStyleFinding), "Zero open style findings (brand voice, readability, structure)");
  res(!gOpen.some((f) => quoteStillPresent(f, gb) === false), "No open finding quotes text missing from the body");
  res(
    gOpen.filter((f) => f.ruleId === "no_rule" || f.ruleId === "no_rule_confirm").every((f) => !!f.excerpt),
    "Attorney items are legal claims with no rule covering them",
    `${gOpen.filter((f) => f.ruleId === "no_rule").length} no-rule, ${gOpen.filter((f) => f.ruleId === "no_rule_confirm").length} please-confirm`,
  );
  const { data: an } = await sb
    .from("content_analyses")
    .select("compliance_summary, compliance_violations, compliance_required_disclaimers, created_at")
    .eq("draft_id", g.id)
    .order("created_at", { ascending: false })
    .limit(1);
  const comp = JSON.stringify(an?.[0] ?? {});
  res(!/646\D{0,3}849\D{0,3}3352/.test(comp), "Compliance panel never shows 646 849 3352", `analysis of ${an?.[0]?.created_at?.slice(0, 10) ?? "none"}`);
  const twice = await autoRewrite({ body: gb, title: g.title, practiceArea: g.practice_area, cta, noModel: true });
  const thrice = await autoRewrite({ body: twice.body, title: twice.title, practiceArea: g.practice_area, cta, noModel: true });
  res(thrice.changes.length === 0, "Apply all fixes twice: the second run changes nothing", `first ${twice.changes.length}, second ${thrice.changes.length}`);

  // 35acc071: Trap 27es holds it.
  const es = byPrefix("35acc071");
  const t27es = traps.find((t) => t.label === "Fee discussion in Spanish");
  if (es && t27es) {
    const hits = matchTrap(t27es, es.body ?? "", { isWebPage: true });
    res(hits.length === 0 || es.status === "needs_legal" || es.status !== "approved", "35acc071: Trap 27es holds the draft until the sentence is removed", hits.length ? `fires (${hits.length}), status ${es.status}` : `sentence already removed, status ${es.status}`);
  } else res(null, "35acc071 Trap 27es", "draft or trap not found");

  // Calls, September.
  const calls: CallStatsRow[] = [];
  for (let lo = 0; ; lo += 1000) {
    const { data } = await sb
      .from("calls")
      .select("id, customer_name, customer_phone_number, source_name, answered, voicemail, duration, direction, start_time, first_call, marketing_source:raw->>source, call_type:raw->>call_type")
      .eq("tenant_id", T)
      .gte("start_time", "2026-09-01T04:00:00Z")
      .lt("start_time", "2026-10-01T04:00:00Z")
      .range(lo, lo + 999);
    calls.push(...((data ?? []) as unknown as CallStatsRow[]));
    if (!data || data.length < 1000) break;
  }
  const now = Date.now();
  const src = bySource(calls, now).map((r) => r.source);
  res(new Set(src).size === src.length, "Calls, Sept 1-30: each marketing source appears once", src.join(", "));
  const cb = needsCallback(calls, new Map(), now);
  res(null, "Calls, Sept 1-30: Needs callback matches Call Desk", `${cb.length} callers (before lead-response statuses): ${cb.slice(0, 12).map((c) => c.name).join(", ")}`);

  // Local SEO.
  res(brief.webPhone.replace(/\D/g, "") === "2124600047", "GBP phone check expects 212 460 0047 (Brand settings web number), no \"retired\" message");

  // Tasks 15-19.
  out(`\n### Tasks 15 to 19`);
  const kp = drafts.filter((d) => !["archived"].includes(d.status) && primaryKeyword(d) && keywordProblem(primaryKeyword(d)));
  res(null, "Task 15: a new draft from the \"What to Do After Being Fired\" task picks a real keyword and offers the 2023 blog update", `needs the app (DataForSEO). ${kp.length} existing drafts carry a keyword that fails the guard and show "Keyword needs selection": ${kp.slice(0, 6).map((d) => d.id.slice(0, 8)).join(", ")}`);
  const { data: opps } = await sb.from("seo_opportunities").select("last_synced_at, metrics").eq("tenant_id", T).limit(5000);
  const lastSync = (opps ?? []).map((o) => o.last_synced_at as string).filter(Boolean).sort().at(-1) ?? null;
  res(!!lastSync && now - Date.parse(lastSync) < 7 * 864e5, "Task 16: Radar synced within 7 days", lastSync ?? "never");
  const trend = (opps ?? []).filter((o) => (o.metrics as { trend3m?: unknown } | null)?.trend3m != null).length;
  const rising = (opps ?? []).filter((o) => (o.metrics as { rising?: boolean } | null)?.rising).length;
  res(trend > 0 && rising > 0, "Task 16: Trend column filled, at least one Rising", `${trend} rows with trend, ${rising} rising (discovery fills these)`);
  const { count: emerging } = await sb.from("seo_keywords").select("id", { count: "exact", head: true }).eq("tenant_id", T).eq("status", "emerging");
  res((emerging ?? 0) > 0, "Task 16: new terms in the Keyword Tracker as Emerging", `${emerging ?? 0}`);
  for (const v of ["striking", "missing", "clusters", "states", "language", "questions"] as GapView[]) {
    const r = await contentGap(v, T).catch((e) => ({ items: [], error: String(e) }) as { items: unknown[]; error?: string });
    const withAction = (r.items as { action: unknown }[]).filter((i) => i.action).length;
    const note = (r as { summary?: string[] }).summary?.join(" ") ?? "";
    // Questions needs DataForSEO for siblings, unreachable from this machine.
    const offline = v === "questions" && r.items.length === 0 && /[1-9]\d* question queries/.test(note);
    res(offline ? null : r.items.length > 0 && !r.error, `Task 18: "${v}" tab lists items with source and action`, r.error ? r.error : `${r.items.length} items, ${withAction} with an action${note ? `. ${note}` : ""}${offline ? " (siblings come from DataForSEO: check in the app)" : ""}`);
  }
  const { data: prompts } = await sb.from("aeo_prompts").select("category, language, enabled").eq("tenant_id", T);
  const en = (prompts ?? []).filter((p) => p.enabled !== false);
  res(
    en.length >= 40 && en.some((p) => /collection|judgment/.test(String(p.category))) && en.filter((p) => p.language === "es").length >= 8,
    "Task 19: 40+ prompts including collections and 8 in Spanish",
    `${en.length} prompts, ${en.filter((p) => p.language === "es").length} Spanish`,
  );
  res(null, "Task 19: Answer readiness in Run analysis; Sources tab shows firm present/absent", "open a website draft's analysis, and AEO tracker > Sources > Check cited sources");

  // Tasks 21-25.
  out(`\n### Tasks 21 to 25`);
  let staleOpen = 0;
  for (const d of openWeb) {
    const fs = await listFindings(d.id);
    staleOpen += fs.filter((f) => (f.status === "open" || f.status === "in_progress") && quoteStillPresent(f, d.body ?? "") === false).length;
  }
  res(staleOpen === 0, "Task 21: no open finding quotes text missing from its draft", `${staleOpen}`);
  const { count: hist } = await sb.from("rule_changes").select("id", { count: "exact", head: true }).eq("tenant_id", T).eq("rule_kind", "kb");
  res((hist ?? 0) > 0, "Task 24: knowledge base changes appear in Rules history with Restore", `${hist ?? 0} knowledge base changes recorded`);

  // ---------------------------------------------------------------- Sept 28
  out(`\n## Sept 28 acceptance test, from step 2`);
  const statutes = await loadStatuteTable(T);
  const mustPass = [
    "New Jersey employees may file with the New Jersey Division on Civil Rights within 180 days or file directly in court within two years.",
    "The New Jersey Law Against Discrimination (NJLAD) applies to employers with one or more employees.",
    "The NYCHRL applies to employers with four or more employees.",
    "Gender is a protected class under federal, New York state, and New York City law.",
    "The ADEA applies to employers with 20 or more employees.",
  ];
  for (const s of mustPass) {
    const f = [
      ...checkValuesAgainst(s, thresholds),
      ...statuteFindings(s, statutes.ok ? statutes.rows : []),
      // Sentence-level traps only: a document trap (Missing byline) always
      // fires on a lone sentence.
      ...traps
        .filter((t) => t.matchType !== "document" && t.matchType !== "document_missing")
        .flatMap((t) => matchTrap(t, s, { isWebPage: true }).map(() => ({ title: t.label }))),
    ];
    res(f.length === 0, `Step 2, must not be flagged: "${s.slice(0, 70)}…"`, f.map((x) => x.title).join("; "));
  }
  const feeIds = ["1a7264df", "90e667a2", "eb5d488b", "48d5e3f7", "7be02d57", "9b01853e"];
  for (const p of feeIds) {
    const d = byPrefix(p);
    if (!d) {
      res(null, `Step 3, fee draft ${p}`, "not found");
      continue;
    }
    const fees = blockingFeeHits(findFeeLanguage(d.body ?? ""));
    res(fees.length === 0 || ["needs_legal", "archived"].includes(d.status), `Step 3, fee draft ${p} is clean or held`, fees.length ? `${fees.length} fee hits, status ${d.status}` : `no fee language left (corrected), status ${d.status}`);
  }
  for (const p of ["12000a02", "bd131d46", "c33886d8"]) {
    const d = byPrefix(p);
    if (!d) {
      res(null, `Step 3, debtor-side draft ${p}`, "not found");
      continue;
    }
    const off = firmFactFindings(d.body ?? "", { title: d.title, topic: d.topic, practiceArea: d.practice_area }).filter((f) => f.ruleId === "firm_off_practice");
    res(off.length > 0 || ["archived", "needs_legal"].includes(d.status), `Step 3, debtor-side draft ${p} is held`, `${off.length ? "off-practice finding" : "no off-practice finding"}, status ${d.status}`);
  }
  res(traps.length >= 80, "Step 5: Known Traps lists all traps", `${traps.length} enabled`);
  const fb = byPrefix("fbff0b0e");
  res(!!fb && (fb.metadata as { wp_publish?: { queued?: boolean } } | null)?.wp_publish?.queued !== true, "Step 7: fbff0b0e is out of the WordPress queue");
  res(null, "Step 9: generate one new blog with the NYSHRL deadline and coverage; it passes on first analysis", "needs the app (brief wizard)");
  res(null, "Step 10: one controlled WordPress test publish", "only after Diana approves the step 9 blog");

  out(`\n**${tally.PASS} pass, ${tally.FAIL} fail, ${tally.CHECK} to check in the app.**`);
  mkdirSync("scripts/out", { recursive: true });
  writeFileSync("scripts/out/acceptance-oct6.md", lines.join("\n") + "\n");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
