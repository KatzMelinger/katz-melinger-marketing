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
  type KMPillar,
  type KMContentType,
  type KMPerPageBrief,
  type KMPracticeArea,
  type KMSearchIntent,
} from "@/lib/km-content-system";
import { getTenantConfig } from "@/lib/tenant-config";
import { DEFAULT_TENANT_ID } from "@/lib/tenant-context";
import { classifyKeywordCluster } from "@/lib/keyword-cluster";

/**
 * Bridge from the (richer) keyword-cluster classifier to a pillar id, used as a
 * fallback when the narrow PILLAR_HINTS miss. Keeps pillar-worthy terms
 * ("workplace harassment", "constructive discharge") on their real pillar
 * instead of dumping them in the catch-all hub. "sexual"/"whistleblower" are
 * disambiguated from their parent clusters at the call site.
 */
const CLUSTER_TO_PILLAR: Record<string, string> = {
  harassment: "hostile",
  discrimination: "discrimination",
  retaliation: "retaliation",
  wrongful_termination: "wrongful-termination",
  leave: "leave",
  wage_hour: "wage-theft",
  severance_contract: "severance",
  judgment_enforcement: "judgment-enforcement",
  commercial_collections: "collections-hub",
};

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
  "judgment", "judgement", "collect", "creditor", "debtor", "cplr", "restraining notice",
  "asset levy", "wage garnishment", "turnover", "domestication", "fraudulent transfer",
  // Diana 2026-06-15: these were mis-filed under Employment; they're collections.
  "information subpoena", "notice of pendency", "debt lawyer", "debt attorney",
  "judgment recovery", "judgement recovery", "debt recovery",
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
export function inferPillar(
  input: ClusterInput,
  area: KMPracticeArea,
  pillars?: KMPillar[],
): string {
  const text = `${input.clusterName} ${input.primaryKeyword} ${(input.secondaryKeywords ?? []).join(" ")}`.toLowerCase();
  // Use the live (DB-driven) list when provided; otherwise fall back to the
  // code constants so existing callers behave exactly as before.
  const all = pillars ?? [...EMPLOYMENT_PILLARS, ...COLLECTIONS_PILLARS];
  const pool = all.filter((p) => p.practiceArea === area);

  // Built-in keyword hints, used when a pillar carries no `keywords` of its own.
  const PILLAR_HINTS: Record<string, string[]> = {
    "wage-theft": ["wage", "overtime", "unpaid", "minimum wage", "tip", "off the clock", "flsa", "nyll"],
    "wrongful-termination": ["wrongful termination", "fired", "fired without cause", "retaliation firing"],
    "discrimination": ["discrimination", "discriminate", "age discrimination", "ageism", "racial", "gender discrimination", "disability discrimination", "title vii"],
    "sexual-harassment": ["sexual harassment", "sexual misconduct", "quid pro quo", "groping"],
    "leave": ["leave", "fmla", "ada accommodation", "pregnancy leave", "medical leave", "family leave"],
    "hostile": ["hostile work", "hostile environment", "workplace bullying"],
    "severance": ["severance", "non-compete", "noncompete", "non compete", "employment agreement", "employment contract", "restrictive covenant", "non-disclosure", "non-solicit", "nda"],
    "retaliation": ["retaliation", "retaliat", "reprisal", "retaliatory"],
    "whistleblower": ["whistleblower", "whistle blow", "whistleblowing", "whistle-blower"],
    "collections-hub": ["collect", "collections", "creditor", "debt", "debt lawyer", "debt attorney", "information subpoena", "notice of pendency", "judgment recovery", "judgement recovery", "debt recovery"],
    "judgment-enforcement": ["judgment", "enforcement", "restraining notice", "levy", "garnishment", "turnover", "cplr"],
    "domestication": ["domesticate", "domestication", "out-of-state judgment", "sister state"],
  };

  // Drug-testing keywords (Diana 2026-06-15): drug testing is a *situation* that
  // leads to a claim, not a practice area. Route by the legal-claim angle. If the
  // angle is unclear, return "" → flagged for human review (NEVER auto-assigned
  // to a default pillar, never dropped). Order follows Diana's rules: termination
  // angle wins first, then targeting, then discrimination, then accommodation.
  if (/\bdrug (tests?|testing|screens?|screening)\b/.test(text)) {
    const inPool = (id: string) => (pool.some((p) => p.id === id) ? id : "");
    if (/\b(fired|terminated|termination|wrongful|let go|lost (my|the|her|his) job)\b/.test(text)) return inPool("wrongful-termination");
    if (/\b(targeted|target|singled out|single out|only me|picked on|specific employees?|certain employees?|select employees?|random)\b/.test(text)) return inPool("hostile");
    if (/\b(disab|disability|medical condition|prescription|prescribed|medical marijuana|ada)\b/.test(text)) return inPool("discrimination");
    if (/\baccommodat/.test(text)) return inPool("leave");
    return ""; // unclear angle → needs human review
  }

  // Spanish→English semantic equivalence. The hint scoring below is English-only,
  // so a Spanish keyword (e.g. "abogado de despido injustificado") would fall
  // through to the first pillar in the pool — which mismapped it to wage-theft.
  // A direct phrase match here wins outright (highest confidence). Ordered most-
  // specific first so "acoso sexual" beats "acoso" and "despido injustificado"
  // beats bare "despido".
  const SPANISH_TO_PILLAR: Array<[string, string]> = [
    ["despido injustificado", "wrongful-termination"],
    ["despido sin causa", "wrongful-termination"],
    ["despido", "wrongful-termination"],
    ["acoso sexual", "sexual-harassment"],
    ["acoso laboral", "hostile"],
    ["discriminacion", "discrimination"],
    ["discriminación", "discrimination"],
    ["represalias", "retaliation"],
    ["represalia", "retaliation"],
    ["denunciante", "whistleblower"],
    ["salarios no pagados", "wage-theft"],
    ["horas extras", "wage-theft"],
    ["robo de salario", "wage-theft"],
    ["salario", "wage-theft"],
    ["indemnizacion por despido", "severance"],
    ["indemnización por despido", "severance"],
    ["licencia familiar", "leave"],
    ["licencia medica", "leave"],
    ["licencia médica", "leave"],
  ];
  for (const [phrase, pid] of SPANISH_TO_PILLAR) {
    if (text.includes(phrase) && pool.some((p) => p.id === pid)) {
      return pid;
    }
  }

  // Start unclassified: a keyword that matches no pillar hint must NOT be
  // silently dumped into pool[0] (this was filing ~everything under Wage Theft).
  let bestId = "";
  let bestScore = 0;
  for (const p of pool) {
    // A pillar's own keywords take precedence; built-ins fall back to the table.
    // The hub pillar is a deliberate catch-all (no hints) — skip it in scoring so
    // a specific pillar always wins; it's only reached via the fallback below.
    if (p.id === "employment-hub") continue;
    const hints = p.keywords && p.keywords.length ? p.keywords : PILLAR_HINTS[p.id] ?? [];
    const score = hints.reduce((acc, h) => (text.includes(h) ? acc + 1 : acc), 0);
    if (score > bestScore) {
      bestScore = score;
      bestId = p.id;
    }
  }
  if (bestId) return bestId;

  // Cluster bridge: rescue pillar-worthy terms the narrow hints miss (e.g.
  // "workplace harassment" → hostile, "wrongful dismissal" → wrongful-termination)
  // before falling through to the generic hub.
  const cluster = classifyKeywordCluster(input.primaryKeyword);
  let bridged: string | undefined = CLUSTER_TO_PILLAR[cluster.key];
  if (cluster.key === "harassment" && /sexual|quid pro quo|groping/.test(text)) bridged = "sexual-harassment";
  if (cluster.key === "retaliation" && /whistle/.test(text)) bridged = "whistleblower";
  if (bridged && pool.some((p) => p.id === bridged)) return bridged;

  // No specific pillar matched. Per Ken (2026-06-15): route un-pillared
  // employment terms (general high-intent searches like "employment lawyer nyc")
  // to the employment hub rather than the old silent wage-theft default.
  // Collections falls back to its hub. (The drug-testing branch above already
  // returned "" for genuinely ambiguous keywords, so they never reach here.)
  if (area === "collections") return pool.some((p) => p.id === "collections-hub") ? "collections-hub" : "";
  return pool.some((p) => p.id === "employment-hub") ? "employment-hub" : "";
}

