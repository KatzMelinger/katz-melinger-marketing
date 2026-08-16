/**
 * Semantic keyword clustering for the SEO Opportunity Radar.
 *
 * Groups related keywords ("workplace discrimination lawyer", "discrimination
 * lawyer NYC", "workplace discrimination attorney") into ONE cluster so the user
 * builds one authoritative page (or one pillar + supporting set) instead of three
 * competing pages — the root cause of keyword cannibalization.
 *
 * This is PREVENTIVE (group before pages are built); lib/cannibalization.ts is
 * the DETECTIVE complement (flag competing pages that already rank). The two are
 * intentionally separate halves of the same strategy.
 *
 * Engine: Claude groups by meaning (a v1 that's fast + cheap). SERP-overlap
 * clustering — keywords that share ranking URLs — is the gold standard and a
 * later upgrade for high-value clusters; this rules-light pass is plenty for the
 * list view.
 */

import { getAnthropic, extractJSON, KEYWORD_RESEARCH_MODEL } from "@/lib/anthropic";
import {
  INTENT_TO_CONTENT_TYPE,
  isCompoundKeyword,
  normalizeIntent,
  splitCompoundKeyword,
  type SearchIntent,
} from "@/lib/keyword-intent";
import type { KMContentType } from "@/lib/km-content-system";

export type ClusterInputKeyword = {
  keyword: string;
  searchVolume?: number | null;
  intent?: string | null;
};

export type KeywordCluster = {
  /** The single keyword to build the main page around (highest value in group). */
  primaryKeyword: string;
  /**
   * 'pillar'     → broad topic; build a pillar page + a supporting content cluster.
   * 'standalone' → one page fully covers the group.
   */
  type: "pillar" | "standalone";
  /** Every keyword in the cluster, INCLUDING the primary. Normalized lower-case. */
  keywords: string[];
  /**
   * The single search intent every member of this cluster shares, or null when
   * none of the members carried an intent label. Never mixed — a cluster that
   * would span two intents is split into one cluster per intent.
   */
  intent: SearchIntent | null;
  /**
   * The KM content type this cluster should be routed to, derived from `intent`.
   * Null for navigational intent (branded search belongs on an existing hub
   * page, not a new page) and for clusters with no intent data.
   */
  recommendedContentType: KMContentType | null;
};

// Cap how many keywords we cluster in one call to keep the prompt bounded.
const MAX_KEYWORDS = 200;

const normalize = (k: string) => k.trim().toLowerCase();

/**
 * Cluster a list of opportunity keywords by search intent / topic. Returns one
 * cluster per group; every input keyword lands in exactly one cluster. Falls
 * back to one standalone cluster per keyword if the model output can't be used,
 * so the caller always gets a usable grouping.
 */
export async function clusterKeywords(
  inputs: ClusterInputKeyword[],
): Promise<KeywordCluster[]> {
  // Dedupe + normalize, preserve the richest metadata per keyword.
  // A comma-merged compound ("phrase one, phrase two") is a prior clustering
  // failure, not a keyword — split it back into its parts on the way in so the
  // merge can't propagate into a brief and become the tracked target keyword.
  const byKeyword = new Map<string, ClusterInputKeyword>();
  for (const k of inputs) {
    const raw = normalize(k.keyword);
    if (!raw) continue;
    const parts = isCompoundKeyword(raw) ? splitCompoundKeyword(raw) : [raw];
    for (const part of parts) {
      const key = normalize(part);
      if (!key) continue;
      // Volume belongs to the merged string, not to either half — dropping it
      // is more honest than attributing the whole figure to each part.
      if (!byKeyword.has(key)) {
        byKeyword.set(key, {
          ...k,
          keyword: key,
          ...(parts.length > 1 ? { searchVolume: null } : {}),
        });
      }
    }
  }
  const list = Array.from(byKeyword.values()).slice(0, MAX_KEYWORDS);
  if (list.length === 0) return [];
  // Nothing to cluster meaningfully with a single keyword.
  if (list.length === 1) return [withIntent([list[0].keyword], list[0].keyword, "standalone", list)];

  const lines = list
    .map((k) => {
      const vol = typeof k.searchVolume === "number" ? ` (vol ${k.searchVolume})` : "";
      const intent = normalizeIntent(k.intent);
      return `- ${k.keyword}${vol}${intent ? ` [intent: ${intent}]` : ""}`;
    })
    .join("\n");

  const prompt = `You are an SEO strategist grouping keywords for a law firm to prevent keyword cannibalization (multiple pages competing for the same intent).

Group these keywords into clusters by SEARCH INTENT — keywords a single Google search result page would satisfy belong in the same cluster. Near-synonyms ("X lawyer" / "X attorney"), and location variants of the same service, belong together.

INTENT IS A HARD BOUNDARY. Where a keyword carries an [intent: ...] label, keywords with DIFFERENT labels must never share a cluster, no matter how much topic vocabulary they share. Two phrases about the same subject that serve different readers are two pages:
- informational — the reader wants to understand what is happening to them.
- commercial — the reader is comparing and wants proof of outcomes.
- transactional — the reader is ready to act and book a consultation.
- navigational — the reader wants a specific brand or page.
For example "pressured to retire because of age in new york" (informational) and "executive secured a strong exit new york" (commercial) share a topic but are a blog and a case result. Keep them apart.

For each cluster:
- Pick the PRIMARY keyword: the best single page target (highest search volume + clearest commercial intent).
- Classify the cluster:
  - "pillar" if it's a broad topic worth a pillar page PLUS several supporting articles (many distinct sub-intents / high combined volume).
  - "standalone" if one page fully covers it.
- Every keyword must appear in exactly one cluster (include the primary in its own keywords list).
- NEVER join two phrases into one keyword string with a comma. Return each phrase as its own keyword.

Keywords:
${lines}

Return ONLY JSON in this exact shape:
{
  "clusters": [
    { "primaryKeyword": "string", "type": "pillar" | "standalone", "keywords": ["string", ...] }
  ]
}`;

  try {
    const anthropic = getAnthropic();
    const res = await anthropic.messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n");

    const parsed = extractJSON<{ clusters?: Array<{ primaryKeyword?: string; type?: string; keywords?: string[] }> }>(text);
    const valid = new Set(list.map((k) => k.keyword));
    const assigned = new Set<string>();
    const clusters: KeywordCluster[] = [];

    for (const c of parsed.clusters ?? []) {
      const members = (c.keywords ?? [])
        .flatMap((k) => (isCompoundKeyword(k) ? splitCompoundKeyword(k) : [k]))
        .map(normalize)
        .filter((k) => valid.has(k) && !assigned.has(k));
      if (members.length === 0) continue;
      members.forEach((m) => assigned.add(m));
      let primary = normalize(c.primaryKeyword ?? "");
      if (isCompoundKeyword(primary)) primary = normalize(splitCompoundKeyword(primary)[0] ?? "");
      if (!members.includes(primary)) primary = members[0];
      const type = c.type === "pillar" ? "pillar" : "standalone";
      // Enforcement pass. The prompt asks for intent-pure clusters; this makes
      // it true regardless of what came back, so a model slip can't put a blog
      // keyword and a case-result keyword on the same page.
      clusters.push(...splitByIntent(members, primary, type, list));
    }

    // Any keyword the model dropped → its own standalone cluster, so nothing is lost.
    for (const k of list) {
      if (!assigned.has(k.keyword)) {
        clusters.push(withIntent([k.keyword], k.keyword, "standalone", list));
      }
    }

    return clusters.length > 0 ? clusters : fallbackClusters(list);
  } catch (err) {
    console.error(
      "[keyword-clustering] clustering failed, falling back to standalone:",
      err instanceof Error ? err.message : String(err),
    );
    return fallbackClusters(list);
  }
}

