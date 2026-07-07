/**
 * Multi-format batch generation with model routing + prompt caching.
 *
 * Each keyword's batch is split by format length:
 *   - Long-form (blog, email, podcast)         → Sonnet
 *   - Short-form (linkedin, twitter, facebook, instagram) → Haiku
 *
 * The two calls run in parallel. The system block is identical between
 * them, so the second-and-onward keywords in a multi-batch run benefit
 * from Anthropic's ephemeral prompt cache (5-min TTL, ~90% off on cached
 * input tokens).
 *
 * Each format gets its own draft row in `content_drafts`, all linked by a
 * `content_batches` row so the UI can group them. Optionally consumes a
 * source content_sources row when repurposing.
 */

import { getSupabaseAdmin } from "./supabase-server";
import { resolveTenantId } from "./tenant-context";
import { recordVendorUsage } from "./usage-meter";
import { ANTI_AI_VOICE_RULES } from "./anti-ai-voice";
import { stripEmDashes } from "./sanitize-content";
import { autoSeoMetadata } from "./strategy-engine";
import { getPillars } from "./pillars-store";
import { sensitiveToneBlock } from "./sensitive-topic";
import { languageDirective, type ContentLanguage } from "./content-language";
import { getFirmContext } from "./firm-context";
import { buildSkillsContext } from "./content-skills";
import { approvedLinkPlanBlock, buildLinkPlan } from "./internal-links";
import {
  cachedSystemPrompt,
  CONTENT_LONG_FORM_MODEL,
  CONTENT_SHORT_FORM_MODEL,
  extractJSON,
  getAnthropic,
} from "./anthropic";

export type FormatKey =
  | "blog"
  | "linkedin"
  | "twitter"
  | "facebook"
  | "instagram"
  | "carousel"
  | "email"
  | "podcast"
  | "video_short"
  | "video_long";

const LONG_FORM_FORMATS: FormatKey[] = [
  "blog",
  "email",
  "podcast",
  "video_short",
  "video_long",
];

