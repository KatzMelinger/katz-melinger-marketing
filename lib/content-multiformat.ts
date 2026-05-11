/**
 * Multi-format batch generation.
 *
 * Single Claude call → blog + LinkedIn + Twitter thread + Facebook + Instagram
 * caption + email newsletter + podcast intro/script (whatever the caller asks
 * for). Each format gets its own draft row in `content_drafts`, all linked by
 * a `content_batches` row so the UI can group them.
 *
 * Optionally consumes a source content_sources row when repurposing — e.g.
 * "take this blog and turn it into LinkedIn + Twitter."
 */

import { getSupabaseAdmin } from "./supabase-server";
import { ANTI_AI_VOICE_RULES } from "./anti-ai-voice";
import { getFirmContext } from "./firm-context";
import { buildSkillsContext } from "./content-skills";
import { extractJSON, getAnthropic, KEYWORD_RESEARCH_MODEL } from "./anthropic";

export type FormatKey =
  | "blog"
  | "linkedin"
  | "twitter"
  | "facebook"
  | "instagram"
  | "email"
  | "podcast";

const FORMAT_INSTRUCTIONS: Record<FormatKey, string> = {
  blog: "800-1200 word blog post with H2/H3 headings, lead paragraph, 3-5 sections, and a CTA. Use markdown formatting.",
  linkedin: "350-450 word LinkedIn post written in first person from the firm's perspective. Strong hook, line breaks for scannability, ends with a question or CTA. No hashtags more than 3.",
  twitter: "5-7 tweet thread. Tweet 1 is a hook (under 280 chars). Each subsequent tweet stands alone but builds the thread. Final tweet has a CTA. Use 1/ 2/ 3/ numbering at the start of each.",
  facebook: "200-280 word Facebook post. Conversational, accessible language. Opens with an attention-grabbing question or statement.",
  instagram: "Instagram caption: 150-220 words, 5-8 relevant hashtags at the end, line breaks for readability, opens with a hook.",
  email: "Email newsletter: a subject line (under 60 chars), preview text (under 110 chars), and 250-400 word body. Single clear CTA.",
  podcast: "5-7 minute solo podcast script: cold open hook (15-30 sec), intro, 3 main points with examples, recap, and call-to-action. Include speaker notes in [brackets] for tone shifts and pauses.",
};

export type MultiFormatResult = {
  batch_id: string;
  drafts: { id: string; format: FormatKey; title: string | null; body: string; metadata: Record<string, unknown> }[];
};

type ClaudeMultiOutput = {
  formats: Record<
    string,
    {
      title?: string;
      subject?: string;
      preview_text?: string;
      hashtags?: string[];
      body: string;
    }
  >;
};

export async function generateMultiFormat(args: {
  topic: string;
  practiceArea?: string;
  formats: FormatKey[];
  tone?: string;
  targetKeywords?: string[];
  seoBriefHeadings?: string[];
  competitorGaps?: string[];
  sourceId?: string | null;
  sourceText?: string | null;
}): Promise<MultiFormatResult> {
  const supabase = getSupabaseAdmin();
  const [firm, skillsContext] = await Promise.all([
    getFirmContext(),
    buildSkillsContext(),
  ]);

  const requestedSpec = args.formats
    .map((f) => `- ${f}: ${FORMAT_INSTRUCTIONS[f]}`)
    .join("\n");

  const sourceBlock = args.sourceText
    ? `\n\nREPURPOSE FROM THIS SOURCE MATERIAL:\n"""\n${args.sourceText.slice(0, 8000)}\n"""\nKeep the source's facts and insights, but rewrite each format from scratch in the firm's voice — do not just copy/paste between formats.`
    : "";

  const seoBlock =
    (args.targetKeywords?.length ?? 0) +
      (args.seoBriefHeadings?.length ?? 0) +
      (args.competitorGaps?.length ?? 0) >
    0
      ? `\n\nSEO GUIDANCE:
${args.targetKeywords?.length ? `- Target keywords: ${args.targetKeywords.join(", ")}` : ""}
${args.seoBriefHeadings?.length ? `- Suggested headings: ${args.seoBriefHeadings.join(" | ")}` : ""}
${args.competitorGaps?.length ? `- Competitor gaps to address: ${args.competitorGaps.join(" | ")}` : ""}`
      : "";

  const system = `You are a marketing copywriter for Katz Melinger PLLC.
${firm}

${ANTI_AI_VOICE_RULES}
${skillsContext ? `\n${skillsContext}\n` : ""}
Tone: ${args.tone ?? "Professional, plain-spoken, accessible"}.
Avoid legalese. Never fabricate case results or guarantees. Stay compliant — recommend speaking with an attorney rather than asserting outcomes.

For each requested format, return:
- title (or subject for email)
- preview_text (email only)
- hashtags (instagram only, as array of strings)
- body (the full content in the format's natural style)`;

  const user = `Topic: ${args.topic}
Practice area: ${args.practiceArea ?? "General"}

Generate the following formats:
${requestedSpec}${seoBlock}${sourceBlock}

Return JSON only:
{
  "formats": {
    ${args.formats.map((f) => `"${f}": { "title": "...", "body": "..." }`).join(",\n    ")}
  }
}`;

  const resp = await getAnthropic().messages.create({
    model: KEYWORD_RESEARCH_MODEL,
    max_tokens: 8192,
    system,
    messages: [{ role: "user", content: user }],
  });
  const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
  const parsed = extractJSON<ClaudeMultiOutput>(text);

  const { data: batchRow, error: batchErr } = await supabase
    .from("content_batches")
    .insert({
      topic: args.topic,
      practice_area: args.practiceArea ?? null,
      formats: args.formats,
      source_id: args.sourceId ?? null,
    })
    .select("id")
    .single();
  if (batchErr) throw new Error(`Failed to create batch: ${batchErr.message}`);

  const draftRows: { id: string; format: FormatKey; title: string | null; body: string; metadata: Record<string, unknown> }[] = [];

  for (const format of args.formats) {
    const data = parsed.formats?.[format];
    if (!data?.body) continue;
    const metadata: Record<string, unknown> = {};
    if (data.subject) metadata.subject = data.subject;
    if (data.preview_text) metadata.preview_text = data.preview_text;
    if (data.hashtags) metadata.hashtags = data.hashtags;

    const { data: draft, error: dErr } = await supabase
      .from("content_drafts")
      .insert({
        batch_id: batchRow.id,
        format,
        topic: args.topic,
        practice_area: args.practiceArea ?? null,
        title: data.title ?? null,
        body: data.body,
        metadata,
        source_id: args.sourceId ?? null,
        seo_brief: args.targetKeywords?.length || args.seoBriefHeadings?.length
          ? {
              targetKeywords: args.targetKeywords,
              headings: args.seoBriefHeadings,
              competitorGaps: args.competitorGaps,
            }
          : null,
      })
      .select("id, format, title, body, metadata")
      .single();
    if (dErr) continue;
    draftRows.push(draft as never);
  }

  return { batch_id: batchRow.id, drafts: draftRows };
}
