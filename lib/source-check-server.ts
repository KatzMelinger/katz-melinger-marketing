/**
 * Runs the source check on one draft (Oct 20 spec, Task A7) and stores the
 * result as metadata.source_check. Only claims with no stored result for
 * this exact version are checked; each source page is fetched once per run.
 */
import { getSupabaseAdmin } from "./supabase-server";
import { getThresholds, type KbThresholdEntry } from "./legal-knowledge-base";
import { loadStatuteTable } from "./legal-statute-check";
import { approvedKeys, loadLearned, sentenceKey } from "./legal-learned";
import { getAnthropic, KEYWORD_RESEARCH_MODEL } from "./anthropic";
import { verifyClaimAgainst } from "./legal-verify";
import { safeFetch } from "./url-safety";
import { readContent } from "./draft-frame";
import { recordAiCost } from "./ai-cost";
import { retrieveAuthority } from "./legal-retrieval";
import type { ParsedCitation } from "./legal-citation";
import type { StatuteRow } from "./legal-statute-table";
import {
  claimHash,
  judgeClaim,
  matchEntry,
  readSourceCheck,
  sourceStanding,
  sourceStatus,
  type SourceCheckEntry,
  type SourceCheckRecord,
  type SourceClaim,
} from "./source-check";

const CONCURRENCY = 3;

/** HTML to readable text: scripts, styles and tags out, entities decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&sect;/g, "§")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * nysenate.gov law pages answer a plain fetch with 403 (bot wall); eCFR pages
 * likewise prefer the API. Both are read through the existing authority
 * retrieval (Open Legislation API, eCFR API), which caches the text in
 * legal_facts_cache.
 */
function urlCitation(url: string): ParsedCitation | null {
  const ny = url.match(/nysenate\.gov\/legislation\/laws\/([A-Z]{3})\/([\w-]+)/i);
  if (ny) return { corpus: "ny_consolidated", book: ny[1].toUpperCase(), section: ny[2].toLowerCase(), url: null, raw: url };
  const cfr = url.match(/ecfr\.gov\/.*title-(\d+).*section-([\d]+\.[\d]+[a-z]?)/i);
  if (cfr) return { corpus: "cfr", book: cfr[1], section: cfr[2], url: null, raw: url };
  return null;
}

async function fetchSource(url: string, tenantId: string): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const citation = urlCitation(url);
  if (citation) {
    const r = await retrieveAuthority(citation, { tenantId }).catch((e) => ({ ok: false as const, failure: { citation, reason: String(e) } }));
    if (r.ok) return { ok: true, text: r.value.text };
    // Fall through to the page itself.
  }
  try {
    const res = await safeFetch(url, {
      timeoutMs: 20_000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HuraqanSourceCheck/1.0)", Accept: "text/html,application/xhtml+xml,text/plain,*/*" },
    });
    if (!res.ok) return { ok: false, reason: `the source returned ${res.status}` };
    const type = res.headers.get("content-type") ?? "";
    if (/pdf/i.test(type)) return { ok: false, reason: "the source is a PDF, which the check cannot read yet" };
    const body = await res.text();
    const text = /html/i.test(type) || /<html|<body/i.test(body) ? htmlToText(body) : body;
    if (text.length < 200) return { ok: false, reason: "the source page had almost no readable text (likely a bot check)" };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, reason: `the source could not be read: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The model call, with its cost written to the ledger against the draft (Task A17). */
function makeAsk(tenantId: string, draftId: string | null) {
  return async (system: string, user: string): Promise<string> => {
    const res = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 700,
      system,
      messages: [{ role: "user", content: user }],
    });
    void recordAiCost({ tenantId, draftId, endpoint: "source-check", model: KEYWORD_RESEARCH_MODEL, usage: res.usage });
    return res.content[0]?.type === "text" ? res.content[0].text : "";
  };
}

async function confirmContradiction(sentence: string, text: string): Promise<boolean> {
  try {
    return (await verifyClaimAgainst(sentence, text)).verdict === "contradicted";
  } catch {
    return false;
  }
}

export type SourceCheckInputs = {
  thresholds: KbThresholdEntry[];
  statutes: StatuteRow[];
  approved: Set<string>;
};

export async function loadSourceCheckInputs(tenantId: string): Promise<SourceCheckInputs> {
  const [thresholds, statutes, learned] = await Promise.all([
    getThresholds(tenantId).catch(() => [] as KbThresholdEntry[]),
    loadStatuteTable(tenantId),
    loadLearned(tenantId),
  ]);
  return { thresholds, statutes: statutes.ok ? statutes.rows : [], approved: approvedKeys(learned) };
}

