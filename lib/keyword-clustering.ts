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
  const byKeyword = new Map<string, ClusterInputKeyword>();
  for (const k of inputs) {
    const key = normalize(k.keyword);
    if (!key) continue;
    if (!byKeyword.has(key)) byKeyword.set(key, { ...k, keyword: key });
  }
  const list = Array.from(byKeyword.values()).slice(0, MAX_KEYWORDS);
  if (list.length === 0) return [];
  // Nothing to cluster meaningfully with a single keyword.
  if (list.length === 1) {
    return [{ primaryKeyword: list[0].keyword, type: "standalone", keywords: [list[0].keyword] }];
  }

  const lines = list
    .map((k) => {
      const vol = typeof k.searchVolume === "number" ? ` (vol ${k.searchVolume})` : "";
      const intent = k.intent ? ` [${k.intent}]` : "";
      return `- ${k.keyword}${vol}${intent}`;
    })
    .join("\n");

  const prompt = `You are an SEO strategist grouping keywords for a law firm to prevent keyword cannibalization (multiple pages competing for the same intent).

Group these keywords into clusters by SEARCH INTENT — keywords a single Google search result page would satisfy belong in the same cluster. Near-synonyms ("X lawyer" / "X attorney"), and location variants of the same service, belong together.

For each cluster:
- Pick the PRIMARY keyword: the best single page target (highest search volume + clearest commercial intent).
- Classify the cluster:
  - "pillar" if it's a broad topic worth a pillar page PLUS several supporting articles (many distinct sub-intents / high combined volume).
  - "standalone" if one page fully covers it.
- Every keyword must appear in exactly one cluster (include the primary in its own keywords list).

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
        .map(normalize)
        .filter((k) => valid.has(k) && !assigned.has(k));
      if (members.length === 0) continue;
      members.forEach((m) => assigned.add(m));
      let primary = normalize(c.primaryKeyword ?? "");
      if (!members.includes(primary)) primary = members[0];
      const type = c.type === "pillar" ? "pillar" : "standalone";
      clusters.push({ primaryKeyword: primary, type, keywords: members });
    }

    // Any keyword the model dropped → its own standalone cluster, so nothing is lost.
    for (const k of list) {
      if (!assigned.has(k.keyword)) {
        clusters.push({ primaryKeyword: k.keyword, type: "standalone", keywords: [k.keyword] });
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
  return list.map((k) => ({
    primaryKeyword: k.keyword,
    type: "standalone" as const,
    keywords: [k.keyword],
  }));
}
