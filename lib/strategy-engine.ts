/**
 * Strategy Engine — decides what a keyword cluster should become.
 *
 * Hybrid approach:
 *   1. Rules first cut: deterministic thresholds on KD / volume / intent /
 *      current rank classify ~90% of clusters into clear actions.
 *   2. Claude fallback: edge cases (ambiguous intent, mixed signals, or
 *      possible cannibalization with existing site content) get a JSON-only
 *      Claude call for nuanced classification.
 *
 * Output is a StrategyDecision that the suggestions API persists into
 * brief_suggestions as a pre-filled brief, ready for Diana to approve.
 *
 * The engine does NOT call Anthropic for clear-cut cases — keeps cost low
 * and decisions deterministic when the data is unambiguous.
 */

import {
  cachedSystemPrompt,
  CONTENT_LONG_FORM_MODEL,
  extractJSON,
  getAnthropic,
} from "@/lib/anthropic";
import {
  ALL_KM_PILLARS,
  EMPLOYMENT_PILLARS,
  COLLECTIONS_PILLARS,
  type KMContentType,
  type KMPerPageBrief,
  type KMPracticeArea,
  type KMSearchIntent,
} from "@/lib/km-content-system";

// ---------- Types ----------------------------------------------------------

export type RecommendedAction =
  | "new_page"
  | "support_blog"
  | "page_refresh"
  | "faq"
  | "internal_link"
  | "hold"
  | "remove";

export type Priority = "high" | "medium" | "low";

export type ClusterInput = {
  clusterName: string;
  primaryKeyword: string;
  secondaryKeywords?: string[];
  volume?: number | null;
  kd?: number | null;
  intent?: KMSearchIntent | null;
  currentRank?: number | null;
  existingUrl?: string | null;
  cpc?: number | null;
  // optional firm-context hints
  practiceAreaHint?: KMPracticeArea | null;
};

export type StrategyDecision = {
  contentType: KMContentType;
  practiceArea: KMPracticeArea;
  pillarId: string;
  searchIntent: KMSearchIntent;
  recommendedAction: RecommendedAction;
  priority: Priority;
  reasoning: string;
  cannibalizationRisk: "none" | "low" | "medium" | "high" | "unknown";
  decisionSource: "rules" | "claude" | "hybrid";
  brief: Partial<KMPerPageBrief>;
};

// ---------- Rules ----------------------------------------------------------

/**
 * Keyword → practice area heuristics. Order matters: more specific
 * collections terms must come before generic employment terms.
 */
const COLLECTIONS_HINTS = [
  "judgment", "collect", "creditor", "debtor", "cplr", "restraining notice",
  "asset levy", "wage garnishment", "turnover", "domestication", "fraudulent transfer",
];
const EMPLOYMENT_HINTS = [
  "wage theft", "overtime", "discrimination", "harassment", "wrongful termination",
  "severance", "fmla", "leave", "hostile work", "retaliation", "unpaid", "employee",
  "minimum wage", "tip", "off the clock",
];

export function inferPracticeArea(input: ClusterInput): KMPracticeArea {
  if (input.practiceAreaHint) return input.practiceAreaHint;
  const text = `${input.clusterName} ${input.primaryKeyword} ${(input.secondaryKeywords ?? []).join(" ")}`.toLowerCase();
  for (const hint of COLLECTIONS_HINTS) {
    if (text.includes(hint)) return "collections";
  }
  // Default to employment for everything else (firm leans that way).
  return "employment";
}

/**
 * Best-effort pillar matching by keyword overlap.
 */
