/**
 * POST /api/content-production/update-draft
 *   body: { url, title?, pillarId?, practiceArea?, intent?, keywords?: string[] }
 *
 * Repurpose flow: take an already-published page, fetch what's live today, and
 * generate an UPDATED draft to the firm's guidelines — rewritten in brand
 * voice, with the matched "missing keyword" opportunities worked in and
 * internal links to related cluster-map pages added. The result is saved as a
 * content_draft and surfaced on the Production Board (a content_pipeline row at
 * "draft") so it flows through the existing review / QA / publish drawer.
 *
 * WordPress write-back stays Phase 4 — this produces the reviewed draft; the
 * drawer's "Approve → Publish" still advances editorial status only.
 */

import { NextResponse } from "next/server";

import {
  cachedSystemPrompt,
  CONTENT_LONG_FORM_MODEL,
  getAnthropic,
} from "@/lib/anthropic";
import { guardUser } from "@/lib/supabase-route";
import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";
import { getTenantConfig } from "@/lib/tenant-config";
import { getFirmContext } from "@/lib/firm-context";
import { buildSkillsContext } from "@/lib/content-skills";
import { scheduleDraftAnalysis } from "@/lib/auto-analyze";
import { fetchPageText } from "@/lib/page-optimizer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const url = str(body.url);
  if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });

  const title = str(body.title);
  const pillarId = str(body.pillarId);
  const practiceArea = str(body.practiceArea); // "employment" | "collections"
  const intent = str(body.intent); // "commercial" | "informational"
  const keywords = Array.isArray(body.keywords)
    ? (body.keywords as unknown[]).filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    : [];

  const tenantId = await resolveTenantId();
  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  // 1. What's live today — the thing we're updating, not replacing blind.
  let pageText: string;
  try {
    pageText = await fetchPageText(url);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not fetch the page." },
      { status: 422 },
    );
  }

  // 2. Allowed internal links — confirmed live pages in the same pillar. The
  //    generator may use ONLY these, so it can't invent internal URLs.
  let linkCandidates: { url: string; anchor: string }[] = [];
  if (pillarId) {
    const { data: related } = await supabase
      .from("site_pages")
      .select("url, title, h1")
      .eq("tenant_id", tenantId)
      .eq("pillar", pillarId)
      .neq("url", url)
      .limit(8);
    linkCandidates = ((related ?? []) as { url: string; title: string | null; h1: string | null }[]).map(
      (r) => ({ url: r.url, anchor: (r.title || r.h1 || r.url).slice(0, 80) }),
    );
  }

  // 3. Known firm information — same brand voice the analyzer scores against,
  //    plus the firm's trained content directions.
  const [firmContext, skillsContext] = await Promise.all([
    getFirmContext(tenantId).catch(() => ""),
    buildSkillsContext(
      { practiceArea: practiceArea === "collections" ? "Collections" : "Employment" },
      tenantId,
    ).catch(() => ""),
  ]);

  const linkBlock =
    linkCandidates.length > 0
      ? `\n\nAPPROVED INTERNAL LINKS — you may add ONLY these (confirmed live pages). Use natural anchor text and place each where it fits. Do NOT invent any other internal link:\n` +
        linkCandidates.map((l) => `- ${l.anchor} → ${l.url}`).join("\n")
      : "";

  const keywordBlock =
    keywords.length > 0
      ? `\n\nTARGET KEYWORDS TO WORK IN — these are opportunities this page is missing. Weave them in naturally (in headings and body where they fit), no stuffing:\n${keywords.map((k) => `- ${k}`).join("\n")}`
      : "";

  const knownInfo = [
    firmContext &&
      `FIRM CONTEXT — write in this firm's voice and to these audiences; use contact details verbatim. This is the same brand-voice guide the draft is scored against:\n${firmContext}`,
    skillsContext,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  const userPrompt =
    `${knownInfo ? knownInfo + "\n\n===\n\n" : ""}` +
    `You are UPDATING an already-published page — not writing a new one from scratch. ` +
    `Preserve what is accurate and on-topic; improve the voice, structure, and SEO, and ` +
    `bring it fully in line with the firm's guidelines.\n\n` +
    `CURRENT PUBLISHED PAGE\n` +
    `URL: ${url}\n` +
    (title ? `Title: ${title}\n` : "") +
    `--- current content (extracted from the live page) ---\n${pageText}\n--- end current content ---\n\n` +
    `UPDATE INSTRUCTIONS\n` +
    `- Rewrite in the firm's brand voice and speak to its audiences (see FIRM CONTEXT above).\n` +
    `- Keep every factual, legal, and numeric statement accurate. Do NOT invent statutes, deadlines, figures, or case results — if the live page doesn't support a claim, leave it out.\n` +
    `- Improve readability: short sentences, plain English, scannable H2/H3 headings, and a clear next-step CTA. Add an FAQ section if it fits the topic.\n` +
    keywordBlock +
    linkBlock +
    `\n\nOutput: the full updated page in Markdown only. Start with the H1.`;

  const tenantConfig = await getTenantConfig(tenantId);

  let updatedBody = "";
  try {
    const msg = await getAnthropic().messages.create({
      model: CONTENT_LONG_FORM_MODEL,
      max_tokens: 8192,
      system: cachedSystemPrompt(tenantConfig.systemPrompt),
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = msg.content.find((b) => b.type === "text");
    updatedBody = block && block.type === "text" ? block.text : "";
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Generation failed" },
      { status: 500 },
    );
  }

  if (!updatedBody.trim()) {
    return NextResponse.json({ error: "The model returned an empty draft." }, { status: 502 });
  }

  // 4. Save the draft.
  const draftTitle = title || url;
  const { data: draftRow, error: draftErr } = await supabase
    .from("content_drafts")
    .insert({
      tenant_id: tenantId,
      format: "km_page_update",
      template: "km_page_update",
      topic: draftTitle,
      practice_area: practiceArea === "collections" ? "Commercial Collections" : "Employment Law",
      title: draftTitle,
      body: updatedBody,
      metadata: {
        origin_source: "page_update",
        source_url: url,
        update_keywords: keywords,
        pillar_id: pillarId || null,
        km_brief: {
          primaryKeyword: title || url,
          secondaryKeywords: keywords,
          pillarId: pillarId || null,
          internalPillarLink: linkCandidates[0]?.url ?? null,
          internalLinks: linkCandidates.map((l) => ({ url: l.url, anchor: l.anchor, section: "Body" })),
        },
      },
      seo_brief: {
        primaryKeyword: title || url,
        secondaryKeywords: keywords,
        pillarId: pillarId || null,
        targetKeywords: keywords,
      },
    })
    .select("id")
    .single();

  if (draftErr || !draftRow) {
    return NextResponse.json(
      { error: draftErr?.message ?? "Could not save the draft." },
      { status: 500 },
    );
  }
  const draftId = draftRow.id as string;

  // 5. Surface on the Production Board — reuse the row for this URL if one
  //    already exists, otherwise create one at "draft".
  const bucket = intent === "commercial" ? "money_page" : "bofu_education";
  const { data: existing } = await supabase
    .from("content_pipeline")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("url", url)
    .limit(1)
    .maybeSingle();

  let pipelineId: number | null = null;
  if (existing) {
    pipelineId = (existing as { id: number }).id;
    await supabase
      .from("content_pipeline")
      .update({ draft_id: draftId, status: "draft", title: draftTitle })
      .eq("id", pipelineId);
  } else {
    const { data: created } = await supabase
      .from("content_pipeline")
      .insert({
        tenant_id: tenantId,
        title: draftTitle,
        keywords: keywords.join(", ") || null,
        status: "draft",
        bucket,
        content_type: "website",
        url,
        draft_id: draftId,
      })
      .select("id")
      .single();
    pipelineId = (created?.id as number | undefined) ?? null;
  }

  // 6. Score it like any other draft.
  scheduleDraftAnalysis({
    draftId,
    body: updatedBody,
    title: draftTitle,
    topic: draftTitle,
    format: "km_page_update",
    template: "km_page_update",
    targetKeywords: keywords,
  });

  return NextResponse.json({
    draft_id: draftId,
    pipeline_id: pipelineId,
    status: "draft",
    title: draftTitle,
    url,
  });
}
