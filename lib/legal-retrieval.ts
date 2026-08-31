/**
 * Fetching what an authority actually says, and remembering it.
 *
 * The back half of Rule 3. lib/legal-citation.ts turns a citation into an
 * address; this goes and gets the text, and caches it so the same section is
 * not fetched a hundred times.
 *
 * THE CACHE IS NOT THE AUTHORITY. Diana's Q4 is explicit: retrieval against the
 * source is primary, and the knowledge base is "a cache of what those checks
 * already confirmed". So nothing is hand-authored here, and a cached row is a
 * snapshot with an expiry rather than a fact with a blessing.
 *
 * EVERY FAILURE ROUTES TO A HUMAN. A fetch that times out, 404s, gets blocked,
 * or returns something unrecognisable does NOT fall back to a guess and does
 * not return an empty string that a caller might read as "nothing objectionable
 * found". It returns an explicit failure, and the claim goes to an attorney.
 * That is the whole discipline of this feature: the system may say "verified"
 * or "I could not check this", never "probably fine".
 */

import { stripHtml } from "./document-extract";
import { getSupabaseAdmin } from "./supabase-server";
import {
  authorityFetchUrl,
  type ParsedCitation,
} from "./legal-citation";

/**
 * Identifying, but in the shape a UA filter accepts.
 *
 * nysenate.gov answers 403 to a bare product token and 200 to anything matching
 * the conventional browser format — a crude bot filter, not a policy: its
 * robots.txt does not disallow /legislation/, which is the path being read.
 * This keeps the firm's name and a contact URL in the string rather than
 * impersonating Chrome, so the site owner can see who is asking. Volume is
 * negligible because every result is cached.
 */
const USER_AGENT =
  "Mozilla/5.0 (compatible; KatzMelinger-LegalCheck/1.0; +https://katzmelinger.com)";
const FETCH_TIMEOUT_MS = 20_000;

/** How long a snapshot may be served before it must be fetched again. */
export type FreshnessClass = "volatile" | "standard" | "stable";

const FRESHNESS_DAYS: Record<FreshnessClass, number> = {
  volatile: 30,
  standard: 180,
  stable: 365,
};

export type AuthorityText = {
  citation: ParsedCitation;
  /** The authority's own words, trimmed. Never paraphrased. */
  text: string;
  /** The URL a reviewer should be shown — the readable one, not the API. */
  sourceUrl: string;
  retrievedAt: string;
  fromCache: boolean;
};

export type RetrievalFailure = {
  citation: ParsedCitation;
  /** Why this could not be settled. Shown to the attorney who picks it up. */
  reason: string;
};

export type RetrievalResult =
  | { ok: true; value: AuthorityText }
  | { ok: false; failure: RetrievalFailure };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Candidate snapshot dates, newest first.
 *
 * eCFR has no version dated today — their publication trails the calendar — so
 * asking for today's date returns 404 even though the regulation is perfectly
 * available. Stepping back finds the most recent snapshot that exists.
 */
function datesBackFrom(start: string, steps = [0, 7, 30, 90, 365]): string[] {
  const base = new Date(`${start}T00:00:00Z`).getTime();
  return steps.map((d) => new Date(base - d * 86_400_000).toISOString().slice(0, 10));
}

function isFresh(retrievedAt: string, freshness: FreshnessClass): boolean {
  const age = Date.now() - new Date(retrievedAt).getTime();
  return age < FRESHNESS_DAYS[freshness] * 24 * 60 * 60 * 1000;
}

/**
 * Pull the readable text out of an eCFR versioner XML response.
 *
 * The API returns the requested section wrapped in CFR markup. Tags are
 * stripped rather than parsed: the goal is the words a person would read, and
 * an XML tree buys nothing when the next step is handing the passage to a
 * reviewer or a model.
 */