export function inferPillar(input: ClusterInput, area: KMPracticeArea): string {
  const text = `${input.clusterName} ${input.primaryKeyword} ${(input.secondaryKeywords ?? []).join(" ")}`.toLowerCase();
  const pool = area === "employment" ? EMPLOYMENT_PILLARS : COLLECTIONS_PILLARS;

  const PILLAR_HINTS: Record<string, string[]> = {
    "wage-theft": ["wage", "overtime", "unpaid", "minimum wage", "tip", "off the clock", "flsa", "nyll"],
    "wrongful-termination": ["wrongful termination", "fired", "fired without cause", "retaliation firing"],
    "discrimination": ["discrimination", "discriminate", "age", "race", "gender", "disability discrimination", "title vii"],
    "sexual-harassment": ["sexual harassment", "sexual misconduct", "quid pro quo", "groping"],
    "leave": ["leave", "fmla", "ada accommodation", "pregnancy leave", "medical leave", "family leave"],
    "hostile": ["hostile work", "hostile environment", "workplace bullying"],
    "collections-hub": ["collect", "collections", "creditor"],
    "judgment-enforcement": ["judgment", "enforcement", "restraining notice", "levy", "garnishment", "turnover", "cplr"],
    "domestication": ["domesticate", "domestication", "out-of-state judgment", "sister state"],
  };

  let bestId = pool[0]?.id ?? "";
  let bestScore = 0;
  for (const p of pool) {
    const hints = PILLAR_HINTS[p.id] ?? [];
    const score = hints.reduce((acc, h) => (text.includes(h) ? acc + 1 : acc), 0);
    if (score > bestScore) {
      bestScore = score;
      bestId = p.id;
    }
  }
  return bestId;
}

export function inferIntent(input: ClusterInput): KMSearchIntent {
  if (input.intent) return input.intent;
  const text = `${input.primaryKeyword} ${input.clusterName}`.toLowerCase();
  // Commercial intent: explicit hiring language
  if (/(lawyer|attorney|near me|hire|consultation|firm|cost|fees?)\b/.test(text)) {
    return "commercial";
  }
  // Proof intent: results-oriented
  if (/(result|outcome|verdict|won|settlement|case study|won my case)\b/.test(text)) {
    return "proof";
  }
  return "informational";
}

type EdgeCaseReason = null | "ambiguous_intent" | "possible_cannibalization" | "borderline_kd" | "missing_data";

function detectEdgeCase(input: ClusterInput): EdgeCaseReason {
  if (input.kd == null || input.volume == null) return "missing_data";
  if (input.currentRank != null && input.currentRank > 0 && input.currentRank <= 30 && !input.existingUrl) {
    return "possible_cannibalization";
  }
  if (input.kd >= 45 && input.kd <= 55) return "borderline_kd";
  return null;
}

