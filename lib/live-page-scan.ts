/**
 * Published pages stay correct (Oct 20 spec, Task A15).
 *
 * 1. Every live katzmelinger.com blog and practice page is scanned once a
 *    quarter: the traps and the source check run on its text, and the
 *    knowledge base entries its claims cite are recorded (live_page_scans).
 *    A daily job scans the pages not scanned in 90 days, a batch at a time, so
 *    the whole site is covered each quarter without one long run. Claims
 *    already checked on the last scan are reused (the per-claim cache), and
 *    the model is not called while the monthly AI budget is spent.
 *
 * 2. When an attorney approves a knowledge base change, every live page that
 *    cites the entry (from the scans, and from published drafts' source
 *    checks) gets a refresh draft, made by the Redraft flow and then run
 *    through Improve to Ready, which corrects the figure against the new
 *    entry. kb_refresh_requests keeps it to one refresh per page per change.
 *
 * 3. Dated facts: an entry with a scheduled value (the January 1 minimum
 *    wage) opens refresh drafts for the pages citing it 30 days before the
 *    date, so the pages are ready when it switches.
 */
import { getSupabaseAdmin } from "./supabase-server";
import { safeFetch } from "./url-safety";
import { extractSourceClaims, matchEntry, claimHash, type SourceCheckEntry } from "./source-check";
import { checkClaims, htmlToText, loadSourceCheckInputs } from "./source-check-server";
import { runTrapCheck } from "./trap-gate";
import { overBudget } from "./ai-cost";
import { getThresholds, todayNy } from "./legal-knowledge-base";
import { liveUrl } from "./page-results";
import { readSourceCheck } from "./source-check";

const SCAN_TYPES = ["blog_post", "practice_area", "pillar", "service_page"];
const QUARTER_MS = 90 * 86_400_000;

function isMissing(message: string | undefined): boolean {
  return !!message && /live_page_scans|kb_refresh_requests|does not exist|schema cache/i.test(message);
}

/** The article part of a page: <article> or <main> when present, else the body. */
export function pageText(html: string): string {
  const pick = /<article[\s\S]*?<\/article>/i.exec(html)?.[0] ?? /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? html;
  return htmlToText(pick);
}

export type ScanResult = { url: string; claims: number; kbKeys: string[]; traps: number; problems: number; error?: string };

type StoredEntry = Pick<SourceCheckEntry, "hash" | "sentence" | "kb_key" | "verdict" | "reason" | "source_url">;

