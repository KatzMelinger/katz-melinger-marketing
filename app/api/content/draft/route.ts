import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

import { getSupabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

async function loadBrandVoice(): Promise<string> {
  const sb = getSupabaseServer();
  if (!sb) return "";
  const { data } = await sb
    .from("brand_voice")
    .select("context")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const c = data as { context?: string | null } | null;
  return typeof c?.context === "string" ? c.context.trim() : "";
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
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

  if (!topic) {
    return NextResponse.json({ error: "topic required" }, { status: 400 });
  }

  const brandVoice = await loadBrandVoice();

  const lengthGuide =
    length === "short"
      ? "About 500 words for blog; keep social under platform limits."
      : length === "long"
        ? "About 2000 words for blog."
        : "About 1000 words for blog.";

  const system = `You are a marketing copywriter for Katz Melinger PLLC, a plaintiff-side employment law firm in New York City. The firm represents workers in wage & hour, discrimination, class actions, judgment enforcement, severance, and related matters. Voice: professional but approachable, focused on helping workers understand their rights—never corporate or cold.

${brandVoice ? `Brand voice notes from the firm:\n${brandVoice}\n` : ""}

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
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: contentType === "blog" && length === "long" ? 8192 : 4096,
      system,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = msg.content.find((b) => b.type === "text");
    const text =
      textBlock && textBlock.type === "text" ? textBlock.text : "";

    if (contentType === "email") {
      try {
        const parsed = JSON.parse(text) as { subject?: string; body?: string };
        return NextResponse.json({
          subject: parsed.subject ?? "",
          body: parsed.body ?? text,
          raw: text,
        });
      } catch {
        return NextResponse.json({ subject: "", body: text, raw: text });
      }
    }

    return NextResponse.json({ content: text });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Anthropic request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
