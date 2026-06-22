/**
 * Default scoring rubric, derived directly from the firm's SOPs:
 *   - Intake calls follow 5.1.2-a / 5.1.2-b (5-step structure)
 *   - Consultation / sales calls follow 5.2.3-a (Universal opening,
 *     case-type ID, fee presentation, objection handling, closing)
 *
 * Rows in `public.sales_rubric` override these by `dimension_key`. To edit
 * a dimension at runtime, insert a row there with the same key.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type RubricType = "intake" | "consultation" | "callback";

export type RubricDimension = {
  rubricType: RubricType;
  dimensionKey: string;
  dimensionName: string;
  maxScore: number;
  sortOrder: number;
  criteriaText: string;
  sopReference: string;
};

/* -------------------------------------------------------------------------- */
/* Intake call rubric (5.1.2-a Incoming, 5.1.2-b Outgoing)                    */
/* -------------------------------------------------------------------------- */

export const INTAKE_RUBRIC: RubricDimension[] = [
  {
    rubricType: "intake",
    dimensionKey: "intake_opening_introduction",
    dimensionName: "Opening – introduction",
    maxScore: 10,
    sortOrder: 10,
    criteriaText:
      "Screener stated their first name AND identified the firm as Katz Melinger within the first 30 seconds. " +
      "Incoming pattern: 'Thank you for calling Katz Melinger, my name is [Name]…'. " +
      "Outgoing pattern: 'Hi, my name is [Name], and I'm calling from Katz Melinger.'",
    sopReference: "5.1.2-a §1, 5.1.2-b §1",
  },
  {
    rubricType: "intake",
    dimensionKey: "intake_availability_check",
    dimensionName: "Availability check",
    maxScore: 5,
    sortOrder: 20,
    criteriaText:
      "Confirmed the caller has time to talk. Said 'about 10–15 minutes' (incoming) or '5–10 minutes' (outgoing). " +
      "If the caller is busy, offered to schedule and send a calendar invite.",
    sopReference: "5.1.2-a §1",
  },
  {
    rubricType: "intake",
    dimensionKey: "intake_confidentiality",
    dimensionName: "Confidentiality assurance",
    maxScore: 10,
    sortOrder: 30,
    criteriaText:
      "Delivered the confidentiality statement substantially as written: 'everything we discuss today is " +
      "completely confidential. Only the Katz Melinger team will have access to your information…'. Asked for assent.",
    sopReference: "5.1.2-a §1, 5.1.2-b §1",
  },
  {
    rubricType: "intake",
    dimensionKey: "intake_set_agenda",
    dimensionName: "Set the agenda",
    maxScore: 10,
    sortOrder: 40,
    criteriaText:
      "Previewed the structure: basic info → employer/pay or severance/debt details → specifics of the issue. " +
      "Selected the right agenda for the matter type (Employment / Severance / Collections).",
    sopReference: "5.1.2-a §2, 5.1.2-b §2",
  },
  {
    rubricType: "intake",
    dimensionKey: "intake_address_concerns",
    dimensionName: "Addressed concerns first",
    maxScore: 5,
    sortOrder: 50,
    criteriaText: "Asked: 'Do you have any specific concerns or questions about this process before we begin?'",
    sopReference: "5.1.2-a §2",
  },
  {
    rubricType: "intake",
    dimensionKey: "intake_information_gathering",
    dimensionName: "Information gathering",
    maxScore: 15,
    sortOrder: 60,
    criteriaText:
      "Collected the four core data points: (1) personal details, (2) main issue with employer, " +
      "(3) desired outcome (compensation, reinstatement, etc.), (4) any wrap-up details. " +
      "All info gathered LIVE on the call (per 5.1.2 §2.1) — not deferred to email.",
    sopReference: "5.1.2-a §3, 5.1.2 §2",
  },
  {
    rubricType: "intake",
    dimensionKey: "intake_wrap_up_question",
    dimensionName: "Wrap-up information question",
    maxScore: 5,
    sortOrder: 70,
    criteriaText: "Asked: 'Is there any other information you want to provide that we have not yet covered?'",
    sopReference: "5.1.2-a §3",
  },
  {
    rubricType: "intake",
    dimensionKey: "intake_next_steps",
    dimensionName: "Next steps explanation",
    maxScore: 10,
    sortOrder: 80,
    criteriaText:
      "Explained next steps approximately as: 'Our team will determine if we can assist you, or need further information, " +
      "or whether there are other resources we can provide.' Did NOT promise any particular outcome.",
    sopReference: "5.1.2-a §4",
  },
  {
    rubricType: "intake",
    dimensionKey: "intake_final_questions",
    dimensionName: "Invited final questions",
    maxScore: 5,
    sortOrder: 90,
    criteriaText: "Asked: 'Do you have any questions for me before we finish this call?'",
    sopReference: "5.1.2-a §4",
  },
  {
    rubricType: "intake",
    dimensionKey: "intake_tone_and_language",
    dimensionName: "Tone, empathy, language compliance",
    maxScore: 15,
    sortOrder: 100,
    criteriaText:
      "Maintained a courteous, empathetic, professional tone. Matched the caller's emotional state " +
      "(calm/angry/panicked/friendly/overburdened/frustrated) per the 5.2.3-a tone framework. " +
      "Did NOT use any forbidden phrases: 'you should…', 'you're wrong', 'I demand…', 'we can't', 'we won't', " +
      "'not our policy', 'you don't understand', 'that does not make sense', 'you must be confused', " +
      "'I'm too busy to deal with this', 'you have to'. " +
      "Used preferred phrases instead: 'let's work on this…', 'I understand… let's…', " +
      "'can you help me understand…', 'what I can do is…', 'this is a top priority for me…', " +
      "'I'll make sure we make this right…'.",
    sopReference: "5.2.3-a Communication Best Practices",
  },
  {
    rubricType: "intake",
    dimensionKey: "intake_quality_rating",
    dimensionName: "Implicit case quality (High/Medium/Low)",
    maxScore: 10,
    sortOrder: 110,
    criteriaText:
      "Did the screener gather enough specifics to support a High/Medium/Low rating? " +
      "(Claim type clearly identifiable, jurisdiction known, employer info, dollar magnitude, time window). " +
      "Score reflects the QUALITY of qualifying questions, not the case's merit.",
    sopReference: "5.1.2-a §5",
  },
];

