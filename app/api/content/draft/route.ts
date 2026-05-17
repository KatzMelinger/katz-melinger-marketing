import { NextResponse } from "next/server";

import { ANTI_AI_VOICE_RULES } from "@/lib/anti-ai-voice";
import {
  cachedSystemPrompt,
  CONTENT_LONG_FORM_MODEL,
  CONTENT_SHORT_FORM_MODEL,
  extractJSON,
  getAnthropic,
} from "@/lib/anthropic";
import {
  getBrandVoiceContext,
  getLatestBrandProfile,
} from "@/lib/content-brand-voice";
import { buildSkillsContext } from "@/lib/content-skills";
import { getFirmContext } from "@/lib/firm-context";
import { getSupabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const TEMPLATE_INSTRUCTIONS: Record<string, string> = {
  blog_general:
    "Use a practical legal explainer format with: hook, rights overview, common mistakes, and CTA.",
  case_study:
    "Structure as anonymized case study: challenge, approach, outcome insights, and next step disclaimer.",
  newsletter:
    "Structure as newsletter: headline, 2-4 short sections, and one clear call to action.",
  social_post:
    "Write as social update with strong opening line, concise core message, and soft CTA.",
  webpage:
    "Structure as a conversion-focused service/landing page: 1) hero with H1 and value proposition, 2) who this is for, 3) signs you may have a claim, 4) how the firm helps, 5) what to expect (process), 6) FAQs, 7) strong CTA to schedule a free consultation. Use scannable H2s and short paragraphs. Include trust signals (free consultation, no fee unless we win where applicable).",
  faq:
    "Structure as an FAQ article optimized for People Also Ask and AI answer engines: open with a 1-paragraph summary, then 6-12 Q&A pairs with clear question H2s and concise answers (2-4 sentences). End with a CTA.",
  guide:
    "Structure as a comprehensive pillar guide: 1) table of contents, 2) introduction explaining who the guide is for, 3) 4-7 deep H2 sections covering rights/process/deadlines/evidence/damages/FAQs, 4) closing summary, 5) CTA. Include NY-specific statutes and deadlines where relevant.",
};

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  const contentType =
    typeof o.content_type === "string" ? o.content_type : "blog";
  const platform = typeof o.platform === "string" ? o.platform : "";
  const topic = typeof o.topic === "string" ? o.topic.trim() : "";
  const practiceArea =
    typeof o.practice_area === "string" ? o.practice_area : "General";
  const tone = typeof o.tone === "string" ? o.tone : "Professional";
  const length = typeof o.length === "string" ? o.length : "medium";
  const campaignType =
    typeof o.campaign_type === "string" ? o.campaign_type : "";
  const templateKey =
    typeof o.template_key === "string" ? o.template_key.trim() : "";
  const useBrandVoice = o.use_brand_voice !== false;
  const targetKeywords = Array.isArray(o.target_keywords)
    ? o.target_keywords.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
  const originSource =
    typeof o.origin_source === "string" ? o.origin_source.trim() : "";
  const originContext =
    o.origin_context && typeof o.origin_context === "object"
      ? (o.origin_context as Record<string, unknown>)
      : null;
  const seoBrief =
    o.seo_brief && typeof o.seo_brief === "object"
      ? (o.seo_brief as {
          longTailKeywords?: unknown;
          headings?: unknown;
          competitorGaps?: unknown;
        })
      : null;

  if (!topic) {
    return NextResponse.json({ error: "topic required" }, { status: 400 });
  }

  const platforms =
    contentType === "social" && platform
      ? [platform]
      : contentType === "blog"
        ? ["blog"]
        : contentType === "email"
          ? ["email"]
          : [];

  const [brandVoice, profile, skillsContext, firmContext] = useBrandVoice
    ? await Promise.all([
        getBrandVoiceContext(),
        getLatestBrandProfile(),
        buildSkillsContext({ platforms, practiceArea }),
        getFirmContext(),
      ])
    : ["", null, "", ""];

  const lengthGuide =
    length === "short"
      ? "About 500 words for blog; keep social under platform limits."
      : length === "long"
        ? "About 2000 words for blog."
        : "About 1000 words for blog.";

  const system = `You are a marketing copywriter for Katz Melinger PLLC, a plaintiff-side employment law firm in New York City. The firm represents workers in wage & hour, discrimination, class actions, judgment enforcement, severance, and related matters. Voice: professional but approachable, focused on helping workers understand their rights—never corporate or cold.

${firmContext}
${ANTI_AI_VOICE_RULES}

${skillsContext ? `${skillsContext}\n` : ""}
${brandVoice ? `Brand voice notes from the firm:\n${brandVoice}\n` : ""}
${profile ? `Brand guidelines summary:\n${profile.guidelinesSummary}\n` : ""}
${profile?.legalTerms?.length ? `Prefer legal terminology:\n${profile.legalTerms.join(", ")}\n` : ""}
${profile?.disclaimers?.length ? `Use applicable disclaimer language:\n${profile.disclaimers.join(" | ")}\n` : ""}
${profile?.messagingPatterns?.length ? `Messaging patterns:\n${profile.messagingPatterns.join(" | ")}\n` : ""}
${templateKey && TEMPLATE_INSTRUCTIONS[templateKey] ? `Template guidance:\n${TEMPLATE_INSTRUCTIONS[templateKey]}\n` : ""}
${targetKeywords.length ? `Target SEO keywords to include naturally:\n${targetKeywords.join(", ")}\n` : ""}
${seoBrief?.headings && Array.isArray(seoBrief.headings) ? `SEO heading suggestions:\n${seoBrief.headings.filter((item): item is string => typeof item === "string").join(" | ")}\n` : ""}
${seoBrief?.competitorGaps && Array.isArray(seoBrief.competitorGaps) ? `Competitor content gaps to address:\n${seoBrief.competitorGaps.filter((item): item is string => typeof item === "string").join(" | ")}\n` : ""}

Follow the user's output format instructions exactly. Do not fabricate case results or guarantees.`;

  let userPrompt = "";
  if (contentType === "blog") {
    userPrompt = `Write a blog post draft.
Topic: ${topic}
Practice area: ${practiceArea}
Tone: ${tone}
Length: ${lengthGuide}

Return only the blog body in Markdown (headings optional).`;
  } else if (contentType === "social") {
    userPrompt = `Write a ${platform || "social"} post.
Topic: ${topic}
Practice area: ${practiceArea}
Tone: ${tone}
Respect typical character limits; prefer one clear hook and a soft CTA to contact the firm. No hashtags unless appropriate for the platform.

Return only the post text.`;
  } else if (contentType === "email") {
    userPrompt = `Write an email campaign draft.
Campaign type: ${campaignType || "Newsletter"}
Topic: ${topic}
Tone: ${tone}

Return JSON only with keys: "subject" (string) and "body" (string, plain text or simple HTML allowed as text).`;
  } else {
    return NextResponse.json({ error: "Invalid content_type" }, { status: 400 });
  }

  try {
    // Social posts (linkedin, twitter, facebook, instagram) are short-form —
    // Haiku is plenty and ~4× cheaper than Sonnet on output. Blog and email
    // stay on Sonnet for quality.
    const model =
      contentType === "social" ? CONTENT_SHORT_FORM_MODEL : CONTENT_LONG_FORM_MODEL;
    const msg = await getAnthropic().messages.create({
      model,
      max_tokens: contentType === "blog" && length === "long" ? 8192 : 4096,
      system: cachedSystemPrompt(system),
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = msg.content.find((b) => b.type === "text");
    const text =
      textBlock && textBlock.type === "text" ? textBlock.text : "";

    // Autosave to the drafts library so every generation is recoverable.
    async function autosave(format: string, body: string, metadata: Record<string, unknown> = {}) {
      const supabase = getSupabaseServer();
      if (!supabase) return null;
      try {
        const { data } = await supabase
          .from("content_drafts")
          .insert({
            format,
            template: templateKey || null,
            topic,
            practice_area: practiceArea,
            body,
            metadata: {
              ...metadata,
              tone,
              length,
              ...(platform ? { platform } : {}),
              ...(campaignType ? { campaign_type: campaignType } : {}),
              used_brand_voice: useBrandVoice,
              ...(originSource ? { origin_source: originSource } : {}),
              ...(originContext ? { origin_context: originContext } : {}),
            },
            seo_brief:
              targetKeywords.length > 0 || seoBrief
                ? { targetKeywords, ...(seoBrief ?? {}) }
                : null,
          })
          .select("id")
          .single();
        return (data?.id as string | undefined) ?? null;
      } catch {
        return null;
      }
    }

    if (contentType === "email") {
      let subject = "";
      let bodyText = text;
      try {
        // extractJSON handles ```json fences + extra prose around the object,
        // which plain JSON.parse can't. Falls through to the raw text on
        // failure, which still saves something usable.
        const parsed = extractJSON<{ subject?: string; body?: string }>(text);
        if (typeof parsed?.subject === "string") subject = parsed.subject;
        if (typeof parsed?.body === "string") bodyText = parsed.body;
      } catch {
        /* fall through — keep the raw text so nothing is lost */
      }
      const draftId = await autosave("email", bodyText, { subject });
      return NextResponse.json({
        draft_id: draftId,
        subject,
        body: bodyText,
        raw: text,
        template: templateKey || null,
        used_brand_voice: useBrandVoice,
      });
    }

    const draftId = await autosave(contentType === "social" ? "social" : "blog", text);
    return NextResponse.json({
      draft_id: draftId,
      content: text,
      template: templateKey || null,
      used_brand_voice: useBrandVoice,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Anthropic request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
