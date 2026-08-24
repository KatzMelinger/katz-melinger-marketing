/**
 * Re-score drafts whose stored analysis no longer describes them.
 *
 * Backfill for the fingerprinting change. Every analysis written before
 * `content_analyses.scored_against` existed has unknown provenance, and a
 * chunk of them were scored by the Flesch engine before the rules engine took
 * over — so their `readability_score` is a different measurement wearing the
 * same label. Those rows now read as STALE, which blocks approval, so the queue
 * needs one pass to bring it current.
 *
 * Dry-run by default. Nothing is written until you pass --apply.
 *
 *   npx jiti scripts/rescore-stale-analyses.ts              # report only
 *   npx jiti scripts/rescore-stale-analyses.ts --apply      # re-score
 *   npx jiti scripts/rescore-stale-analyses.ts --apply --limit 10
 *   npx jiti scripts/rescore-stale-analyses.ts --apply --status review
 *
 * Each re-score is a full analyzeDraft() pass — several Claude calls, ~10s and
 * real tokens per draft. Start with --limit and --status review: the drafts in
 * the approval path are the ones where a stale score actually blocks someone.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, plus the
 * ANTHROPIC_API_KEY the analyzer needs, all read from .env.local.
 */

import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { analysisStaleness, type AnalysisFingerprint } from "../lib/analysis-fingerprint";

// Load .env.local into process.env before anything reads it — the analyzer
// and the feature flags both go through process.env.
function loadEnv() {
  let raw = "";
  try {
    raw = readFileSync(".env.local", "utf8");
  } catch {
    console.error("Could not read .env.local from the current directory.");
    process.exit(1);
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

type DraftRow = {
  id: string;
  title: string | null;
  topic: string;
  body: string;
  format: string;
  template: string | null;
  practice_area: string | null;
  status: string;
  tenant_id: string | null;
  seo_brief: { targetKeywords?: string[] } | null;
};

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const limitArg = args.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;
  const statusArg = args.indexOf("--status");
  const statusFilter = statusArg >= 0 ? args[statusArg + 1] : null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  let q = sb
    .from("content_drafts")
    .select("id, title, topic, body, format, template, practice_area, status, tenant_id, seo_brief")
    .not("status", "in", "(archived)");
  if (statusFilter) q = q.eq("status", statusFilter);
  const { data: draftData, error: draftErr } = await q;
  if (draftErr) {
    console.error("Failed to read drafts:", draftErr.message);
    process.exit(1);
  }
  const drafts = (draftData ?? []) as DraftRow[];

  const { data: analysisData, error: analysisErr } = await sb
    .from("content_analyses")
    .select("draft_id, created_at, scored_against")
    .order("created_at", { ascending: false });
  if (analysisErr) {
    if (/scored_against/.test(analysisErr.message)) {
      console.error(
        "The `scored_against` column does not exist yet.\n" +
          "Run supabase/content_analyses_fingerprint.sql in the Supabase SQL editor first — " +
          "without it nothing records what an analysis measured, and staleness cannot be computed.",
      );
      process.exit(1);
    }
    console.error("Failed to read analyses:", analysisErr.message);
    process.exit(1);
  }
  // Newest analysis per draft.
  const latest = new Map<string, { scored_against?: AnalysisFingerprint | null }>();
  for (const a of (analysisData ?? []) as { draft_id: string; scored_against?: AnalysisFingerprint | null }[]) {
    if (!latest.has(a.draft_id)) latest.set(a.draft_id, a);
  }

  // Only drafts that HAVE an analysis and whose analysis is stale. A draft that
  // was never analyzed is a different problem (and stays advisory at the gate),
  // so re-scoring it here would spend tokens on work nobody asked for.
  const byReason: Record<string, number> = {};
  const stale = drafts.filter((d) => {
    const a = latest.get(d.id);
    if (!a) return false;
    const s = analysisStaleness(a.scored_against, d.body ?? "");
    if (s.stale) byReason[s.reason] = (byReason[s.reason] ?? 0) + 1;
    return s.stale;
  });

  console.log(`Drafts examined:        ${drafts.length}${statusFilter ? ` (status=${statusFilter})` : ""}`);
  console.log(`With an analysis:       ${drafts.filter((d) => latest.has(d.id)).length}`);
  console.log(`Stale, needing re-score:${String(stale.length).padStart(4)}`);
  console.log(`  by reason:`, byReason);

  const byStatus: Record<string, number> = {};
  for (const d of stale) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
  console.log(`  by status:`, byStatus);

  if (!apply) {
    console.log(`\nDry run. Re-run with --apply to re-score${
      Number.isFinite(limit) ? ` (--limit ${limit})` : ""
    }.`);
    return;
  }

  const targets = stale.slice(0, Number.isFinite(limit) ? limit : stale.length);
  console.log(`\nRe-scoring ${targets.length} draft(s). Each is a full analysis pass.\n`);

  // Imported lazily so a dry run never loads the Claude client.
  const { analyzeDraft } = await import("../lib/content-analysis");

  let ok = 0;
  let failed = 0;
  for (const [i, d] of targets.entries()) {
    const label = (d.title || d.topic || d.id).slice(0, 60);
    process.stdout.write(`  [${i + 1}/${targets.length}] ${label} … `);
    try {
      await analyzeDraft({
        draftId: d.id,
        body: d.body ?? "",
        title: d.title ?? undefined,
        topic: d.topic ?? undefined,
        format: d.format,
        template: d.template ?? undefined,
        practiceArea: d.practice_area ?? undefined,
        targetKeywords: d.seo_brief?.targetKeywords ?? [],
        // Explicit: a script has no session, and letting the analyzer fall back
        // to the default tenant would file these under the wrong firm.
        tenantId: d.tenant_id ?? undefined,
      });
      ok++;
      console.log("done");
    } catch (e) {
      failed++;
      console.log(`FAILED — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`\nRe-scored ${ok}, failed ${failed}, ${stale.length - targets.length} left.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
