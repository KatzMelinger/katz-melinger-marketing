/**
 * Paid-ads account auditor — the "no API required" path.
 *
 * Instead of calling each ad platform's API (which needs developer tokens and
 * OAuth we don't have yet), the user exports a report from the platform's own
 * UI — a search-terms report, a campaign report, an ad/asset report — and
 * pastes or uploads the CSV. Claude reads the raw export and returns a
 * prioritized list of issues plus suggested negative keywords.
 *
 * This mirrors, in software, the manual audit workflow that turned a failing
 * Google Ads account around: pull the search-term report, find the wasted
 * spend and broken settings, and fix the highest-impact items first.
 *
 * The audit logic is platform-agnostic; only the data shape differs:
 *   - Search engines (Google / Microsoft / LSA): keyword + search-term audit,
 *     including negative-keyword suggestions.
 *   - Social (Meta / TikTok / LinkedIn / YouTube): audience / placement /
 *     creative spend audit — no search terms, so no negative-keyword output.
 *
 * When real platform APIs land later, they can feed the same auditAdsReport()
 * by serializing API results into the same report text — the analyzer is
 * unchanged.
 */

import {
  KEYWORD_RESEARCH_MODEL,
  extractJSON,
  getAnthropic,
} from "@/lib/anthropic";

export type AuditPlatform =
  | "google_search"
  | "google_lsa"
  | "microsoft"
  | "meta"
  | "linkedin"
  | "youtube"
  | "tiktok"
  | "other";

export type AuditReportType =
  | "search_terms"
  | "campaigns"
  | "keywords"
  | "ads"
  | "audience_placement"
  | "other";

export interface AuditIssue {
  title: string;
  severity: "high" | "medium" | "low";
  category: string; // "Wasted spend" | "Tracking" | "Settings" | "Intent mismatch" | "Policy" | "Structure"
  finding: string; // what the data actually shows (cite numbers where possible)
  impact: string; // why it matters / estimated $ or lead impact
  fix: string; // the concrete action to take in the platform UI
  platformNote: string | null; // platform-specific caveat, or null
}

export interface NegativeKeywordSuggestion {
  keyword: string;
  match_type: "exact" | "phrase" | "broad";
  level: "account" | "campaign";
  reason: string;
}

export interface AdsAuditResult {
  summary: string; // 2-4 sentence executive summary
  healthScore: number; // 0-100 — how healthy the account looks from this report
  issues: AuditIssue[]; // prioritized: highest-impact first
  negativeKeywordSuggestions: NegativeKeywordSuggestion[]; // empty for social platforms
  dataGaps: string[]; // what could NOT be assessed from this report (e.g. "no conversion column")
}

// Keep the model prompt bounded — large exports get truncated with a note.
const MAX_REPORT_CHARS = 48_000;

const SEARCH_PLATFORMS: AuditPlatform[] = [
  "google_search",
  "google_lsa",
  "microsoft",
];

