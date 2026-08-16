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
import { languageDirective, normalizeLanguage } from "@/lib/content-language";
import { getFirmContext } from "@/lib/firm-context";
import { guardUser } from "@/lib/supabase-route";
import { stripEmDashes } from "@/lib/sanitize-content";
import { isSensitiveTopic, SENSITIVE_TONE_OVERRIDE } from "@/lib/sensitive-topic";
import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";
import { approvedLinkPlanBlock, buildLinkPlan } from "@/lib/internal-links";
import { scheduleDraftAnalysis } from "@/lib/auto-analyze";
import { findExistingContent, duplicateMessage } from "@/lib/content-dedup";
import {
  CONTENT_TYPE_TO_INTENT,
  isCompoundKeyword,
  kmSearchIntentFor,
  normalizeIntent,
  resolvePrimaryKeyword,
  type SearchIntent,
} from "@/lib/keyword-intent";
import {
  getPillarById,
  KM_HUB_LINKS,
  type KMContentType,
  type KMPracticeArea,
} from "@/lib/km-content-system";
import { inferPillar } from "@/lib/strategy-engine";

export const dynamic = "force-dynamic";

// Map the request's narrow content_type / template_key into the broader
// content-type label that brand-voice directions are scoped by ("Blog Post",
// "FAQ", "Practice Page", etc.). Template key wins when present because it's
// more specific. Used to filter structure / direction skills.
const TEMPLATE_TO_CONTENT_TYPE: Record<string, string> = {
  blog_general: "Blog Post",
  faq: "FAQ",
  case_study: "Case Study",
  newsletter: "Email Newsletter",
  social_post: "Social Media Post",
  webpage: "Practice Page",
  guide: "Blog Post",
};

const CONTENT_TYPE_FALLBACK: Record<string, string> = {
  blog: "Blog Post",
  social: "Social Media Post",
  email: "Email Newsletter",
};

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

/**
 * Guarantees a usable title when the model doesn't return one (non-JSON
 * fallback). Prefers the first Markdown heading, then the first short line,
 * then a title-cased version of the topic.
 */
function deriveTitle(content: string, fallbackTopic: string): string {
  const clean = (s: string) =>
    s.replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);

  const heading = content.match(/^\s{0,3}#{1,3}\s+(.+?)\s*$/m);
  if (heading?.[1]) return clean(heading[1]);

  const firstLine = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (firstLine && firstLine.length <= 120) return clean(firstLine);

  const topic = fallbackTopic.trim();
  if (topic) {
    return clean(topic.replace(/\b\w/g, (c) => c.toUpperCase()));
  }
  return "Untitled draft";
}

/**
 * Which KM content type a request produces. Template key wins when present
 * because it is more specific than the coarse content_type.
 *
 * Only WEB content maps here. Social posts and email campaigns are not indexed
 * pages, carry no SEO metadata bar, and are deliberately left out — gating them
 * on a primary keyword would break those flows for no benefit.
 */
const TEMPLATE_TO_KM_CONTENT_TYPE: Record<string, KMContentType> = {
  webpage: "practice_page",
  case_study: "case_result",
  blog_general: "blog_post",
  faq: "blog_post",
  guide: "blog_post",
};

function kmContentTypeFor(contentType: string, templateKey: string): KMContentType | null {
  if (templateKey && TEMPLATE_TO_KM_CONTENT_TYPE[templateKey]) {
    return TEMPLATE_TO_KM_CONTENT_TYPE[templateKey];
  }
  return contentType === "blog" ? "blog_post" : null;
}

const COLLECTIONS_HINTS = [
  "collection", "creditor", "debt", "judgment", "judgement", "levy",
  "garnishment", "restraining notice", "turnover", "domesticat", "subpoena",
];

function kmPracticeAreaFor(practiceArea: string, scopeText: string): KMPracticeArea {
  const hay = `${practiceArea} ${scopeText}`.toLowerCase();
  return COLLECTIONS_HINTS.some((h) => hay.includes(h)) ? "collections" : "employment";
}