/* -------------------------------------------------------------------------- */
/* Consultation / sales call rubric (5.2.3-a)                                  */
/* -------------------------------------------------------------------------- */

export const CONSULTATION_RUBRIC: RubricDimension[] = [
  {
    rubricType: "consultation",
    dimensionKey: "consult_universal_opening",
    dimensionName: "Universal opening",
    maxScore: 10,
    sortOrder: 10,
    criteriaText:
      "Used the SOP-approved opening verbatim or near-verbatim: 'Hi [Name], this is [Your Name] calling from " +
      "Katz Melinger… our team has had a chance to review your information, and we'd love to help you. " +
      "I'd like to take a few minutes to go over what we can do for you and walk you through how we work — " +
      "does now still work for you?'",
    sopReference: "5.2.3-a Part 1",
  },
  {
    rubricType: "consultation",
    dimensionKey: "consult_case_type_identification",
    dimensionName: "Identified case type",
    maxScore: 10,
    sortOrder: 20,
    criteriaText:
      "Correctly classified the matter as one of: Pre-Litigation/Demand Letter, Judgment Enforcement, " +
      "Collections Litigation, Domestication of Foreign Judgments, Severance, Wage & Hour, Discrimination/Harassment/Retaliation, " +
      "or Hourly/Counseling. Followed the corresponding section of 5.2.3-a.",
    sopReference: "5.2.3-a Part 2",
  },
  {
    rubricType: "consultation",
    dimensionKey: "consult_fee_presentation_correct_tier",
    dimensionName: "Fee presentation – correct tier only",
    maxScore: 15,
    sortOrder: 30,
    criteriaText:
      "Presented ONLY the fee tier that applies to this case (do NOT list all three tiers). " +
      "Tier rules per 5.2.3-a: " +
      "Pre-Lit/Judgment Enforcement: <$50K=$1,500 / $50K–$250K=$2,500 / >$250K=$5,000. " +
      "Collections Litigation: <$250K=$5,000 / $250K–$1M=$7,500 / >$1M=$10,000. " +
      "Severance: $1,500 flat + 1/3 of any increase. " +
      "Wage & Hour: $1,500/person, 1/3 demand or 40% litigation. " +
      "Discrimination: $2,500/person demand (1/3) or $5,000/person litigation (40% pre-deps, 45% after).",
    sopReference: "5.2.3-a §§ 3–5, 5.2.6",
  },
  {
    rubricType: "consultation",
    dimensionKey: "consult_objection_handling",
    dimensionName: "Objection handling sequence",
    maxScore: 15,
    sortOrder: 40,
    criteriaText:
      "When the PC objected, did the screener follow 1st Attempt → 2nd Attempt → Last Resort → Escalate? " +
      "Did NOT offer the alternative fee structure without explicit Adam/Kenneth/Nicole approval. " +
      "Used the SOP-prescribed phrasings (or close paraphrase) for each attempt level.",
    sopReference: "5.2.3-a Objection Handling tables",
  },
  {
    rubricType: "consultation",
    dimensionKey: "consult_tone_matching",
    dimensionName: "Tone matching",
    maxScore: 10,
    sortOrder: 50,
    criteriaText:
      "Matched the client's emotional state per the framework: " +
      "Natural→steady, Angry→genuine concern, Panicked→urgent reassurance, Friendly→warmth, " +
      "Overburdened→sympathetic acknowledgment, Frustrated→empathetic validation without agreeing with misinformation.",
    sopReference: "5.2.3-a Match the Client's Energy",
  },
  {
    rubricType: "consultation",
    dimensionKey: "consult_avoid_words_compliance",
    dimensionName: "Forbidden phrases avoided",
    maxScore: 10,
    sortOrder: 60,
    criteriaText:
      "ZERO use of any of the 11 'Words to AVOID': you should, you're wrong, I demand, we can't, we won't, " +
      "not our policy, you don't understand, that does not make any sense, you must be confused, " +
      "I'm too busy to deal with this, you have to. (Each occurrence is a compliance flag.)",
    sopReference: "5.2.3-a Communication Best Practices",
  },
  {
    rubricType: "consultation",
    dimensionKey: "consult_use_words_compliance",
    dimensionName: "Preferred phrases used",
    maxScore: 5,
    sortOrder: 70,
    criteriaText:
      "Substantively used at least 3 of the 'Words to USE' replacements: 'let's work on this', " +
      "'I understand… let's', 'can you help me understand', 'what I can do is', 'this is a top priority', " +
      "'I'll make sure we make this right'.",
    sopReference: "5.2.3-a Communication Best Practices",
  },
  {
    rubricType: "consultation",
    dimensionKey: "consult_no_off_limits_topics",
    dimensionName: "Compliance: off-limits topics",
    maxScore: 10,
    sortOrder: 80,
    criteriaText:
      "Did NOT discuss fee increases for appeals or counterclaims (those live in the engagement letter). " +
      "Did NOT promise outcomes or specific dollar amounts (NY/NJ attorney advertising rules). " +
      "Did NOT offer alternative/contingency-only structures without prior partner approval. " +
      "Strategic legal questions deferred to the attorney consultation.",
    sopReference: "5.2.3-a Part 6, NY/NJ ad rules",
  },
  {
    rubricType: "consultation",
    dimensionKey: "consult_closing_engagement_letter",
    dimensionName: "Closing – engagement letter & payment",
    maxScore: 10,
    sortOrder: 90,
    criteriaText:
      "Used the standard closing: 'You will be receiving an email with your Engagement Letter along with a link to " +
      "complete your payment. Please review, sign, and submit your payment at your earliest convenience — once that " +
      "is done, your case will be introduced to your legal team.' Stated the next steps clearly and confirmed.",
    sopReference: "5.2.3-a Part 6",
  },
  {
    rubricType: "consultation",
    dimensionKey: "consult_assume_the_close",
    dimensionName: "Assumed the close",
    maxScore: 5,
    sortOrder: 100,
    criteriaText:
      "Moved confidently from fee discussion to send-the-engagement-letter without unnecessary hedging or " +
      "asking for permission to proceed. Built trust, presented fees clearly, handled objections, then closed.",
    sopReference: "5.2.3-a 'Your Goal on Every Call'",
  },
];

