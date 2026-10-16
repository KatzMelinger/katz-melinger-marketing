/**
 * Keyword selection before writing (Oct 6 spec, Task 15).
 *
 * Runs before any text is generated for a draft created from a task, an
 * Opportunity, a Recommendation or "New brief from scratch":
 *   seed      the title with task and format words removed (lib/keyword-guard)
 *   candidates DataForSEO related keywords and suggestions for the seed, with
 *             real US volume, difficulty and 12 months of searches, plus New
 *             York volume for the strongest. An AI estimate is never used.
 *   overlap   live site pages (from the sitemaps), Search Console queries a
 *             katzmelinger.com URL ranks top 20 for, every draft's primary
 *             keyword, and the Keyword Tracker
 *   choose    the most relevant, highest-volume candidate nothing targets yet;
 *             when a live page already covers the intent, the draft becomes an
 *             update of that page
 *
 * The decision is stored on the draft (metadata.keyword_selection) and shown
 * with every number's source and date.
 */
import { coverage, intentTokens, keywordProblem, seedFromTitle } from "./keyword-guard";

export type KeywordCandidate = {
  keyword: string;
  volume: number | null;
  /** New York State monthly searches, when DataForSEO has them. */
  volumeNy?: number | null;
  difficulty: number | null;
  monthly: number[];
  source: "dataforseo";
  fetchedAt: string;
};

export type ExistingTarget = {
  kind: "page" | "gsc" | "draft" | "tracker";
  /** What it targets: a page title and slug, a query, or a keyword. */
  text: string;
  /** Shown to the reader: a URL, or "draft 365f548e". */
  label: string;
  url?: string | null;
  draftId?: string | null;
};

export type KeywordDecision = {
  seed: string;
  status: "selected" | "needs_selection";
  chosen: KeywordCandidate | null;
  rejected: { keyword: string; reason: string }[];
  mode: "new" | "update";
  updateTargetUrl: string | null;
  /** Existing content on the same topic, for the reader (not a rejection). */
  related: { label: string; url?: string | null; draftId?: string | null }[];
  decidedAt: string;
};

const MIN_RELEVANCE = 0.6;

function describe(t: ExistingTarget): string {
  if (t.kind === "draft") return `already targeted by ${t.label}`;
  if (t.kind === "tracker") return "already in the Keyword Tracker";
  if (t.kind === "gsc") return `already ranks top 20 with ${t.label}`;
  return `covered by ${t.label}`;
}

/**
 * Pure: choose among real candidates given what already exists. `incoming`
 * is the keyword the caller arrived with (a typed one, or an Opportunity's);
 * it is kept when it passes every check, so a deliberate choice is not
 * second-guessed.
 */
export function chooseKeyword(args: {
  title: string;
  incoming?: string | null;
  candidates: KeywordCandidate[];
  existing: ExistingTarget[];
}): KeywordDecision {
  const seed = args.incoming && !keywordProblem(args.incoming) ? args.incoming.trim().toLowerCase() : seedFromTitle(args.title);
  const seedTokens = intentTokens(seed);
  const base = {
    seed,
    rejected: [] as KeywordDecision["rejected"],
    related: [] as KeywordDecision["related"],
    decidedAt: new Date().toISOString(),
  };

  // A live page that already covers the whole intent: this is an update.
  const pages = args.existing
    .filter((t) => t.kind === "page")
    .map((t) => ({ t, tok: intentTokens(t.text) }))
    .filter((p) => seedTokens.size > 0 && coverage(seedTokens, p.tok) >= 0.99)
    .sort((a, b) => coverage(b.tok, seedTokens) - coverage(a.tok, seedTokens));
  const updateTarget = pages[0]?.t ?? null;

  // Related existing content: anything sharing most of the intent.
  for (const t of args.existing) {
    if (t === updateTarget) continue;
    if (seedTokens.size && coverage(seedTokens, intentTokens(t.text)) >= 0.5 && base.related.length < 8) {
      base.related.push({ label: t.kind === "page" ? t.url ?? t.label : t.label, url: t.url ?? null, draftId: t.draftId ?? null });
    }
  }

  const seen = new Set<string>();
  const ok: { c: KeywordCandidate; score: number }[] = [];
  for (const c of args.candidates) {
    const k = c.keyword.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const problem = keywordProblem(k);
    if (problem) {
      base.rejected.push({ keyword: k, reason: problem });
      continue;
    }
    if (!c.volume) {
      base.rejected.push({ keyword: k, reason: "No search volume in DataForSEO" });
      continue;
    }
    const tok = intentTokens(k);
    // Same keyword already targeted: a draft, a tracked keyword, a ranking
    // query (all three ways, so "ny" and "new york", "lawyer" and "attorney"
    // count as one), or a page other than the one this would update.
    const hit = args.existing.find((t) => {
      if (t === updateTarget) return false;
      const tt = intentTokens(t.text);
      if (t.kind === "page") return coverage(tok, tt) >= 0.99 && coverage(tt, tok) >= 0.6;
      return coverage(tok, tt) >= 0.99 && coverage(tt, tok) >= 0.99;
    });
    if (hit) {
      base.rejected.push({ keyword: k, reason: describe(hit) });
      continue;
    }
    const relevance = coverage(seedTokens, tok);
    if (relevance < MIN_RELEVANCE) {
      base.rejected.push({ keyword: k, reason: "Off the topic of the seed" });
      continue;
    }
    ok.push({ c: { ...c, keyword: k }, score: relevance * Math.log10((c.volume ?? 0) + 10) });
  }
  ok.sort((a, b) => b.score - a.score || (b.c.volume ?? 0) - (a.c.volume ?? 0));
  const chosen = ok[0]?.c ?? null;
  if (updateTarget) base.rejected.unshift({ keyword: seed, reason: `covered by ${updateTarget.url ?? updateTarget.label}` });
  // Overlaps first (they are the decisions a reader checks), then the rest.
  const overlap = (r: { reason: string }) => /already|covered by/.test(r.reason);
  base.rejected = [...base.rejected.filter(overlap), ...base.rejected.filter((r) => !overlap(r))].slice(0, 25);

  return {
    ...base,
    status: chosen ? "selected" : "needs_selection",
    chosen,
    mode: updateTarget ? "update" : "new",
    updateTargetUrl: updateTarget?.url ?? null,
  };
}