const FORMAT_INSTRUCTIONS: Record<FormatKey, string> = {
  blog: "800-1200 word blog post with H2/H3 headings, lead paragraph, 3-5 sections, and a CTA. Use markdown formatting.",
  linkedin: "350-450 word LinkedIn post written in first person from the firm's perspective. Strong hook, line breaks for scannability, ends with a question or CTA. No hashtags more than 3.",
  twitter: "5-7 tweet thread. Tweet 1 is a hook (under 280 chars). Each subsequent tweet stands alone but builds the thread. Final tweet has a CTA. Use 1/ 2/ 3/ numbering at the start of each.",
  facebook: "200-280 word Facebook post. Conversational, accessible language. Opens with an attention-grabbing question or statement.",
  instagram: "Instagram caption: 150-220 words, 5-8 relevant hashtags at the end, line breaks for readability, opens with a hook.",
  carousel:
    "Instagram/LinkedIn carousel script. Slide 1 is a scroll-stopping hook. Then 5-8 content slides, each with a short bold headline and 1-2 supporting lines. The final slide is a clear CTA. Format each slide as 'Slide 1: ...' through 'Slide N: ...' on its own line. After the slides, add a 'Caption:' line with a posting caption under 150 words plus 3-5 hashtags.",
  email: "Email newsletter: a subject line (under 60 chars), preview text (under 110 chars), and 250-400 word body broken into short scannable sections with subheadings. Single clear CTA.",
  podcast: "5-7 minute solo podcast script: cold open hook (15-30 sec), intro, 3 main points with examples, recap, and call-to-action. Include speaker notes in [brackets] for tone shifts and pauses.",
  video_short:
    "30-60 second vertical short-form video script (Reels / TikTok / YouTube Shorts). Format as a two-column shot list using a Markdown table with columns 'Voiceover' (the spoken words) and 'On-screen / B-roll' (visual cues, on-screen text, captions). Open with a 3-second pattern-interrupt hook. One single core idea only. Keep total spoken words under ~150. End with a clear verbal CTA and a suggested on-screen end-card caption.",
  video_long:
    "5-8 minute YouTube video script. Structure: hook (0-15 sec), intro stating what the viewer will learn, 3-4 main segments, a brief mid-roll re-hook, recap, and CTA (subscribe + contact the firm). For each segment include a [B-roll / visual cue] note and a suggested on-screen lower-third. Use spoken-word cadence with short sentences, and mark [PAUSE], [tone shift], and [cut to ...] directions in brackets.",
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

function buildSystemPrompt(args: {
  firm: string;
  skillsContext: string;
  tone: string | undefined;
  language?: ContentLanguage;
}): string {
  const langBlock = languageDirective(args.language ?? "en");
  return `You are a marketing copywriter for a law firm. The firm's details are below — use them
verbatim and never fabricate firm information.
${args.firm}

${ANTI_AI_VOICE_RULES}
${args.skillsContext ? `\n${args.skillsContext}\n` : ""}
Tone: ${args.tone ?? "Professional, plain-spoken, accessible"}.
Avoid legalese. Never fabricate case results or guarantees. Stay compliant — recommend speaking with an attorney rather than asserting outcomes.
${langBlock ? `\n${langBlock}\n` : ""}
For each requested format, return:
- title (or subject for email)
- preview_text (email only)
- hashtags (instagram only, as array of strings)
- body (the full content in the format's natural style)`;
}

function buildUserPrompt(args: {
  topic: string;
  practiceArea?: string;
  formats: FormatKey[];
  targetKeywords?: string[];
  seoBriefHeadings?: string[];
  competitorGaps?: string[];
  sourceText?: string | null;
  formatDurations?: Partial<Record<FormatKey, string>>;
}): string {
  const requestedSpec = args.formats
    .map((f) => {
      const base = FORMAT_INSTRUCTIONS[f];
      const dur = args.formatDurations?.[f];
      // An explicit target runtime overrides the default length baked into the
      // base instruction (e.g. podcast/video). ~130-160 spoken words/minute.
      const durNote = dur
        ? ` TARGET RUNTIME: ${dur} — this overrides any default length above; scale the number of segments, depth, and word count to fill it (~130-160 spoken words per minute).`
        : "";
      return `- ${f}: ${base}${durNote}`;
    })
    .join("\n");

  const sourceBlock = args.sourceText
    ? `\n\nREPURPOSE FROM THIS SOURCE MATERIAL:\n"""\n${args.sourceText.slice(0, 8000)}\n"""\nKeep the source's facts and insights, but rewrite each format from scratch in the firm's voice — do not just copy/paste between formats.`
    : "";

  const seoBlock =
    (args.targetKeywords?.length ?? 0) +
      (args.seoBriefHeadings?.length ?? 0) +
      (args.competitorGaps?.length ?? 0) >
    0
      ? `\n\nSEO REQUIREMENTS:
${args.targetKeywords?.length ? `- Target keywords — include EACH of these at least once, verbatim, woven into the prose naturally (headings or body). Do not keyword-stuff and do not merely paraphrase them away: ${args.targetKeywords.join(", ")}` : ""}
${args.seoBriefHeadings?.length ? `- Suggested headings: ${args.seoBriefHeadings.join(" | ")}` : ""}
${args.competitorGaps?.length ? `- Competitor gaps to address: ${args.competitorGaps.join(" | ")}` : ""}`
      : "";

  // Sensitive topics (harassment, retaliation, discrimination, wrongful
  // termination) get a tone override that leads with calm, human language before
  // any legal reference. Prepended so it outranks the default brand voice.
  const sensitiveBlock = sensitiveToneBlock(
    args.topic,
    args.targetKeywords,
    args.seoBriefHeadings,
  );

  return `${sensitiveBlock}Topic: ${args.topic}
Practice area: ${args.practiceArea ?? "General"}

Generate the following formats:
${requestedSpec}${seoBlock}${sourceBlock}

Return JSON only:
{
  "formats": {
    ${args.formats.map((f) => `"${f}": { "title": "...", "body": "..." }`).join(",\n    ")}
  }
}`;
}

async function callClaudeForFormats(args: {
  model: string;
  system: string;
  user: string;
}): Promise<ClaudeMultiOutput> {
  const resp = await getAnthropic().messages.create({
    model: args.model,
    max_tokens: 8192,
    system: cachedSystemPrompt(args.system),
    messages: [{ role: "user", content: args.user }],
  });
  // Advisory metering: record Anthropic token usage (best-effort; resolves tenant).
  await recordVendorUsage("anthropic", {
    provider: "anthropic",
    endpoint: "content-multiformat",
    units: (resp.usage?.input_tokens ?? 0) + (resp.usage?.output_tokens ?? 0),
    detail: args.model,
  });
  const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
  try {
    return extractJSON<ClaudeMultiOutput>(text);
  } catch {
    return { formats: {} };
  }
}

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
  originSource?: string | null;
  originContext?: Record<string, unknown> | null;
  formatDurations?: Partial<Record<FormatKey, string>>;
  language?: ContentLanguage;
  /**
   * Firm to generate for. Defaults to the caller's resolved tenant (request
   * context). Pass explicitly when generating from a background/agent context
   * with no session, so brand voice, skills, and the saved rows all belong to
   * the same firm.
   */
  tenantId?: string;
}): Promise<MultiFormatResult> {
  const supabase = getSupabaseAdmin();
  // Resolve the tenant once so brand voice, skills, and the persisted batch/
  // drafts are guaranteed to come from (and be stamped to) the same firm.
  const tid = args.tenantId ?? (await resolveTenantId());
  const [firm, skillsContext] = await Promise.all([
    getFirmContext(tid),
    buildSkillsContext(
      {
        platforms: args.formats,
        practiceArea: args.practiceArea,
      },
      tid,
    ),
  ]);

  const system = buildSystemPrompt({
    firm,
    skillsContext,
    tone: args.tone,
    language: args.language,
  });

  const longForm = args.formats.filter((f) => LONG_FORM_FORMATS.includes(f));
  const shortForm = args.formats.filter((f) => !LONG_FORM_FORMATS.includes(f));

  const buildUserFor = (formats: FormatKey[]) =>
    buildUserPrompt({
      topic: args.topic,
      practiceArea: args.practiceArea,
      formats,
      targetKeywords: args.targetKeywords,
      seoBriefHeadings: args.seoBriefHeadings,
      competitorGaps: args.competitorGaps,
      sourceText: args.sourceText,
      formatDurations: args.formatDurations,
    });

  // Internal links: when the batch includes the long-form blog, hand the
  // generator an approved link plan from the Cluster Map (site_pages) so the
  // article links out to related firm pages. Scoped to the blog body — the
  // social/script formats don't need inline links. Fails soft if no inventory.
  let linkBlock = "";
  if (longForm.includes("blog")) {
    try {
      const plan = await buildLinkPlan({
        primaryKeyword: args.topic,
        secondaryKeywords: args.targetKeywords,
      });
      const block = approvedLinkPlanBlock(plan.links);
      if (block) {
        linkBlock = `\n\n---\n${block}\n(Apply these internal links in the blog/article body only; the other formats don't need them.)`;
      }
    } catch {
      /* no inventory / non-fatal */
    }
  }

  const [longResult, shortResult] = await Promise.all([
    longForm.length > 0
      ? callClaudeForFormats({
          model: CONTENT_LONG_FORM_MODEL,
          system,
          user: buildUserFor(longForm) + linkBlock,
        })
      : Promise.resolve<ClaudeMultiOutput>({ formats: {} }),
    shortForm.length > 0
      ? callClaudeForFormats({
          model: CONTENT_SHORT_FORM_MODEL,
          system,
          user: buildUserFor(shortForm),
        })
      : Promise.resolve<ClaudeMultiOutput>({ formats: {} }),
  ]);

  const merged: ClaudeMultiOutput = {
    formats: { ...longResult.formats, ...shortResult.formats },
  };

  const { data: batchRow, error: batchErr } = await supabase
    .from("content_batches")
    .insert({
      topic: args.topic,
      practice_area: args.practiceArea ?? null,
      formats: args.formats,
      source_id: args.sourceId ?? null,
      tenant_id: tid,
    })
    .select("id")
    .single();
  if (batchErr) throw new Error(`Failed to create batch: ${batchErr.message}`);

  const draftRows: { id: string; format: FormatKey; title: string | null; body: string; metadata: Record<string, unknown> }[] = [];

  // SEO metadata for the article format. Generated OUTSIDE the 5-step brief
  // wizard, this path (batch, autonomous agent, repurpose) previously left every
  // metadata field empty, so blog/service-page drafts arrived at Draft Review
  // blocked on missing meta description + pillar. Derive them once from the topic
  // so the blog draft is review-ready. Non-article formats don't carry page
  // metadata. Fails soft — the draft still saves without it.
  let seoMeta: Awaited<ReturnType<typeof autoSeoMetadata>> | null = null;
  if (args.formats.includes("blog")) {
    try {
      seoMeta = await autoSeoMetadata({
        topic: args.topic,
        secondaryKeywords: args.targetKeywords,
        tenantId: tid,
        pillars: await getPillars(tid),
      });
    } catch {
      /* non-fatal */
    }
  }

  for (const format of args.formats) {
    const data = merged.formats?.[format];
    if (!data?.body) continue;
    // Hard filter: strip em/en dashes the model let through despite the prompt
    // rule, across every format, before persisting. See lib/sanitize-content.ts.
    const cleanBody = stripEmDashes(data.body);
    const cleanTitle = data.title ? stripEmDashes(data.title) : data.title;
    const metadata: Record<string, unknown> = {};
    if (data.subject) metadata.subject = stripEmDashes(data.subject);
    if (data.preview_text) metadata.preview_text = stripEmDashes(data.preview_text);
    if (data.hashtags) metadata.hashtags = data.hashtags;
    if (args.originSource) metadata.origin_source = args.originSource;
    if (args.originContext) metadata.origin_context = args.originContext;
    metadata.generation_model = LONG_FORM_FORMATS.includes(format)
      ? CONTENT_LONG_FORM_MODEL
      : CONTENT_SHORT_FORM_MODEL;

    const { data: draft, error: dErr } = await supabase
      .from("content_drafts")
      .insert({
        batch_id: batchRow.id,
        format,
        topic: args.topic,
        practice_area: args.practiceArea ?? null,
        title: cleanTitle ?? null,
        body: cleanBody,
        metadata,
        source_id: args.sourceId ?? null,
        seo_brief:
          format === "blog" && seoMeta
            ? {
                targetKeywords: args.targetKeywords,
                headings: args.seoBriefHeadings,
                competitorGaps: args.competitorGaps,
                // Auto-filled metadata (was empty on non-wizard paths).
                primaryKeyword: args.topic,
                metaTitle: seoMeta.metaTitle,
                metaDescription: seoMeta.metaDescription,
                urlSlug: seoMeta.urlSlug,
                pillarId: seoMeta.pillarId,
                searchIntent: seoMeta.searchIntent,
                secondaryKeywords: seoMeta.secondaryKeywords,
                // Blank pillar → surfaced for Diana to assign, never guessed.
                needsPillarReview: seoMeta.needsPillarReview,
              }
            : args.targetKeywords?.length || args.seoBriefHeadings?.length
              ? {
                  targetKeywords: args.targetKeywords,
                  headings: args.seoBriefHeadings,
                  competitorGaps: args.competitorGaps,
                }
              : null,
        tenant_id: tid,
      })
      .select("id, format, title, body, metadata")
      .single();
    if (dErr) continue;
    draftRows.push(draft as never);
  }

  return { batch_id: batchRow.id, drafts: draftRows };
}