/** URL-safe slug from a title or keyword. Bounded so it stays a usable path. */
function toSlug(input: string): string {
  return (input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
    .replace(/-$/, "");
}

/** Meta description capped at the 155 chars validateBrief enforces. */
function clampMetaDescription(input: string): string {
  const clean = (input ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= 155) return clean;
  const cut = clean.slice(0, 155);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 100 ? cut.slice(0, lastSpace) : cut).trim();
}

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;
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

  // Classification gate (web content only). A page may not be generated without
  // a single content type and a single clean primary keyword — the defect that
  // shipped drafts to Approve with Type / Primary keyword / Pillar all showing
  // "—", and let a comma-merged compound become the tracked target keyword.
  //
  // Social posts and email campaigns are exempt: they are not indexed pages and
  // have no SEO metadata to populate.
  const isWebContent = contentType === "blog";
  const kmContentType = kmContentTypeFor(contentType, templateKey);
  // The real target keyword, not the headline. Falls back to the topic for
  // callers that don't send target_keywords.
  const primaryKeyword = resolvePrimaryKeyword(targetKeywords[0], topic);

  if (isWebContent) {
    if (!kmContentType) {
      return NextResponse.json(
        {
          error:
            "Content type could not be determined. Set template_key or content_type before generating.",
          classification: "content_type_missing",
        },
        { status: 400 },
      );
    }
    if (!primaryKeyword) {
      const merged = [targetKeywords[0], topic].find(
        (k): k is string => typeof k === "string" && isCompoundKeyword(k),
      );
      return NextResponse.json(
        {
          error: merged
            ? `Primary keyword "${merged}" merges two phrases into one string — a clustering failure, not a valid keyword. Split it and pick one intent before generating.`
            : "A single primary keyword is required before generating.",
          classification: merged ? "primary_keyword_compound" : "primary_keyword_missing",
          ...(merged ? { compoundKeyword: merged } : {}),
        },
        { status: 400 },
      );
    }
  }

  // Duplicate guard — block creating a second piece for the same keyword/cluster
  // across drafts, briefs, the board, published pages, and the keyword cluster.
  // Deduping on the resolved primary keyword rather than the topic matters for
  // the Recommendations / Fan-out paths, where the topic is a long headline and
  // the keyword is the thing that actually competes in search.
  // A manual user can override with { force: true } ("Create anyway").
  if (o.force !== true) {
    const dup = await findExistingContent({
      tenantId: await resolveTenantId(),
      keyword: primaryKeyword ?? topic,
      secondaryKeywords: targetKeywords,
    });
    if (dup) {
      return NextResponse.json(
        { error: duplicateMessage(dup), duplicate: true, existing: dup },
        { status: 409 },
      );
    }
  }

  const platforms =
    contentType === "social" && platform
      ? [platform]
      : contentType === "blog"
        ? ["blog"]
        : contentType === "email"
          ? ["email"]
          : [];

  const resolvedContentType =
    TEMPLATE_TO_CONTENT_TYPE[templateKey] ??
    CONTENT_TYPE_FALLBACK[contentType] ??
    undefined;

  const [brandVoice, profile, skillsContext, firmContext] = useBrandVoice
    ? await Promise.all([
        getBrandVoiceContext(),
        getLatestBrandProfile(),
        buildSkillsContext({
          platforms,
          practiceArea,
          contentType: resolvedContentType,
        }),
        getFirmContext(),
      ])
    : ["", null, "", ""];

  const lengthGuide =
    length === "short"
      ? "About 500 words for blog; keep social under platform limits."
      : length === "long"
        ? "About 2000 words for blog."
        : "About 1000 words for blog.";

  const system = `You are a marketing copywriter for a law firm. Use the firm's details, practice areas, and audience from the firm context below — never fabricate firm information. Voice: professional but approachable, focused on helping clients understand their rights—never corporate or cold.

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
    // Long-form (blog + webpage/guide/faq/case_study via templateKey) must
    // always carry a title AND structured headings — see the content policy.
    userPrompt = `Write a blog post draft.
Topic: ${topic}
Practice area: ${practiceArea}
Tone: ${tone}
Length: ${lengthGuide}