const SYSTEM_PROMPT = `You are a senior paid-search and paid-social strategist auditing an ad account for a law firm. You are given a RAW REPORT the user exported from an ad platform's own UI (CSV or tab-delimited text). You do NOT have API access — work only from the report provided plus the context given.

Your job: find the highest-impact problems and the concrete fix for each, the way an expert would when handed an export. Be specific and cite numbers from the data (spend, clicks, conversions, search terms) wherever the report contains them. Do not invent numbers that aren't present.

PRIORITIZE by wasted spend and lead quality, not by how easy a fix is. The most valuable findings for a law firm are usually:

1. WASTED SPEND on irrelevant search terms. Law-firm accounts bleed money on wrong-intent queries. Flag terms that clearly don't match the firm's services (e.g. a business/employment firm showing for consumer divorce, "free legal advice", job-seekers/employees looking to sue *their own* employer when the firm represents employers, property-tax or unrelated practice areas). Each such term is a negative-keyword candidate.

2. INTENT MISMATCH between the campaign and what the firm actually wants. Legal clients usually want to CALL, not browse. Flag conversion goals or campaigns optimized for website visits / clicks instead of calls or form fills.

3. TRACKING / ATTRIBUTION GAPS. If the report shows conversions that look untracked, "no source", or zero conversion data, flag that the CRM↔Ads↔call-tracking integration may be broken — the single highest-leverage fix, because without it every other decision is blind.

4. SETTINGS / POLICY problems visible in the data: ads or campaigns that are paused, disapproved, "eligible (limited)", or showing zero impressions for long stretches (often an un-appealed policy violation sitting dead). Flag low-quality single-landing-page funnels.

5. STRUCTURE: budget concentrated on poor performers, broad-match terms with no negatives, duplicate or overlapping campaigns.

GOOGLE / MICROSOFT SEARCH-SPECIFIC RULES YOU MUST APPLY (these are real, commonly-missed constraints):
- Negative keyword *lists* do NOT apply to Performance Max campaigns. If the account runs PMax, campaign-level negative lists are silently ignored — the fix is ACCOUNT-LEVEL negative keywords (or PMax account-level brand/negative settings).
- Account-level negative keywords are capped at 1,000 entries — so reserve them for the broadest, highest-waste exclusions; put narrow ones at campaign level.
- Match type matters: a broad-match negative blocks the most, exact the least. Recommend the right level + match type per suggested negative so you don't accidentally block legitimate searches.

NEGATIVE-KEYWORD SUGGESTIONS:
- Only for search platforms (Google Search, Google LSA, Microsoft). For social platforms, return an EMPTY negativeKeywordSuggestions array — those platforms have no search terms; audit audience / placement / creative spend instead.
- For each suggestion, pick the narrowest match_type that safely blocks the waste, and choose level "account" only for broad firm-wide exclusions, otherwise "campaign".
- Never suggest a negative that could block the firm's real target searches.

SOCIAL PLATFORMS (Meta / TikTok / LinkedIn / YouTube): focus on cost-per-result by audience/placement/creative, spend on poor placements (e.g. Audience Network), creative fatigue (high spend + falling CTR), and overly broad or mistargeted audiences. Note that Meta employment ads run under the "Employment" Special Ad Category, which restricts targeting.

Return ONLY a JSON object with this exact shape — no preamble, no markdown fences:
{
  "summary": "2-4 sentence executive summary of account health and the single most important thing to fix",
  "healthScore": 0-100,
  "issues": [
    {
      "title": "short imperative title",
      "severity": "high" | "medium" | "low",
      "category": "Wasted spend" | "Tracking" | "Settings" | "Intent mismatch" | "Policy" | "Structure",
      "finding": "what the data shows, citing numbers from the report",
      "impact": "why it matters / estimated lead or $ impact",
      "fix": "the concrete action to take",
      "platformNote": "platform-specific caveat or null"
    }
  ],
  "negativeKeywordSuggestions": [
    { "keyword": "...", "match_type": "exact|phrase|broad", "level": "account|campaign", "reason": "..." }
  ],
  "dataGaps": ["what this report does NOT let you assess, e.g. 'no conversion column — cannot compute cost-per-lead'"]
}

Order issues most-impactful first. If the report is too sparse to judge something, say so in dataGaps rather than guessing.`;

export async function auditAdsReport(input: {
  report: string;
  platform: AuditPlatform | string;
  reportType?: AuditReportType | string;
  /** Optional firm context — services offered, target client, geography. */
  context?: string;
}): Promise<AdsAuditResult> {
  const platform = (input.platform || "google_search") as AuditPlatform;
  const reportType = input.reportType || "search_terms";
  const isSearch = SEARCH_PLATFORMS.includes(platform);

  const raw = (input.report || "").trim();
  if (!raw) {
    throw new Error("report is required");
  }

  const truncated = raw.length > MAX_REPORT_CHARS;
  const reportText = truncated ? raw.slice(0, MAX_REPORT_CHARS) : raw;

  const userPrompt = `Audit this ad account export.

Platform: ${platform}${isSearch ? " (search — negative keywords apply)" : " (social — audit audience/placement/creative, no negative keywords)"}
Report type: ${reportType}
${input.context ? `Firm context: ${input.context}\n` : ""}${
    truncated
      ? `NOTE: the report was truncated to the first ${MAX_REPORT_CHARS} characters — note any incompleteness in dataGaps.\n`
      : ""
  }
RAW REPORT:
"""
${reportText}
"""

Return ONLY the JSON object. Cite real numbers from the report. ${
    isSearch
      ? "Suggest negative keywords for every clearly wrong-intent search term you find."
      : "Return an empty negativeKeywordSuggestions array — this is a social platform."
  }`;

  const response = await getAnthropic().messages.create({
    model: KEYWORD_RESEARCH_MODEL,
    max_tokens: 6000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "";

  const result = extractJSON<AdsAuditResult>(text);

  // Defensive normalization — the UI relies on these always being arrays.
  result.issues = Array.isArray(result.issues) ? result.issues : [];
  result.negativeKeywordSuggestions = Array.isArray(
    result.negativeKeywordSuggestions,
  )
    ? result.negativeKeywordSuggestions
    : [];
  result.dataGaps = Array.isArray(result.dataGaps) ? result.dataGaps : [];

  // Social platforms never produce negative-keyword suggestions.
  if (!isSearch) result.negativeKeywordSuggestions = [];

  return result;
}