/* -------------------------------------------------------------------------- */
/* Callback / follow-up call rubric                                            */
/*                                                                             */
/* A callback is a re-engagement call: the PC was already spoken to once       */
/* (intake done, or an engagement letter was sent but not signed / payment     */
/* not completed) and the team is following up to move them forward. It reuses */
/* the tone + objection-handling backbone of 5.2.3-a but is graded on how well */
/* the screener re-establishes context and drives a concrete next step.        */
/* -------------------------------------------------------------------------- */

export const CALLBACK_RUBRIC: RubricDimension[] = [
  {
    rubricType: "callback",
    dimensionKey: "callback_opening_identification",
    dimensionName: "Opening – re-introduction",
    maxScore: 15,
    sortOrder: 10,
    criteriaText:
      "Screener stated their first name AND identified the firm as Katz Melinger within the first 30 seconds, " +
      "and made clear this is a follow-up rather than a cold call. " +
      "Pattern: 'Hi [Name], this is [Your Name] following up from Katz Melinger.'",
    sopReference: "5.1.2-b §1, 5.2.3-a Part 1",
  },
  {
    rubricType: "callback",
    dimensionKey: "callback_reference_prior_context",
    dimensionName: "Referenced prior conversation",
    maxScore: 15,
    sortOrder: 20,
    criteriaText:
      "Acknowledged where the previous interaction left off and stated the specific reason for the callback " +
      "(e.g. 'you mentioned you wanted to think it over', 'your engagement letter is still waiting on a signature'). " +
      "Did NOT restart the intake from scratch as if no prior contact happened.",
    sopReference: "5.2.3-a Part 1",
  },
  {
    rubricType: "callback",
    dimensionKey: "callback_permission_time_check",
    dimensionName: "Permission / time check",
    maxScore: 5,
    sortOrder: 30,
    criteriaText:
      "Confirmed the PC has a few minutes to talk now, or offered to schedule a better time and send a calendar invite. " +
      "Did not launch into the pitch without checking availability.",
    sopReference: "5.1.2-a §1",
  },
  {
    rubricType: "callback",
    dimensionKey: "callback_value_recap",
    dimensionName: "Re-established value",
    maxScore: 15,
    sortOrder: 40,
    criteriaText:
      "Briefly restated what the firm can do for this specific matter and why moving forward benefits the PC, " +
      "without re-presenting every fee tier. Reconnected the PC to the outcome they wanted.",
    sopReference: "5.2.3-a Parts 2–5",
  },
  {
    rubricType: "callback",
    dimensionKey: "callback_surface_open_concerns",
    dimensionName: "Surfaced open concerns",
    maxScore: 10,
    sortOrder: 50,
    criteriaText:
      "Proactively asked what is holding the PC back or what questions remain since the last call " +
      "(e.g. 'what's the main thing keeping you from getting started?') and listened before responding.",
    sopReference: "5.2.3-a Objection Handling",
  },
  {
    rubricType: "callback",
    dimensionKey: "callback_objection_handling",
    dimensionName: "Objection handling sequence",
    maxScore: 15,
    sortOrder: 60,
    criteriaText:
      "When the PC objected (price, timing, spouse, comparison shopping), followed " +
      "1st Attempt → 2nd Attempt → Last Resort → Escalate. " +
      "Did NOT offer the alternative fee structure without explicit Adam/Kenneth/Nicole approval.",
    sopReference: "5.2.3-a Objection Handling tables",
  },
  {
    rubricType: "callback",
    dimensionKey: "callback_clear_next_step",
    dimensionName: "Drove a concrete next step",
    maxScore: 15,
    sortOrder: 70,
    criteriaText:
      "Closed on a single, specific next action with a timeframe: sign the engagement letter, complete payment, " +
      "or a booked consultation slot — not a vague 'let me know'. Confirmed the PC knew exactly what happens next.",
    sopReference: "5.2.3-a Part 6, 'Assume the close'",
  },
  {
    rubricType: "callback",
    dimensionKey: "callback_tone_and_compliance",
    dimensionName: "Tone, empathy, language compliance",
    maxScore: 10,
    sortOrder: 80,
    criteriaText:
      "Matched the PC's emotional state, stayed courteous and unpushy despite this being a follow-up, " +
      "and used ZERO of the 11 forbidden phrases from 5.2.3-a ('you should', 'you have to', 'we can't', etc.). " +
      "Each forbidden-phrase occurrence is a compliance flag.",
    sopReference: "5.2.3-a Communication Best Practices",
  },
];