Requirements:
- Provide a compelling, specific title (the article's H1).
- Structure the body with clear section headings using Markdown ## (H2) and ### (H3). Include at least 3 section headings.
- Do NOT repeat the title as a heading at the top of the body.
- Provide SEO metadata: a meta title (<= 60 characters), a meta description (<= 155 characters), and a lowercase hyphenated URL slug. Work the primary keyword "${primaryKeyword ?? topic}" into the meta title and description naturally — do not keyword-stuff.

Return JSON only with keys: "title" (string), "body" (string, the full article in Markdown with ## / ### headings), "metaTitle" (string), "metaDescription" (string), and "urlSlug" (string).`;
  } else if (contentType === "social") {
    // Social posts get a title/label for the library but no forced headings.
    userPrompt = `Write a ${platform || "social"} post.
Topic: ${topic}
Practice area: ${practiceArea}
Tone: ${tone}
Respect typical character limits; prefer one clear hook and a soft CTA to contact the firm. No hashtags unless appropriate for the platform.

Return JSON only with keys: "title" (string, a short internal label for this post) and "body" (string, the post text).`;
  } else if (contentType === "email") {
    userPrompt = `Write an email campaign draft.
Campaign type: ${campaignType || "Newsletter"}
Topic: ${topic}
Tone: ${tone}

Requirements:
- Provide a subject line.
- Structure the body with short section subheadings so it is scannable, and end with one clear CTA.

Return JSON only with keys: "subject" (string) and "body" (string, plain text or simple HTML allowed as text, with short section headings).`;
  } else {
    return NextResponse.json({ error: "Invalid content_type" }, { status: 400 });
  }

  // Sensitive topics (harassment, retaliation, discrimination, wrongful
  // termination) get a tone override that leads with calm, human language before
  // any legal reference. Prepended so it outranks the default tone/brand voice.
  if (isSensitiveTopic(topic, targetKeywords)) {
    userPrompt = `${SENSITIVE_TONE_OVERRIDE}\n\n${userPrompt}`;
  }

  // Spanish (or any non-English) output directive — applies to every format.
  const langBlock = languageDirective(normalizeLanguage(o.language));
  if (langBlock) {
    userPrompt += `\n\n${langBlock}`;
  }

  // Internal links: for long-form web content, ask the Cluster Map (site_pages)
  // which existing firm pages relate to this topic and hand the generator an
  // approved link plan so the draft links out to related blogs/pages. Mirrors
  // the KM-draft generator. Fails soft when the site inventory is empty.
  if (contentType === "blog") {
    try {
      const plan = await buildLinkPlan({
        primaryKeyword: topic,
        secondaryKeywords: targetKeywords,
      });
      const block = approvedLinkPlanBlock(plan.links);
      if (block) userPrompt += `\n\n---\n${block}`;
    } catch {
      /* no inventory / non-fatal */
    }
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
    // Hard filter: strip em/en dashes the model let through despite the prompt
    // rule, before parsing/persisting. For email the subject/body are extracted
    // from this sanitized text below, so they inherit the fix. Applies to blog
    // and social here too. See lib/sanitize-content.ts.
    const text = stripEmDashes(
      textBlock && textBlock.type === "text" ? textBlock.text : "",
    );

    // Autosave to the drafts library so every generation is recoverable.
    // Every draft gets a non-null title (policy: all content is titled).
    async function autosave(
      format: string,
      body: string,
      title: string,
      metadata: Record<string, unknown> = {},
      seoExtra: Record<string, unknown> = {},
    ) {
      const supabase = getSupabaseServer();
      if (!supabase) return null;
      const tid = await resolveTenantId();
      try {
        const { data } = await supabase
          .from("content_drafts")
          .insert({
            tenant_id: tid,
            format,
            template: templateKey || null,
            topic,
            practice_area: practiceArea,
            title: title || deriveTitle(body, topic),
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
              targetKeywords.length > 0 || seoBrief || Object.keys(seoExtra).length > 0
                ? { targetKeywords, ...(seoBrief ?? {}), ...seoExtra }
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
      // The subject line is the email's title in the drafts library.
      const title = subject || deriveTitle(bodyText, topic);
      const draftId = await autosave("email", bodyText, title, { subject });
      scheduleDraftAnalysis({
        draftId,
        body: bodyText,
        title,
        topic,
        format: "email",
        template: templateKey || null,
        targetKeywords,
      });
      return NextResponse.json({
        draft_id: draftId,
        subject,
        title,
        body: bodyText,
        raw: text,
        template: templateKey || null,
        used_brand_voice: useBrandVoice,
      });
    }

    // Blog (incl. webpage/guide/faq/case_study) and social now return
    // { title, body } JSON — web content also returns SEO metadata. Parse it;
    // fall back to the raw text as the body and a derived title so a non-JSON
    // response still saves cleanly.
    let body = text;
    let title = "";
    let metaTitle = "";
    let metaDescription = "";
    let urlSlug = "";
    try {
      const parsed = extractJSON<{
        title?: string;
        body?: string;
        metaTitle?: string;
        metaDescription?: string;
        urlSlug?: string;
      }>(text);
      if (typeof parsed?.body === "string" && parsed.body.trim()) body = parsed.body;
      if (typeof parsed?.title === "string") title = parsed.title.trim();
      if (typeof parsed?.metaTitle === "string") metaTitle = parsed.metaTitle.trim();
      if (typeof parsed?.metaDescription === "string") {
        metaDescription = parsed.metaDescription.trim();
      }
      if (typeof parsed?.urlSlug === "string") urlSlug = parsed.urlSlug.trim();
    } catch {
      /* non-JSON — keep raw text as body, derive a title below */
    }
    title = title || deriveTitle(body, topic);

    // The Per-Page Brief this generation ran under. Written to metadata.km_brief
    // so the reviewer's SEO metadata bar and Content Info panel read real values
    // instead of "—". Every field is either model-provided or derived here;
    // nothing is left blank on a web draft.
    const kmBrief =
      isWebContent && kmContentType && primaryKeyword
        ? (() => {
            const practiceAreaKey = kmPracticeAreaFor(
              practiceArea,
              `${topic} ${targetKeywords.join(" ")}`,
            );
            const pillarId = inferPillar(
              {
                clusterName: topic,
                primaryKeyword,
                secondaryKeywords: targetKeywords,
              },
              practiceAreaKey,
            );
            const intent: SearchIntent =
              normalizeIntent(originContext?.intent) ??
              CONTENT_TYPE_TO_INTENT[kmContentType];
            return {
              contentType: kmContentType,
              practiceArea: practiceAreaKey,
              primaryKeyword,
              secondaryKeywords: targetKeywords.filter((k) => k !== primaryKeyword),
              searchIntent: kmSearchIntentFor(intent),
              pillarId,
              internalPillarLink:
                getPillarById(pillarId)?.url ?? KM_HUB_LINKS[practiceAreaKey],
              urlSlug: toSlug(urlSlug || title || primaryKeyword),
              metaTitle: metaTitle || title,
              metaDescription: clampMetaDescription(metaDescription || title),
              h1: title,
              // Not confirmed by a human here — the pre-generation duplicate
              // gate ran, but that is not the reviewer's cannibalization sign-off.
              cannibalizationConfirmed: false,
              // Marks the brief as derived by this route rather than built in
              // the wizard, so the reviewer knows the metadata wasn't authored.
              derivedBrief: true,
            };
          })()
        : null;

    const draftFormat = contentType === "social" ? "social" : "blog";
    const draftId = await autosave(
      draftFormat,
      body,
      title,
      kmBrief ? { km_brief: kmBrief } : {},
      kmBrief
        ? {
            primaryKeyword: kmBrief.primaryKeyword,
            searchIntent: kmBrief.searchIntent,
            pillarId: kmBrief.pillarId,
            urlSlug: kmBrief.urlSlug,
            metaTitle: kmBrief.metaTitle,
            metaDescription: kmBrief.metaDescription,
            h1: kmBrief.h1,
            secondaryKeywords: kmBrief.secondaryKeywords,
          }
        : {},
    );
    scheduleDraftAnalysis({
      draftId,
      body,
      title,
      topic,
      format: draftFormat,
      template: templateKey || null,
      targetKeywords,
    });
    return NextResponse.json({
      draft_id: draftId,
      title,
      content: body,
      template: templateKey || null,
      used_brand_voice: useBrandVoice,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Anthropic request failed";
    console.error("[content/draft] failed:", message, e instanceof Error ? e.stack : "");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
