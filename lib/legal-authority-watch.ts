/**
 * Automatic law-change detection.
 *
 * supabase/legal_facts_cache_schema.sql's own header comment names this gap
 * directly: "'immediate update whenever a law changes' needs something
 * watching for the change, which does not exist yet. The TTL is the honest
 * substitute until it does." freshness_class (volatile/standard/stable) is
 * reactive — a stale row only refetches the NEXT time that citation happens
 * to come up in a live legal check, which could be months after the law
 * actually changed, or never, if nobody writes about that section again.
 *
 * This module is proactive instead: on a schedule, it re-fetches every
 * cached NY-consolidated and CFR section (the only two corpora with a
 * stable, no-search fetchable address — see lib/legal-citation.ts's own
 * scope note) and diffs the fresh text against what's cached. A real
 * difference means the law changed, not just that time passed. When it has:
 *
 *   - the cache row is flagged (`confirmation_status = 'flagged'`) — readCache
 *     in lib/legal-retrieval.ts already treats a flagged row as absent, so
 *     nothing downstream can silently keep trusting text that's known wrong
 *     until a human re-confirms it;
 *   - an alert names which already-checked drafts cited that authority
 *     (content_findings.source_checked), so a reviewer knows what to look at,
 *     not just that something somewhere changed.
 *
 * Best-effort throughout: one bad fetch (a down source, a transient network
 * blip) must never stop the rest of the sweep, and a failure here must never
 * touch a cache row's trustworthiness — only a confirmed DIFFERENCE does.
 */

import { getSupabaseAdmin } from "./supabase-server";
import { retrieveAuthority } from "./legal-retrieval";
import type { ParsedCitation, CitationCorpus } from "./legal-citation";
import { writeAlert } from "./alerts-engine";

/** Only these two corpora have a stable, per-section, no-search address to
 *  re-fetch from (lib/legal-citation.ts). usc/nj_statute/njac can't be
 *  proactively re-checked this way — that's an existing, documented limit,
 *  not something this module works around. */
const WATCHABLE_CORPORA: CitationCorpus[] = ["ny_consolidated", "cfr"];

type CacheRow = {
  corpus: CitationCorpus;
  book: string;
  section: string;
  source_url: string;
  authority_text: string;
};

type ChangedCitation = { corpus: CitationCorpus; book: string; section: string; sourceUrl: string };

export type AuthorityWatchResult = {
  checked: number;
  changed: ChangedCitation[];
  errors: number;
};

/** Whitespace-normalized comparison — the same source text re-extracted by
 *  the same parser should be byte-identical, so this only exists to absorb
 *  incidental formatting noise, not to paper over a real content change. */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Re-fetches every watchable cached citation for one tenant and flags any
 * whose authority text has actually changed since it was cached.
 */
export async function runAuthorityWatch(tenantId: string): Promise<AuthorityWatchResult> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("legal_facts_cache")
    .select("corpus, book, section, source_url, authority_text")
    .eq("tenant_id", tenantId)
    .in("corpus", WATCHABLE_CORPORA);
  if (error || !data) return { checked: 0, changed: [], errors: error ? 1 : 0 };

  const rows = data as CacheRow[];
  const changed: ChangedCitation[] = [];
  let errors = 0;

  for (const row of rows) {
    try {
      const citation: ParsedCitation = {
        corpus: row.corpus,
        book: row.book,
        section: row.section,
        url: null, // rebuilt from corpus/book/section by authorityFetchUrl — not read for these two corpora
        raw: "",
      };
      const fresh = await retrieveAuthority(citation, { tenantId, skipCache: true });
      if (!fresh.ok) {
        console.warn(
          "[legal-authority-watch] refetch failed:",
          row.corpus,
          row.book,
          row.section,
          fresh.failure.reason,
        );
        errors++;
        continue;
      }
      if (normalize(fresh.value.text) === normalize(row.authority_text)) continue;

      changed.push({ corpus: row.corpus, book: row.book, section: row.section, sourceUrl: row.source_url });
      // retrieveAuthority's own cache write (skipCache still writes the fresh
      // fetch back) doesn't touch confirmation_status, so this update is what
      // actually flags the row — see readCache's "flagged is always absent".
      await sb
        .from("legal_facts_cache")
        .update({
          confirmation_status: "flagged",
          notes: `Authority text changed on ${new Date().toISOString().slice(0, 10)} — re-confirm before this citation is trusted again.`,
        })
        .eq("tenant_id", tenantId)
        .eq("corpus", row.corpus)
        .eq("book", row.book)
        .eq("section", row.section);
    } catch (e) {
      // A down source or a transient error is not a law change. Count it and
      // move on — the row keeps its last-known-good text and confirmation
      // status untouched, exactly as if this sweep hadn't run at all.
      console.warn("[legal-authority-watch] check failed:", row.corpus, row.book, row.section, e);
      errors++;
    }
  }

  if (changed.length > 0) {
    await notifyAuthorityChanges(tenantId, changed).catch((e) =>
      console.warn("[legal-authority-watch] notify failed:", e),
    );
  }

  return { checked: rows.length, changed, errors };
}

/** Names which already-checked content cited a now-changed authority, so a
 *  reviewer has something concrete to look at rather than just "something,
 *  somewhere changed". */
async function notifyAuthorityChanges(tenantId: string, changed: ChangedCitation[]): Promise<void> {
  const sb = getSupabaseAdmin();

  const draftIds = new Set<string>();
  for (const c of changed) {
    const { data } = await sb
      .from("content_findings")
      .select("draft_id")
      .eq("tenant_id", tenantId)
      .eq("source", "legal")
      .eq("source_checked", c.sourceUrl)
      .limit(50);
    for (const row of (data ?? []) as Array<{ draft_id: string }>) draftIds.add(row.draft_id);
  }

  let titles: string[] = [];
  if (draftIds.size > 0) {
    const { data } = await sb.from("content_drafts").select("title").in("id", [...draftIds]);
    titles = (data ?? []).map((d) => (d as { title: string | null }).title || "(untitled)");
  }

  const summary = changed.map((c) => `${c.book} §${c.section}`).join(", ");
  const affectedNote =
    titles.length > 0
      ? ` Previously cited by: ${[...new Set(titles)].slice(0, 5).join("; ")}.`
      : " No tracked content cited it yet, but confirm the new text before it's used in a new draft.";

  await writeAlert(
    {
      type: "authority_changed",
      severity: "high",
      source: "legal",
      title: `Authority text changed: ${summary}`,
      body: `${changed.length} cited authorit${changed.length === 1 ? "y" : "ies"} changed since last checked.${affectedNote} Confirm the new text before it's trusted again — a flagged citation can't pass a legal check until then.`,
      payload: { changed },
      dedupeKey: `authority-changed:${summary}`,
    },
    tenantId,
  );
}