/** One standalone cluster per keyword — used when the AI pass is unavailable. */
function fallbackClusters(list: ClusterInputKeyword[]): KeywordCluster[] {
  return list.map((k) => withIntent([k.keyword], k.keyword, "standalone", list));
}

/** Intent label for one keyword, or null when it carries none. */
function intentOf(keyword: string, list: ClusterInputKeyword[]): SearchIntent | null {
  return normalizeIntent(list.find((k) => k.keyword === keyword)?.intent);
}

/** Build a cluster and stamp it with its shared intent + routed content type. */
function withIntent(
  keywords: string[],
  primaryKeyword: string,
  type: "pillar" | "standalone",
  list: ClusterInputKeyword[],
): KeywordCluster {
  const intents = new Set(
    keywords.map((k) => intentOf(k, list)).filter((i): i is SearchIntent => i !== null),
  );
  const intent = intents.size === 1 ? [...intents][0] : null;
  return {
    primaryKeyword,
    type,
    keywords,
    intent,
    recommendedContentType: intent ? INTENT_TO_CONTENT_TYPE[intent] : null,
  };
}

/**
 * Split one proposed cluster into one cluster per distinct intent.
 *
 * Keywords with no intent label ride with the primary's group — they can't be
 * routed on their own, and stranding them in an intent-less cluster would just
 * move the ambiguity somewhere the reviewer can't see it. A cluster whose
 * members all lack labels comes back unchanged (intent: null), which is the
 * pre-existing behavior for accounts with no intent data.
 */
function splitByIntent(
  members: string[],
  primaryKeyword: string,
  type: "pillar" | "standalone",
  list: ClusterInputKeyword[],
): KeywordCluster[] {
  const groups = new Map<string, string[]>();
  const unlabeled: string[] = [];
  for (const m of members) {
    const intent = intentOf(m, list);
    if (!intent) {
      unlabeled.push(m);
      continue;
    }
    const bucket = groups.get(intent);
    if (bucket) bucket.push(m);
    else groups.set(intent, [m]);
  }

  if (groups.size <= 1) return [withIntent(members, primaryKeyword, type, list)];

  const primaryIntent = intentOf(primaryKeyword, list) ?? [...groups.keys()][0];
  const out: KeywordCluster[] = [];
  for (const [intent, group] of groups) {
    // Unlabeled members stay with the primary's group.
    const keywords = intent === primaryIntent ? [...group, ...unlabeled] : group;
    const primary = keywords.includes(primaryKeyword) ? primaryKeyword : keywords[0];
    // A split group is a narrower target than the original — only the group
    // that kept the primary can still justify a pillar.
    const groupType = intent === primaryIntent ? type : "standalone";
    out.push(withIntent(keywords, primary, groupType, list));
  }
  return out;
}