function extractCfrText(xml: string): string {
  return xml
    .replace(/<\?xml[^>]*\?>/g, " ")
    .replace(/<\/(?:P|HEAD|SECTION|DIV\d*)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/**
 * A response can be 200 and still not be the law — a bot wall, a cookie
 * interstitial, a "not initialized" portal. Those must not be cached as though
 * they were the authority's text, because a cached block page would then
 * "verify" claims forever.
 */
/**
 * Pull the section text out of an OpenLegislation response.
 *
 * The API wraps the law in { success, result: { text, title, ... } }. Read
 * defensively: an envelope shape change should degrade to "could not read this"
 * — which routes to an attorney — rather than to a confident empty string that
 * would read as "nothing wrong here".
 */
function extractOpenLegislationText(body: string): string {
  try {
    const json = JSON.parse(body) as {
      success?: boolean;
      result?: { text?: string; title?: string; documents?: { text?: string } };
    };
    if (json.success === false) return "";
    const r = json.result;
    // OpenLegislation embeds literal backslash-n sequences in the statute text
    // rather than real line breaks. Left alone they are two ordinary characters,
    // so whitespace normalisation cannot touch them — which broke quote
    // verification: the model quotes the passage as a person reads it, and the
    // stored copy has "\n" wedged mid-sentence. It also made the text
    // unpleasant for a reviewer. Convert to real whitespace at the source.
    // OpenLegislation embeds LITERAL backslash-n sequences in the statute text
    // rather than real line breaks, so they are two ordinary characters that no
    // whitespace normalisation can touch. Left in, they wedge themselves
    // mid-word ("any other\npenalty") and quote verification against the
    // authority fails even when the model has quoted the passage correctly.
    const unescape = (t: string) =>
      t
        .split("\\r\\n").join(" ")
        .split("\\n").join(" ")
        .split("\\r").join(" ")
        .split("\\t").join(" ")
        .replace(/[ ]+/g, " ")
        .trim();
    const text = unescape(r?.text ?? r?.documents?.text ?? "");
    const title = r?.title ? unescape(r.title) + " " : "";
    return `${title}${text}`.trim();
  } catch {
    return "";
  }
}

function looksLikeAuthorityText(text: string, citation: ParsedCitation): boolean {
  if (text.trim().length < 200) return false;
  const lower = text.toLowerCase();
  const blocked = [
    "not initialized",
    "enable javascript",
    "access denied",
    "unusual traffic",
    "are you a robot",
    "captcha",
  ];
  if (blocked.some((b) => lower.includes(b))) return false;
  // The section number should appear somewhere in its own text.
  return lower.includes(citation.section.toLowerCase());
}

async function fetchText(url: string): Promise<{ ok: true; body: string } | { ok: false; reason: string }> {
  try {
    const res = await fetch(url, {
      // JSON must be listed: OpenLegislation serves application/json and
      // answers 406 Not Acceptable to an Accept header that omits it. curl
      // sends */* and so never hit this, which is why the key tested fine
      // by hand and failed through the client.
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json,application/xml,text/html,text/plain,*/*",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, reason: `authority returned ${res.status} ${res.statusText}` };
    // A redirect to another host is how eCFR serves its bot wall. Treat any
    // off-host landing as a failure rather than parsing whatever came back.
    const finalHost = new URL(res.url).host;
    const wantedHost = new URL(url).host;
    if (finalHost !== wantedHost) {
      return { ok: false, reason: `redirected off-host to ${finalHost} (likely a bot check)` };
    }
    return { ok: true, body: await res.text() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `fetch failed: ${msg}` };
  }
}

/** Read a cached snapshot, if there is a fresh and usable one. */
async function readCache(
  citation: ParsedCitation,
  tenantId: string,
): Promise<AuthorityText | null> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("legal_facts_cache")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("corpus", citation.corpus)
      .eq("book", citation.book)
      .eq("section", citation.section.toLowerCase())
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    // A flagged row means a previous fetch was inconclusive. It must never
    // satisfy a check — serving it would launder an unresolved lookup.
    if (row.confirmation_status === "flagged") return null;
    if (!isFresh(String(row.retrieved_at), row.freshness_class as FreshnessClass)) return null;
    return {
      citation,
      text: String(row.authority_text),
      sourceUrl: String(row.source_url),
      retrievedAt: String(row.retrieved_at),
      fromCache: true,
    };
  } catch {
    return null;
  }
}

async function writeCache(
  value: AuthorityText,
  tenantId: string,
  freshness: FreshnessClass,
): Promise<void> {
  try {
    const sb = getSupabaseAdmin();
    await sb.from("legal_facts_cache").upsert(
      {
        tenant_id: tenantId,
        corpus: value.citation.corpus,
        book: value.citation.book,
        // Stored lowercase so the unique index can be a plain column index,
        // which ON CONFLICT requires — see the migration for why.
        section: value.citation.section.toLowerCase(),
        source_url: value.sourceUrl,
        authority_text: value.text,
        retrieved_at: value.retrievedAt,
        freshness_class: freshness,
        confirmation_status: "auto",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,corpus,book,section" },
    );
  } catch (e) {
    // A cache write failing costs a refetch, nothing more. Never let it break
    // the check that succeeded.
    console.warn("[legal-retrieval] cache write failed:", e);
  }
}

/** How long this corpus's text should be trusted between fetches. */
function freshnessFor(citation: ParsedCitation): FreshnessClass {
  // Regulations are revised more often than consolidated statutes.
  return citation.corpus === "cfr" ? "volatile" : "standard";
}

/**
 * Get what the authority says for this citation.
 *
 * Cache first, then a live fetch. Anything that cannot be settled comes back as
 * an explicit failure carrying the reason, which the caller routes to a human.
 */
export async function retrieveAuthority(
  citation: ParsedCitation,
  opts: { tenantId: string; asOf?: string; skipCache?: boolean } = { tenantId: "" },
): Promise<RetrievalResult> {
  const tenantId = opts.tenantId || "00000000-0000-0000-0000-000000000001";

  if (!opts.skipCache) {
    const cached = await readCache(citation, tenantId);
    if (cached) return { ok: true, value: cached };
  }

  const url = authorityFetchUrl(citation, opts.asOf ?? today());
  if (!url) {
    return {
      ok: false,
      failure: {
        citation,
        reason: `no approved machine-readable source for ${citation.corpus.toUpperCase()} citations — an attorney must check this`,
      },
    };
  }

  // eCFR's versioner is addressed BY DATE, and it 404s for a date it has no
  // snapshot for — including today, because their data trails the calendar.
  // Walk back until a version answers rather than reporting "the authority is
  // unreachable" when it is merely not dated today. The date that worked is
  // what the snapshot represents, which is why it is recorded on the result.
  const candidates =
    citation.corpus === "cfr"
      ? datesBackFrom(opts.asOf ?? today())
          .map((d) => authorityFetchUrl(citation, d))
          .filter((u): u is string => u !== null)
      : [url];

  let res: Awaited<ReturnType<typeof fetchText>> = {
    ok: false,
    reason: "no candidate URL",
  };
  for (const candidate of candidates) {
    res = await fetchText(candidate);
    if (res.ok) break;
  }
  if (!res.ok) return { ok: false, failure: { citation, reason: res.reason } };

  const raw =
    citation.corpus === "cfr"
      ? extractCfrText(res.body)
      : citation.corpus === "ny_consolidated"
        ? extractOpenLegislationText(res.body)
        : stripHtml(res.body);
  if (!looksLikeAuthorityText(raw, citation)) {
    return {
      ok: false,
      failure: {
        citation,
        reason:
          "the response did not look like the authority's text (too short, a block page, or the section number was absent)",
      },
    };
  }

  // Cap what is stored. A whole CFR part can be enormous, and the passage that
  // settles a claim is near the section itself.
  const text = raw.slice(0, 20_000);
  const value: AuthorityText = {
    citation,
    text,
    // Show the reviewer the readable page, not the API endpoint.
    sourceUrl: citation.url ?? url,
    retrievedAt: new Date().toISOString(),
    fromCache: false,
  };
  await writeCache(value, tenantId, freshnessFor(citation));
  return { ok: true, value };
}
