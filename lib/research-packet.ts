/**
 * Research Packet generator — the heart of the research layer.
 *
 * Given a topic (+ optional practice area / primary keyword) it:
 *   1. Pulls matching curated Legal Authority sources.
 *   2. Runs the live People-Ask connectors in parallel (Semrush, GSC,
 *      Autocomplete, Reddit, YouTube).
 *   3. Optionally captures the live results into the People Ask library.
 *   4. Asks Claude (tool-use) to synthesize suggested FAQs, statutes to
 *      verify, content angles, a source-confidence rating, and whether
 *      attorney review is required.
 *   5. Persists a research_packets row that the KM Brief Generator can
 *      auto-fill from.
 */

import { getAnthropic, KEYWORD_RESEARCH_MODEL } from "@/lib/anthropic";
import { getFirmContext } from "@/lib/firm-context";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import {
  insertPeopleAskBatch,
  listLegalSources,
  type LegalAuthoritySource,
} from "@/lib/research-libraries";
import {
  gatherLiveSources,
  type ConnectorResult,
  type RawAskItem,
} from "@/lib/research-sources";
import type { PeopleAskSourceType } from "@/lib/research-libraries";

export type ResearchPacket = {
  id: string;
  topic: string;
  practice_area: string | null;
  primary_keyword: string | null;
  legal_sources_found: LegalAuthoritySource[];
  people_ask_sources_found: RawAskItem[];
  suggested_faqs: { question: string; answer_hint: string }[];
  suggested_statutes: string[];
  suggested_angles: string[];
  source_confidence: "low" | "medium" | "high";
  legal_review_required: boolean;
  status: "draft" | "ready" | "used" | "archived";
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

function matchLegalSources(
  all: LegalAuthoritySource[],
  topic: string,
  practiceArea: string | null,
): LegalAuthoritySource[] {
  const topicWords = topic
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const scored = all
    .map((s) => {
      let score = 0;
      if (practiceArea && s.practice_area === practiceArea) score += 3;
      const hay = `${s.name} ${(s.topics ?? []).join(" ")} ${s.notes ?? ""}`.toLowerCase();
      for (const w of topicWords) if (hay.includes(w)) score += 1;
      if (s.review_status === "verified") score += 1;
      if (s.authority_level === "primary") score += 1;
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  return scored.map((x) => x.s);
}

function computeConfidence(
  legalCount: number,
  verifiedLegalCount: number,
  liveItemCount: number,
): "low" | "medium" | "high" {
  if (verifiedLegalCount >= 2 && liveItemCount >= 8) return "high";
  if (legalCount >= 1 && liveItemCount >= 3) return "medium";
  return "low";
}

export async function generateResearchPacket(args: {
  topic: string;
  practiceArea?: string | null;
  primaryKeyword?: string | null;
  enabledSources?: PeopleAskSourceType[];
  captureToLibrary?: boolean; // default true
}): Promise<ResearchPacket> {
  const topic = args.topic.trim();
  const practiceArea = args.practiceArea ?? null;

  // 1. Curated legal sources.
  const allLegal = await listLegalSources();
  const legalMatches = matchLegalSources(allLegal, topic, practiceArea);

  // 2. Live people-ask connectors.
  const connectorResults: ConnectorResult[] = await gatherLiveSources(
    topic,
    args.enabledSources,
  );
  const liveItems: RawAskItem[] = connectorResults.flatMap((r) => r.items);

  // 3. Capture into the People Ask library (best-effort; dedupes internally).
  if (args.captureToLibrary !== false && liveItems.length > 0) {
    try {
      await insertPeopleAskBatch(
        liveItems.map((it) => ({
          content: it.content,
          source_type: it.source_type,
          practice_area: practiceArea,
          topic_tags: [topic.toLowerCase()],
          source_url: it.source_url ?? null,
          trend_signal: it.trend_signal ?? null,
          metric: it.metric ?? {},
        })),
      );
    } catch {
      /* non-fatal */
    }
  }

  // 4. Claude synthesis.
  const firm = await getFirmContext();
  const verifiedLegalCount = legalMatches.filter(
    (s) => s.review_status === "verified",
  ).length;
  const baselineConfidence = computeConfidence(
    legalMatches.length,
    verifiedLegalCount,
    liveItems.length,
  );

  const legalBlock =
    legalMatches.length > 0
      ? legalMatches
          .map(
            (s) =>
              `- [${s.authority_level}/${s.review_status}] ${s.name} (${s.source_type}, ${s.jurisdiction ?? "n/a"}) — ${s.url}`,
          )
          .join("\n")
      : "(no curated legal sources matched — flag for attorney sourcing)";

  const askBlock =
    liveItems.length > 0
      ? liveItems
          .slice(0, 60)
          .map((it) => `- [${it.source_type}] ${it.content}`)
          .join("\n")
      : "(no live people-ask data captured)";

  const system = `You assemble a Research Packet for a NY/NJ plaintiff-side employment law firm's content team. ${firm}

You are given (a) curated legal authority sources that matched the topic and (b) raw "people also ask"/trend signals pulled from live sources. Synthesize them into a packet the content team uses to brief a writer.

Rules:
- suggested_faqs: 5-8 real questions worth answering on the page, each with a short answer_hint (NOT a full answer — a pointer to what the answer should cover). Draw from the people-ask data; phrase like a real client.
- suggested_statutes: specific statutes/regulations/agencies the writer should cite or that an attorney must verify (e.g. "NY Labor Law § 740", "EEOC charge 300-day deadline"). Only list ones plausibly relevant to the topic; it's fine to return few.
- suggested_angles: 3-5 distinct content angles (blog/social/newsletter/AEO) grounded in the trend signals.
- legal_review_required: true if the topic involves deadlines, thresholds, statutes, or anything where a wrong fact creates liability. Default to true unless the topic is purely soft/marketing.
- Never invent statute numbers you're unsure of — if unsure, describe the area ("the federal FMLA eligibility threshold") rather than a fake citation.`;

  const user = `Topic: "${topic}"
Practice area: ${practiceArea ?? "(unspecified)"}
Primary keyword: ${args.primaryKeyword ?? "(none)"}

Curated legal authority sources that matched:
${legalBlock}

Live people-ask & trend signals:
${askBlock}

Call return_packet with the synthesized packet.`;

  let suggested_faqs: { question: string; answer_hint: string }[] = [];
  let suggested_statutes: string[] = [];
  let suggested_angles: string[] = [];
  let legal_review_required = true;
  let confidence = baselineConfidence;

  try {
    const resp = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 3000,
      system,
      tools: [
        {
          name: "return_packet",
          description: "Return the synthesized research packet.",
          input_schema: {
            type: "object" as const,
            properties: {
              suggested_faqs: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    question: { type: "string" },
                    answer_hint: { type: "string" },
                  },
                  required: ["question", "answer_hint"],
                },
              },
              suggested_statutes: {
                type: "array",
                items: { type: "string" },
              },
              suggested_angles: {
                type: "array",
                items: { type: "string" },
              },
              legal_review_required: { type: "boolean" },
              source_confidence: {
                type: "string",
                enum: ["low", "medium", "high"],
                description:
                  "How well-grounded this packet is given the legal sources + live signals available.",
              },
            },
            required: [
              "suggested_faqs",
              "suggested_statutes",
              "suggested_angles",
              "legal_review_required",
              "source_confidence",
            ],
          },
        },
      ],
      tool_choice: { type: "tool", name: "return_packet" },
      messages: [{ role: "user", content: user }],
    });
    const toolUse = resp.content.find((b) => b.type === "tool_use");
    if (toolUse && toolUse.type === "tool_use") {
      const input = toolUse.input as {
        suggested_faqs?: { question: string; answer_hint: string }[];
        suggested_statutes?: string[];
        suggested_angles?: string[];
        legal_review_required?: boolean;
        source_confidence?: "low" | "medium" | "high";
      };
      suggested_faqs = Array.isArray(input.suggested_faqs)
        ? input.suggested_faqs
        : [];
      suggested_statutes = Array.isArray(input.suggested_statutes)
        ? input.suggested_statutes
        : [];
      suggested_angles = Array.isArray(input.suggested_angles)
        ? input.suggested_angles
        : [];
      legal_review_required = input.legal_review_required ?? true;
      // Take the more conservative of model vs. baseline confidence.
      const rank = { low: 0, medium: 1, high: 2 } as const;
      confidence =
        rank[input.source_confidence ?? "low"] < rank[baselineConfidence]
          ? (input.source_confidence ?? "low")
          : baselineConfidence;
    }
  } catch {
    // Synthesis failed — still persist the raw research so nothing is lost.
    legal_review_required = true;
    confidence = baselineConfidence;
  }

  // 5. Persist.
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("research_packets")
    .insert({
      topic,
      practice_area: practiceArea,
      primary_keyword: args.primaryKeyword ?? null,
      legal_sources_found: legalMatches,
      people_ask_sources_found: liveItems.slice(0, 80),
      suggested_faqs,
      suggested_statutes,
      suggested_angles,
      source_confidence: confidence,
      legal_review_required,
      status: "ready",
      metadata: {
        connector_notes: connectorResults.map((r) => ({
          source: r.source,
          count: r.items.length,
          note: r.note,
        })),
      },
    })
    .select("*")
    .maybeSingle();
  if (error || !data) {
    throw new Error(error?.message ?? "failed to persist packet");
  }
  return data as ResearchPacket;
}

export async function listResearchPackets(limit = 30): Promise<ResearchPacket[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("research_packets")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ResearchPacket[];
}

export async function getResearchPacket(
  id: string,
): Promise<ResearchPacket | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("research_packets")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ResearchPacket | null) ?? null;
}