function rulesDecision(input: ClusterInput): {
  contentType: KMContentType;
  recommendedAction: RecommendedAction;
  priority: Priority;
  reasoning: string;
  cannibalizationRisk: "none" | "low" | "medium" | "high" | "unknown";
} {
  const kd = input.kd ?? null;
  const volume = input.volume ?? null;
  const rank = input.currentRank ?? null;
  const intent = inferIntent(input);

  // Already ranking page 1 → don't touch
  if (rank !== null && rank > 0 && rank <= 10) {
    return {
      contentType: "blog_post",
      recommendedAction: "hold",
      priority: "low",
      reasoning: `Already ranking position ${rank}. No content change recommended — monitor.`,
      cannibalizationRisk: "high",
    };
  }

  // Already ranking page 2/3 → refresh
  if (rank !== null && rank > 10 && rank <= 30) {
    return {
      contentType: "blog_post",
      recommendedAction: "page_refresh",
      priority: rank <= 20 ? "high" : "medium",
      reasoning: `Existing page ranks ${rank}. A targeted refresh has the shortest path to page one.`,
      cannibalizationRisk: "high",
    };
  }

  // Commercial intent → Practice Page
  if (intent === "commercial") {
    const isQuickWin = (kd ?? 100) <= 35;
    return {
      contentType: "practice_page",
      recommendedAction: "new_page",
      priority: isQuickWin ? "high" : kd != null && kd >= 60 ? "medium" : "high",
      reasoning: isQuickWin
        ? "Commercial intent with low keyword difficulty — strong quick-win practice-page candidate."
        : "Commercial intent — practice page is the right format for a 'hire a lawyer' query.",
      cannibalizationRisk: "low",
    };
  }

  // Proof intent → Case Result
  if (intent === "proof") {
    return {
      contentType: "case_result",
      recommendedAction: "new_page",
      priority: "medium",
      reasoning: "Proof intent — case result format addresses the searcher looking for evidence the firm gets outcomes.",
      cannibalizationRisk: "low",
    };
  }

  // Informational intent → Blog Post (support content)
  const lowKd = (kd ?? 100) <= 30;
  const highVolume = (volume ?? 0) >= 500;
  if (lowKd && highVolume) {
    return {
      contentType: "blog_post",
      recommendedAction: "support_blog",
      priority: "high",
      reasoning: `Low KD (${kd}) and meaningful volume (${volume}) — quick-win educational blog post linking up to the assigned pillar.`,
      cannibalizationRisk: "low",
    };
  }
  if (lowKd) {
    return {
      contentType: "blog_post",
      recommendedAction: "support_blog",
      priority: "medium",
      reasoning: `Low KD (${kd}) — support blog routing traffic to the pillar.`,
      cannibalizationRisk: "low",
    };
  }
  if ((kd ?? 100) >= 75 && (volume ?? 0) < 200) {
    return {
      contentType: "blog_post",
      recommendedAction: "hold",
      priority: "low",
      reasoning: `High difficulty (${kd}) and thin volume (${volume}) — not worth creating new content today.`,
      cannibalizationRisk: "unknown",
    };
  }
  return {
    contentType: "blog_post",
    recommendedAction: "support_blog",
    priority: "medium",
    reasoning: `Informational intent — default to a support blog mapped to the relevant pillar.`,
    cannibalizationRisk: "low",
  };
}

// ---------- Claude fallback ------------------------------------------------

const CLAUDE_JUDGE_SYSTEM = `You are a senior SEO strategist for Katz Melinger PLLC, an NYC employment law and commercial collections firm. You decide what each keyword cluster should become.

For the given cluster, return ONLY a JSON object with these keys (no prose, no markdown fences):
{
  "contentType": "practice_page" | "blog_post" | "case_result",
  "practiceArea": "employment" | "collections",
  "pillarId": one of: ${ALL_KM_PILLARS.map((p) => `"${p.id}"`).join(", ")},
  "searchIntent": "informational" | "commercial" | "proof",
  "recommendedAction": "new_page" | "support_blog" | "page_refresh" | "faq" | "internal_link" | "hold" | "remove",
  "priority": "high" | "medium" | "low",
  "reasoning": "one or two sentences explaining the call",
  "cannibalizationRisk": "none" | "low" | "medium" | "high" | "unknown"
}

Hard rules:
- Employment content is for employees only, never employers.
- Collections content is for creditors / businesses, never consumers.
- If the existing rank is 1-10, recommend "hold" with low priority.
- If the existing rank is 11-30, recommend "page_refresh".
- If keyword difficulty is unknown, lean toward "blog_post" / "support_blog".
`;

async function claudeJudge(input: ClusterInput): Promise<Partial<StrategyDecision> | null> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return null;
  try {
    const user = `Cluster: ${input.clusterName}
Primary keyword: ${input.primaryKeyword}
Secondary keywords: ${(input.secondaryKeywords ?? []).join(", ") || "(none)"}
Volume: ${input.volume ?? "unknown"}
Keyword difficulty: ${input.kd ?? "unknown"}
Current rank: ${input.currentRank ?? "not ranking in top 100"}
Existing URL (if any): ${input.existingUrl ?? "none"}
CPC: ${input.cpc ?? "unknown"}

Return the JSON object.`;

    const msg = await getAnthropic().messages.create({
      model: CONTENT_LONG_FORM_MODEL,
      max_tokens: 600,
      system: cachedSystemPrompt(CLAUDE_JUDGE_SYSTEM),
      messages: [{ role: "user", content: user }],
    });

    const block = msg.content.find((b) => b.type === "text");
    const text = block && block.type === "text" ? block.text : "";
    const parsed = extractJSON<Partial<StrategyDecision>>(text);
    return parsed ?? null;
  } catch (err) {
    console.error("[strategy-engine] Claude judge failed:", err);
    return null;
  }
}

