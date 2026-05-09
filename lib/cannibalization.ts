/**
 * Keyword cannibalization detector.
 *
 * Pulls the firm's ranked keywords from Semrush (domain_organic), groups them
 * by exact keyword text, and flags any keyword where 2+ distinct URLs from
 * the same domain rank in the top results. Cannibalization splits link equity
 * and confuses search intent, so it's worth tracking.
 *
 * The result is cached in `cannibalization_snapshots` so the dashboard can
 * render the latest snapshot instantly while the user kicks off a fresh
 * detection.
 */

import { getDomainKeywords, SEMRUSH_DOMAIN } from "./semrush";
import { getSupabaseAdmin } from "./supabase-server";
import {
  evaluateCannibalizationAlerts,
  type CannibalizationIssue,
} from "./alerts-engine";

export type CannibalizationDetail = {
  keyword: string;
  searchVolume: number;
  urls: { url: string; position: number }[];
  severity: "low" | "medium" | "high";
};

const TOP_N = 30; // anything ranking past 30 is too far down to count as competing

function classifySeverity(positions: number[]): "low" | "medium" | "high" {
  const top10 = positions.filter((p) => p <= 10).length;
  const top20 = positions.filter((p) => p <= 20).length;
  if (top10 >= 2) return "high";
  if (top20 >= 2) return "medium";
  return "low";
}

export async function detectCannibalization(
  domain: string = SEMRUSH_DOMAIN,
): Promise<{ snapshotId: string; issues: CannibalizationDetail[] }> {
  // Pull a wide enough slice that we can group meaningfully — 1000 rows
  // matches the keyword_research refresh budget and keeps Semrush units low.
  const rows = await getDomainKeywords(domain, undefined, 1000, 0, "traffic", "desc");

  const grouped = new Map<
    string,
    { volume: number; urls: { url: string; position: number }[] }
  >();
  for (const r of rows) {
    if (!r.keyword || !r.url || r.position == null) continue;
    if (r.position > TOP_N) continue;
    const key = r.keyword.toLowerCase().trim();
    const entry = grouped.get(key) ?? { volume: r.volume ?? 0, urls: [] };
    if (!entry.urls.find((u) => u.url === r.url)) {
      entry.urls.push({ url: r.url, position: r.position });
    }
    entry.volume = Math.max(entry.volume, r.volume ?? 0);
    grouped.set(key, entry);
  }

  const issues: CannibalizationDetail[] = [];
  for (const [keyword, info] of grouped) {
    if (info.urls.length < 2) continue;
    const positions = info.urls.map((u) => u.position);
    issues.push({
      keyword,
      searchVolume: info.volume,
      urls: info.urls.sort((a, b) => a.position - b.position),
      severity: classifySeverity(positions),
    });
  }

  // Highest-impact issues first.
  issues.sort((a, b) => {
    const sevRank = { high: 3, medium: 2, low: 1 } as const;
    if (sevRank[a.severity] !== sevRank[b.severity]) {
      return sevRank[b.severity] - sevRank[a.severity];
    }
    return b.searchVolume - a.searchVolume;
  });

  const supabase = getSupabaseAdmin();
  const { data: snapshot, error } = await supabase
    .from("cannibalization_snapshots")
    .insert({
      domain,
      issues,
      total_issues: issues.length,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to save snapshot: ${error.message}`);

  // Surface high-severity cannibalization in the alerts inbox.
  const alertIssues: CannibalizationIssue[] = issues
    .filter((i) => i.severity !== "low")
    .map((i) => ({
      keyword: i.keyword,
      urls: i.urls.map((u) => u.url),
      severity: i.severity,
    }));
  if (alertIssues.length > 0) {
    await evaluateCannibalizationAlerts(snapshot.id, alertIssues);
  }

  return { snapshotId: snapshot.id, issues };
}
