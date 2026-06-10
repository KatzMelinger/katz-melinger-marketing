/**
 * Shared client-safe types + label maps for the brief_suggestions store.
 *
 * The Strategy Engine ([lib/strategy-engine.ts]) writes one row per content
 * suggestion. Those rows are the single source of truth for two pipeline
 * surfaces:
 *   - /content/decisions — the go/no-go queue (status: pending | held)
 *   - /content/briefs     — approved suggestions, ready to draft/produce
 *
 * Both pages talk to the existing /api/seo/suggestions endpoints, so this
 * module only carries types and presentation constants — no server imports,
 * so it is safe to pull into Client Components.
 */

import type { KMPerPageBrief } from "@/lib/km-content-system";

export type SuggestionStatus = "pending" | "approved" | "rejected" | "held";

export type RecommendedAction =
  | "new_page"
  | "support_blog"
  | "page_refresh"
  | "faq"
  | "internal_link"
  | "hold"
  | "remove";

export type SuggestionMetrics = {
  volume?: number | null;
  kd?: number | null;
  currentRank?: number | null;
  cpc?: number | null;
  language?: string;
};

/** One row of brief_suggestions, as returned by /api/seo/suggestions. */
export type Suggestion = {
  id: string;
  cluster_name: string;
  primary_keyword: string;
  secondary_keywords: string[];
  content_type: string;
  practice_area: string;
  pillar_id: string | null;
  search_intent: string | null;
  recommended_action: RecommendedAction;
  priority: "high" | "medium" | "low";
  reasoning: string | null;
  decision_source: string;
  suggested_brief: Partial<KMPerPageBrief>;
  metrics: SuggestionMetrics;
  cannibalization_risk: "none" | "low" | "medium" | "high" | "unknown";
  cannibalization_notes: string | null;
  existing_url: string | null;
  status: SuggestionStatus;
  decision_notes: string | null;
  decided_at: string | null;
  decided_by: string | null;
  approved_draft_id: string | null;
  source: string;
  source_ref: string | null;
  created_at: string;
  updated_at: string;
};

export const ACTION_LABEL: Record<RecommendedAction, string> = {
  new_page: "New page",
  support_blog: "Support blog",
  page_refresh: "Refresh existing",
  faq: "FAQ",
  internal_link: "Internal link",
  hold: "Hold",
  remove: "Remove",
};

type Tone = "emerald" | "red" | "amber" | "blue" | "violet" | "neutral";

export const ACTION_TONE: Record<RecommendedAction, Tone> = {
  new_page: "blue",
  support_blog: "violet",
  page_refresh: "amber",
  faq: "neutral",
  internal_link: "neutral",
  hold: "neutral",
  remove: "red",
};

export const PRIORITY_TONE: Record<Suggestion["priority"], Tone> = {
  high: "red",
  medium: "amber",
  low: "neutral",
};

export const RISK_TONE: Record<Suggestion["cannibalization_risk"], Tone> = {
  none: "emerald",
  low: "neutral",
  medium: "amber",
  high: "red",
  unknown: "neutral",
};

export const CONTENT_TYPE_LABEL: Record<string, string> = {
  practice_page: "Practice Page",
  blog_post: "Blog Post",
  case_result: "Case Result",
};

/**
 * Maps a brief's content type to the Production Board content-mix bucket so a
 * "Send to Production" hand-off lands in the right column. Money pages are the
 * commercial practice pages; case results are trust/proof; everything else is
 * education.
 */
export function bucketForContentType(contentType: string): string {
  if (contentType === "practice_page") return "money_page";
  if (contentType === "case_result") return "mofu_trust";
  return "bofu_education";
}

/** Short relative-time string, mirroring the Production Board's formatting. */
export function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