async function checkOne(
  tenantId: string,
  claim: SourceClaim,
  inputs: SourceCheckInputs,
  pages: Map<string, Promise<Awaited<ReturnType<typeof fetchSource>>>>,
  draftId: string | null = null,
): Promise<SourceCheckEntry> {
  const match = matchEntry(claim, inputs.thresholds, inputs.statutes);
  const base = {
    hash: claimHash(claim.sentence, match),
    sentence: claim.sentence,
    type: claim.type,
    kb_key: match?.key ?? null,
    kb_label: match?.label ?? null,
    source_url: match?.sourceUrl ?? null,
    checked_at: new Date().toISOString(),
  };
  if (!match) {
    return { ...base, quote: null, verdict: "no_entry", reason: "No knowledge base entry or statute row covers this claim." };
  }
  const standing = sourceStanding(match.sourceUrl);
  if (standing === "not_allowed" || !match.sourceUrl) {
    return { ...base, quote: null, verdict: "not_found", reason: "The entry's source is not a primary source, so it cannot verify the claim." };
  }
  if (!pages.has(match.sourceUrl)) pages.set(match.sourceUrl, fetchSource(match.sourceUrl, tenantId));
  const page = await pages.get(match.sourceUrl)!;
  if (!page.ok) {
    return { ...base, reproduction: standing === "reproduction", quote: null, verdict: "not_found", reason: `Not checked: ${page.reason}.` };
  }
  const j = await judgeClaim(claim.sentence, page.text, makeAsk(tenantId, draftId), confirmContradiction);
  return { ...base, reproduction: standing === "reproduction", quote: j.quote, verdict: j.verdict, reason: j.reason, closest: j.closest };
}

/** Check a list of claims (no storage): used by runSourceCheck and by Improve to Ready's guard. */
export async function checkClaims(tenantId: string, claims: SourceClaim[], inputs: SourceCheckInputs, draftId: string | null = null): Promise<SourceCheckEntry[]> {
  const pages = new Map<string, Promise<Awaited<ReturnType<typeof fetchSource>>>>();
  const out: SourceCheckEntry[] = [];
  const queue = [...claims];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) out.push(await checkOne(tenantId, c, inputs, pages, draftId));
    }),
  );
  return out;
}

export type SourceCheckRun = {
  record: SourceCheckRecord;
  checked: number;
  reused: number;
  claims: number;
  /** Claims this run turned into attorney questions (Task A14 emails them). */
  newQuestionHashes: string[];
};

/** Check the draft's unchecked claims and save metadata.source_check. */
export async function runSourceCheck(tenantId: string, draftId: string, opts: { inputs?: SourceCheckInputs } = {}): Promise<SourceCheckRun> {
  const sb = getSupabaseAdmin();
  const { data: d, error } = await sb
    .from("content_drafts")
    .select("id, metadata")
    .eq("tenant_id", tenantId)
    .eq("id", draftId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!d) throw new Error("Draft not found");
  const meta = (d.metadata as Record<string, unknown> | null) ?? {};
  const content = readContent(meta);
  if (!content) throw new Error("This draft is not in the October 20 frame yet. Press Rescan first.");
  const inputs = opts.inputs ?? (await loadSourceCheckInputs(tenantId));
  const stored = readSourceCheck(meta);
  const status = sourceStatus(content, stored, inputs.thresholds, inputs.statutes, inputs.approved, sentenceKey);

  const pages = new Map<string, Promise<Awaited<ReturnType<typeof fetchSource>>>>();
  const fresh: SourceCheckEntry[] = [];
  const queue = [...status.unchecked];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) fresh.push(await checkOne(tenantId, c, inputs, pages, draftId));
    }),
  );

  // Keep the stored results for claims still in the article (by hash), add the new ones.
  const keep = new Set([...status.current.map((e) => e.hash), ...fresh.map((e) => e.hash)]);
  const entries = [...(stored?.entries ?? []).filter((e) => keep.has(e.hash)), ...fresh];
  const record: SourceCheckRecord = { version: 1, checked_at: new Date().toISOString(), entries };

  // Re-read before writing so a concurrent edit is not overwritten.
  const { data: now } = await sb.from("content_drafts").select("metadata").eq("tenant_id", tenantId).eq("id", draftId).maybeSingle();
  const latest = ((now?.metadata as Record<string, unknown> | null) ?? meta) as Record<string, unknown>;
  const { error: upd } = await sb
    .from("content_drafts")
    .update({ metadata: { ...latest, source_check: record } })
    .eq("tenant_id", tenantId)
    .eq("id", draftId);
  if (upd) throw new Error(upd.message);
  return {
    record,
    checked: fresh.length,
    reused: status.current.length,
    claims: status.claims,
    newQuestionHashes: fresh.filter((e) => e.verdict === "not_found" || e.verdict === "no_entry" || e.verdict === "contradicted").map((e) => e.hash),
  };
}