/**
 * Classify intent AND report whether the label was earned by an explicit
 * modifier or fell through to the default. Default-labeled keywords (no
 * recognizable modifier at all) are flagged so Diana can review/override them
 * in a queue, per the intelligence-layer spec (Step 1).
 *
 * Order matters and first match wins: commercial → proof → informational
 * question words → default. The first three are confident; only the final
 * fallthrough sets labeledByDefault.
 */
export function inferIntentWithConfidence(input: ClusterInput): {
  intent: KMSearchIntent;
  labeledByDefault: boolean;
} {
  if (input.intent) return { intent: input.intent, labeledByDefault: false };
  const text = `${input.primaryKeyword} ${input.clusterName}`.toLowerCase();
  // Commercial intent: explicit hiring language.
  // Note the `s?` on the noun terms — a bare `lawyer\b` fails to match the
  // plural "lawyers" (the trailing "s" cancels the word boundary), which used
  // to misclassify "wrongful termination lawyers" as informational → Blog.
  if (/(lawyers?|attorneys?|near me|hire|consultation|firms?|cost|fees?)\b/.test(text)) {
    return { intent: "commercial", labeledByDefault: false };
  }
  // Proof intent: results-oriented
  if (/(result|outcome|verdict|won|settlement|case study|won my case)\b/.test(text)) {
    return { intent: "proof", labeledByDefault: false };
  }
  // Informational intent: explicit question / definition language
  if (/(how|what|can i|do i|is it|should i|when|why|definition|meaning|rights|guide)\b/.test(text)) {
    return { intent: "informational", labeledByDefault: false };
  }
  // No modifier matched — default to informational (blog_post) and flag it.
  return { intent: "informational", labeledByDefault: true };
}