export const ALL_RUBRICS = [...INTAKE_RUBRIC, ...CONSULTATION_RUBRIC, ...CALLBACK_RUBRIC];

/* -------------------------------------------------------------------------- */
/* Loader: merge defaults with DB overrides                                   */
/* -------------------------------------------------------------------------- */

export type RubricRow = {
  rubric_type: string;
  dimension_key: string;
  dimension_name: string;
  max_score: number;
  sort_order: number;
  criteria_text: string;
  sop_reference: string | null;
  active: boolean;
};

/** Load rubric for a given type. DB rows (where active=true) override
 *  the hardcoded defaults by `dimension_key`; new keys append. */
export async function loadRubric(
  supabase: SupabaseClient | null,
  rubricType: RubricType,
  tenantId?: string,
): Promise<RubricDimension[]> {
  const defaults = ALL_RUBRICS.filter((r) => r.rubricType === rubricType);
  if (!supabase) return defaults;

  // sales_rubric is service-role accessed (RLS bypassed), so scope by tenant
  // here when a tenant is known, or one firm's rubric overrides leak into
  // another's call scoring.
  let query = supabase
    .from("sales_rubric")
    .select("*")
    .eq("rubric_type", rubricType)
    .eq("active", true);
  if (tenantId) query = query.eq("tenant_id", tenantId);
  const { data, error } = await query.order("sort_order");
  if (error || !data || data.length === 0) return defaults;

  const overrides = new Map<string, RubricRow>();
  for (const r of data as RubricRow[]) overrides.set(r.dimension_key, r);

  const merged: RubricDimension[] = defaults.map((d) => {
    const o = overrides.get(d.dimensionKey);
    if (!o) return d;
    overrides.delete(d.dimensionKey);
    return {
      rubricType,
      dimensionKey: o.dimension_key,
      dimensionName: o.dimension_name,
      maxScore: o.max_score,
      sortOrder: o.sort_order,
      criteriaText: o.criteria_text,
      sopReference: o.sop_reference ?? "",
    };
  });
  // Append any new dimension_keys defined only in DB
  for (const o of overrides.values()) {
    merged.push({
      rubricType,
      dimensionKey: o.dimension_key,
      dimensionName: o.dimension_name,
      maxScore: o.max_score,
      sortOrder: o.sort_order,
      criteriaText: o.criteria_text,
      sopReference: o.sop_reference ?? "",
    });
  }
  merged.sort((a, b) => a.sortOrder - b.sortOrder);
  return merged;
}