export async function scanPage(tenantId: string, url: string, title: string | null, opts: { allowModel: boolean; inputs: Awaited<ReturnType<typeof loadSourceCheckInputs>> }): Promise<ScanResult> {
  const sb = getSupabaseAdmin();
  let html = "";
  try {
    const res = await safeFetch(url, { timeoutMs: 20_000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await sb.from("live_page_scans").upsert({ tenant_id: tenantId, url, title, scanned_at: new Date().toISOString(), error }, { onConflict: "tenant_id,url" });
    return { url, claims: 0, kbKeys: [], traps: 0, problems: 0, error };
  }
  const text = pageText(html);
  const claims = extractSourceClaims(text);
  const kbKeys = [...new Set(claims.map((c) => matchEntry(c, opts.inputs.thresholds, opts.inputs.statutes)?.key).filter((k): k is string => !!k))];

  // Reuse the last scan's verdicts for unchanged claims.
  const { data: prev } = await sb.from("live_page_scans").select("source_entries").eq("tenant_id", tenantId).eq("url", url).maybeSingle();
  const cached = new Map(((prev?.source_entries as StoredEntry[] | null) ?? []).map((e) => [e.hash, e]));
  const entries: StoredEntry[] = [];
  const toCheck = [];
  for (const c of claims) {
    const m = matchEntry(c, opts.inputs.thresholds, opts.inputs.statutes);
    if (!m) continue; // no entry to check against: the drafts' source check asks an attorney; a live scan lists only checkable claims
    const hit = cached.get(claimHash(c.sentence, m));
    if (hit) entries.push(hit);
    else toCheck.push(c);
  }
  if (opts.allowModel && toCheck.length) {
    for (const e of await checkClaims(tenantId, toCheck, opts.inputs, null)) {
      entries.push({ hash: e.hash, sentence: e.sentence, kb_key: e.kb_key, verdict: e.verdict, reason: e.reason, source_url: e.source_url });
    }
  }
  const traps = await runTrapCheck(text, { tenantId });
  const trapFindings = traps.findings.map((f) => ({ title: f.title, excerpt: f.excerpt, severity: f.severity }));
  const problems = entries.filter((e) => e.verdict === "contradicted").length;
  await sb.from("live_page_scans").upsert(
    {
      tenant_id: tenantId,
      url,
      title,
      scanned_at: new Date().toISOString(),
      kb_keys: kbKeys,
      claims: claims.length,
      trap_findings: trapFindings,
      source_entries: entries,
      error: !opts.allowModel && toCheck.length ? `${toCheck.length} claims not checked: monthly AI budget reached` : null,
    },
    { onConflict: "tenant_id,url" },
  );
  return { url, claims: claims.length, kbKeys, traps: trapFindings.length, problems };
}

/** Scan the pages due (never scanned, or not in 90 days), oldest first. */
export async function scanDuePages(tenantId: string, limit = 12, nowMs = Date.now()): Promise<{ scanned: ScanResult[]; remaining: number } | { missing: true }> {
  const sb = getSupabaseAdmin();
  const { data: pages } = await sb.from("site_pages").select("url, title, page_type").eq("tenant_id", tenantId).in("page_type", SCAN_TYPES).limit(5000);
  const { data: scans, error } = await sb.from("live_page_scans").select("url, scanned_at").eq("tenant_id", tenantId).limit(5000);
  if (error && isMissing(error.message)) return { missing: true };
  const last = new Map((scans ?? []).map((s) => [s.url as string, new Date(s.scanned_at as string).getTime()]));
  const due = (pages ?? [])
    .filter((p) => !last.has(p.url as string) || nowMs - last.get(p.url as string)! > QUARTER_MS)
    .sort((a, b) => (last.get(a.url as string) ?? 0) - (last.get(b.url as string) ?? 0));
  const inputs = await loadSourceCheckInputs(tenantId);
  const allowModel = !(await overBudget(tenantId));
  const scanned: ScanResult[] = [];
  for (const p of due.slice(0, limit)) {
    scanned.push(await scanPage(tenantId, p.url as string, (p.title as string | null) ?? null, { allowModel, inputs }));
  }
  return { scanned, remaining: Math.max(0, due.length - scanned.length) };
}

export type AffectedPage = { url: string; title: string | null; via: "live scan" | "published draft"; sentences: string[] };

/** Every live page that cites a knowledge base entry. */
export async function affectedPages(tenantId: string, kbKey: string): Promise<AffectedPage[]> {
  const sb = getSupabaseAdmin();
  const out = new Map<string, AffectedPage>();
  const { data: scans } = await sb.from("live_page_scans").select("url, title, source_entries").eq("tenant_id", tenantId).contains("kb_keys", [kbKey]).limit(1000);
  for (const s of scans ?? []) {
    const sentences = ((s.source_entries as StoredEntry[] | null) ?? []).filter((e) => e.kb_key === kbKey).map((e) => e.sentence);
    out.set(s.url as string, { url: s.url as string, title: (s.title as string | null) ?? null, via: "live scan", sentences });
  }
  const { data: drafts } = await sb.from("content_drafts").select("title, metadata").eq("tenant_id", tenantId).eq("status", "published").limit(2000);
  for (const d of drafts ?? []) {
    const meta = (d.metadata as Record<string, unknown> | null) ?? {};
    const url = liveUrl(meta);
    const hits = (readSourceCheck(meta)?.entries ?? []).filter((e) => e.kb_key === kbKey);
    if (!url || !hits.length || out.has(url)) continue;
    out.set(url, { url, title: (d.title as string | null) ?? null, via: "published draft", sentences: hits.map((h) => h.sentence) });
  }
  return [...out.values()];
}

/**
 * Open one refresh draft per affected page (once per page per reason) by the
 * Redraft flow. A refresh draft takes a minute or two to write, so this only
 * queues the requests and starts the first few; /api/legal/kb-refresh works
 * through the rest every two hours.
 */
export async function openRefreshDrafts(args: { tenantId: string; kbKey: string; reason: string; origin: string; note: string }): Promise<{ queued: number; skipped: number; pages: number }> {
  const sb = getSupabaseAdmin();
  const pages = await affectedPages(args.tenantId, args.kbKey);
  let queued = 0;
  let skipped = 0;
  for (const p of pages) {
    const { error } = await sb
      .from("kb_refresh_requests")
      .insert({ tenant_id: args.tenantId, kb_key: args.kbKey, url: p.url, reason: args.reason, note: args.note, title: p.title });
    // Already requested for this change (unique), or the table is missing.
    if (error) skipped++;
    else queued++;
  }
  if (queued) await processRefreshQueue(args.tenantId, args.origin, { limit: 4, deadlineMs: Date.now() + 240_000 });
  return { queued, skipped, pages: pages.length };
}

/** Make the refresh drafts still waiting, a few at a time, within a deadline. */
export async function processRefreshQueue(tenantId: string, origin: string, opts: { limit?: number; deadlineMs?: number } = {}): Promise<{ done: number; failed: number; waiting: number }> {
  const sb = getSupabaseAdmin();
  const { data: pending, error } = await sb
    .from("kb_refresh_requests")
    .select("id, url, title, note")
    .eq("tenant_id", tenantId)
    .is("draft_id", null)
    .is("error", null)
    .order("created_at")
    .limit(200);
  if (error || !pending?.length) return { done: 0, failed: 0, waiting: 0 };
  const secret = process.env.CRON_SECRET?.trim();
  const deadline = opts.deadlineMs ?? Date.now() + 240_000;
  const batch = pending.slice(0, opts.limit ?? 4);
  let done = 0;
  let failed = 0;
  await Promise.all(
    batch.map(async (r) => {
      let draftId: string | null = null;
      let err: string | null = null;
      if (!secret) err = "CRON_SECRET is not set";
      else {
        try {
          const res = await fetch(`${origin}/api/content-production/update-draft`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
            body: JSON.stringify({ url: r.url, title: r.title ?? undefined, refreshReason: r.note ?? undefined }),
            signal: AbortSignal.timeout(Math.max(30_000, deadline - Date.now())),
          });
          const j = (await res.json().catch(() => ({}))) as { draft_id?: string; error?: string; existing?: { id?: string } };
          // 409: an open draft already targets the page, and that draft is the refresh.
          draftId = j.draft_id ?? j.existing?.id ?? null;
          if (!res.ok && res.status !== 409) err = j.error ?? `HTTP ${res.status}`;
        } catch (e) {
          err = e instanceof Error ? e.message : String(e);
        }
      }
      // Never leave a row pending forever.
      if (!err && !draftId) err = "The Redraft returned no draft.";
      if (err) failed++;
      else done++;
      await sb.from("kb_refresh_requests").update({ draft_id: draftId, error: err }).eq("tenant_id", tenantId).eq("id", r.id);
    }),
  );
  return { done, failed, waiting: pending.length - batch.length };
}

/** Entries whose scheduled value takes effect within `days` (the dated facts). */
export async function upcomingDatedFacts(tenantId: string, days = 30, today = todayNy()) {
  const limit = new Date(new Date(`${today}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
  return (await getThresholds(tenantId)).filter((t) => t.scheduledEffectiveDate && t.scheduledValue != null && t.scheduledEffectiveDate > today && t.scheduledEffectiveDate <= limit);
}

export async function refreshForDatedFacts(tenantId: string, origin: string) {
  const out = [];
  for (const t of await upcomingDatedFacts(tenantId)) {
    out.push({
      key: t.key,
      ...(await openRefreshDrafts({
        tenantId,
        kbKey: t.key,
        reason: `scheduled:${t.scheduledEffectiveDate}`,
        origin,
        note: `${t.label} changes to ${t.scheduledValue} on ${t.scheduledEffectiveDate} (Task A15). Update the figure and its effective date before then.`,
      })),
    });
  }
  return out;
}

export async function listScans(tenantId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("live_page_scans")
    .select("url, title, scanned_at, kb_keys, claims, trap_findings, source_entries, error")
    .eq("tenant_id", tenantId)
    .order("scanned_at", { ascending: false })
    .limit(1000);
  if (error) return null;
  return data ?? [];
}