export function inferIntent(input: ClusterInput): KMSearchIntent {
  return inferIntentWithConfidence(input).intent;
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

const CLAUDE_JUDGE_SYSTEM = `You are a senior SEO strategist for a law firm. You decide what each keyword cluster should become.

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
  firm: { firmName: string; targetGeography: string; isDefault: boolean },
): Partial<KMPerPageBrief> {
  const pillar = ALL_KM_PILLARS.find((p) => p.id === decision.pillarId);
  const primary = input.primaryKeyword.trim();

  const titleized = primary
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  // KM (default tenant) keeps its exact original meta strings; every other firm
  // gets a neutral template populated from its own config so no KM name leaks in.
  const metaTitle = firm.isDefault
    ? decision.contentType === "practice_page"
      ? `${titleized} | Katz Melinger PLLC`
      : decision.contentType === "case_result"
        ? `${titleized}: Case Result | Katz Melinger PLLC`
        : `${titleized} in NY and NJ | Katz Melinger`
    : decision.contentType === "case_result"
      ? `${titleized}: Case Result | ${firm.firmName}`
      : `${titleized} | ${firm.firmName}`;

  const metaDescription = (
    firm.isDefault
      ? decision.practiceArea === "employment"
        ? `Katz Melinger PLLC represents employees in New York and New Jersey on ${primary}. Free consultation.`
        : `Katz Melinger PLLC represents creditors in New York and New Jersey on ${primary}. Direct court enforcement.`
      : `${firm.firmName} serves ${firm.targetGeography} on ${primary}. Free consultation.`
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
    specialInstructions: decision.pillarId
      ? decision.reasoning
      : `NEEDS HUMAN REVIEW — could not confidently map this keyword to a pillar (assign one before generating). ${decision.reasoning}`,
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

  // Validate pillar belongs to practice area. An empty id is an intentional
  // "needs human review" signal (e.g. an ambiguous drug-testing keyword) and is
  // left as-is so it surfaces for Diana rather than getting a wrong default. A
  // non-empty id that doesn't belong to the area is repaired to that area's hub.
  const pool = merged.practiceArea === "employment" ? EMPLOYMENT_PILLARS : COLLECTIONS_PILLARS;
  if (merged.pillarId && !pool.some((p) => p.id === merged.pillarId)) {
    merged.pillarId = merged.practiceArea === "employment" ? "employment-hub" : "collections-hub";
  }

  // General high-intent terms routed to a hub should reinforce the existing hub
  // page (internal links), not spawn a competing new page (Diana 2026-06-15).
  const HUB_PILLAR_IDS = new Set(["employment-hub", "collections-hub"]);
  if (HUB_PILLAR_IDS.has(merged.pillarId) && merged.recommendedAction === "new_page") {
    merged.recommendedAction = "internal_link";
    merged.cannibalizationRisk = "high";
    merged.reasoning = `Covered by the existing hub page — route to the hub and add internal links rather than creating a competing page. ${merged.reasoning}`;
  }

  const cfg = await getTenantConfig();
  const brief = buildBriefSkeleton(input, merged, {
    firmName: cfg.firmName,
    targetGeography: cfg.targetGeography,
    isDefault: cfg.tenantId === DEFAULT_TENANT_ID,
  });

  return { ...merged, brief };
}

// ---------- Lightweight metadata for non-wizard generation -----------------

export type AutoSeoMetadata = {
  metaTitle: string;
  metaDescription: string;
  urlSlug: string;
  /** "" when no confident pillar match — left blank for human review, never guessed. */
  pillarId: string;
  searchIntent: KMSearchIntent;
  practiceArea: KMPracticeArea;
  secondaryKeywords: string[];
  needsPillarReview: boolean;
};

/**
 * Deterministically derive SEO metadata (meta title/description, URL slug, and
 * a pillar) for content generated OUTSIDE the 5-step brief wizard — batch
 * generation, the autonomous content agent, social, email.
 *
 * The wizard already auto-fills these via suggestForCluster → buildBriefSkeleton;
 * every other path left them empty, so drafts arrived at Draft Review blocked on
 * missing metadata. This mirrors the wizard's auto-fill using the same pure
 * functions, minus the Claude edge-case call (cost + determinism). When the
 * topic can't be confidently mapped to a pillar, pillarId is "" and
 * needsPillarReview is true — left blank for Diana rather than guessed.
 */
export async function autoSeoMetadata(args: {
  topic: string;
  secondaryKeywords?: string[];
  contentType?: KMContentType;
  tenantId?: string;
  pillars?: KMPillar[];
}): Promise<AutoSeoMetadata> {
  const input: ClusterInput = {
    clusterName: args.topic,
    primaryKeyword: args.topic,
    secondaryKeywords: args.secondaryKeywords ?? [],
  };
  const practiceArea = inferPracticeArea(input);
  const intent = inferIntent(input);

  let pillarId = inferPillar(input, practiceArea, args.pillars);
  // Same pillar/area validation suggestForCluster applies: an empty id is an
  // intentional "needs human review" signal and is left as-is; a non-empty id
  // that doesn't belong to the area is repaired to that area's hub.
  const pool = practiceArea === "employment" ? EMPLOYMENT_PILLARS : COLLECTIONS_PILLARS;
  if (pillarId && !pool.some((p) => p.id === pillarId)) {
    pillarId = practiceArea === "employment" ? "employment-hub" : "collections-hub";
  }

  const cfg = await getTenantConfig(args.tenantId);
  const decision: Omit<StrategyDecision, "brief"> = {
    contentType: args.contentType ?? "blog_post",
    practiceArea,
    pillarId,
    searchIntent: intent,
    recommendedAction: "support_blog",
    priority: "medium",
    reasoning: "",
    cannibalizationRisk: "unknown",
    decisionSource: "rules",
  };
  const brief = buildBriefSkeleton(input, decision, {
    firmName: cfg.firmName,
    targetGeography: cfg.targetGeography,
    isDefault: cfg.tenantId === DEFAULT_TENANT_ID,
  });

  return {
    metaTitle: brief.metaTitle ?? "",
    metaDescription: brief.metaDescription ?? "",
    urlSlug: brief.urlSlug ?? "",
    pillarId,
    searchIntent: intent,
    practiceArea,
    secondaryKeywords: args.secondaryKeywords ?? [],
    needsPillarReview: !pillarId,
  };
}