// ---------- Brief auto-fill ------------------------------------------------

function slugify(s: string): string {
  return (
    "/" +
    s
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-") +
    "/"
  );
}

function buildBriefSkeleton(
  input: ClusterInput,
  decision: Omit<StrategyDecision, "brief">,
): Partial<KMPerPageBrief> {
  const pillar = ALL_KM_PILLARS.find((p) => p.id === decision.pillarId);
  const primary = input.primaryKeyword.trim();

  const titleized = primary
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const metaTitle =
    decision.contentType === "practice_page"
      ? `${titleized} | Katz Melinger PLLC`
      : decision.contentType === "case_result"
        ? `${titleized}: Case Result | Katz Melinger PLLC`
        : `${titleized} in NY and NJ | Katz Melinger`;

  const metaDescription = (
    decision.practiceArea === "employment"
      ? `Katz Melinger PLLC represents employees in New York and New Jersey on ${primary}. Free consultation.`
      : `Katz Melinger PLLC represents creditors in New York and New Jersey on ${primary}. Direct court enforcement.`
  ).slice(0, 155);

  return {
    contentType: decision.contentType,
    practiceArea: decision.practiceArea,
    primaryKeyword: primary,
    searchIntent: decision.searchIntent,
    pillarId: decision.pillarId,
    urlSlug: slugify(primary),
    h1: titleized,
    metaTitle,
    metaDescription,
    internalPillarLink: pillar?.url ?? "",
    secondaryKeywords: input.secondaryKeywords ?? [],
    cannibalizationConfirmed: false,
    cannibalizationNotes:
      decision.cannibalizationRisk === "high"
        ? "Engine flagged HIGH cannibalization risk. Confirm whether this should refresh an existing page instead of creating new."
        : undefined,
    specialInstructions: decision.reasoning,
  };
}

// ---------- Public entry point ---------------------------------------------

export async function suggestForCluster(input: ClusterInput): Promise<StrategyDecision> {
  const practiceArea = inferPracticeArea(input);
  const intent = inferIntent(input);
  const rules = rulesDecision({ ...input, intent });
  const edge = detectEdgeCase(input);

  const pillarId = inferPillar(input, practiceArea);
  let claudeData: Partial<StrategyDecision> | null = null;
  let decisionSource: StrategyDecision["decisionSource"] = "rules";

  // Run Claude only on edge cases. Pure cost-control: avoids ~85% of calls.
  if (edge) {
    claudeData = await claudeJudge(input);
    if (claudeData) decisionSource = "hybrid";
  }

  const merged: Omit<StrategyDecision, "brief"> = {
    contentType: (claudeData?.contentType as KMContentType) ?? rules.contentType,
    practiceArea: (claudeData?.practiceArea as KMPracticeArea) ?? practiceArea,
    pillarId: (claudeData?.pillarId as string) ?? pillarId,
    searchIntent: (claudeData?.searchIntent as KMSearchIntent) ?? intent,
    recommendedAction:
      (claudeData?.recommendedAction as RecommendedAction) ?? rules.recommendedAction,
    priority: (claudeData?.priority as Priority) ?? rules.priority,
    reasoning: claudeData?.reasoning ?? rules.reasoning,
    cannibalizationRisk:
      (claudeData?.cannibalizationRisk as StrategyDecision["cannibalizationRisk"]) ??
      rules.cannibalizationRisk,
    decisionSource,
  };

  // Validate pillar belongs to practice area, fall back if mismatched
  const pool = merged.practiceArea === "employment" ? EMPLOYMENT_PILLARS : COLLECTIONS_PILLARS;
  if (!pool.some((p) => p.id === merged.pillarId)) {
    merged.pillarId = pool[0].id;
  }

  const brief = buildBriefSkeleton(input, merged);

  return { ...merged, brief };
}
