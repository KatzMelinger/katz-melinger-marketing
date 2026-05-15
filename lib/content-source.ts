/**
 * Source-material ingestion + AI review.
 *
 * Accepts:
 *   - raw text (paste a draft, an email, etc.)
 *   - URL (fetch + strip HTML to plain text)
 *   - file (.pdf, .docx, .txt, .md, .rtf, .html — see lib/document-extract.ts)
 *
 * Produces a `content_sources` row with:
 *   - the extracted plain text
 *   - a `review_summary` JSON: strengths, weaknesses, target audience guesses,
 *     and concrete suggestions to improve. The user can then point the
 *     multi-format generator at this source to repurpose it.
 */

import { getSupabaseAdmin } from "./supabase-server";
import { extractJSON, getAnthropic, KEYWORD_RESEARCH_MODEL } from "./anthropic";
import { extractText } from "./document-extract";

const USER_AGENT = "KMDashboard-ContentImporter/1.0";

export type SourceReview = {
  strengths: string[];
  weaknesses: string[];
  audience: string;
  primary_message: string;
  suggestions: string[];
  repurpose_ideas: { format: string; angle: string }[];
};

export type IngestedSource = {
  id: string;
  source_type: "text" | "url" | "file";
  filename: string | null;
  url: string | null;
  word_count: number;
  content_excerpt: string;
  review_summary: SourceReview | null;
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchUrlText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal: AbortSignal.timeout(20_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const html = await res.text();
  return stripHtml(html);
}

async function reviewSource(text: string): Promise<SourceReview | null> {
  const truncated = text.slice(0, 10_000);
  const system = `You are a marketing strategist reviewing a piece of source material a marketer might want to repurpose. Be concise and actionable — no fluff.`;
  const user = `Source material:
"""
${truncated}
"""

Return JSON only:
{
  "strengths": ["3-5 specific things this content does well"],
  "weaknesses": ["3-5 specific gaps or weaknesses"],
  "audience": "One sentence: who is this written for?",
  "primary_message": "One sentence: what's the core point?",
  "suggestions": ["3-5 concrete edits to improve the original"],
  "repurpose_ideas": [
    { "format": "blog | linkedin | twitter | facebook | instagram | email | podcast", "angle": "specific angle for that format" }
  ]
}`;

  try {
    const resp = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: user }],
    });
    const txt = resp.content[0]?.type === "text" ? resp.content[0].text : "";
    return extractJSON<SourceReview>(txt);
  } catch {
    return null;
  }
}

export async function ingestSource(args: {
  source_type: "text" | "url" | "file";
  text?: string;
  url?: string;
  filename?: string;
  fileBuffer?: Buffer;
  notes?: string;
}): Promise<IngestedSource> {
  let content = "";
  let filename: string | null = null;
  let url: string | null = null;

  if (args.source_type === "text") {
    content = (args.text ?? "").trim();
  } else if (args.source_type === "url") {
    if (!args.url) throw new Error("url required");
    url = args.url;
    content = await fetchUrlText(args.url);
  } else if (args.source_type === "file") {
    if (!args.fileBuffer) throw new Error("file buffer required");
    filename = args.filename ?? "uploaded";
    const extracted = await extractText({
      filename,
      buffer: args.fileBuffer,
    });
    content = extracted.text;
  }

  content = content.replace(/\s+/g, " ").trim();
  if (!content) throw new Error("Could not extract any text from the source.");

  const review = await reviewSource(content);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("content_sources")
    .insert({
      source_type: args.source_type,
      filename,
      url,
      content,
      word_count: content.split(/\s+/).filter(Boolean).length,
      notes: args.notes ?? null,
      review_summary: review,
    })
    .select("id, source_type, filename, url, word_count, content, review_summary")
    .single();
  if (error) throw new Error(`Failed to save source: ${error.message}`);

  return {
    id: data.id,
    source_type: data.source_type,
    filename: data.filename,
    url: data.url,
    word_count: data.word_count,
    content_excerpt: (data.content as string).slice(0, 600),
    review_summary: data.review_summary as SourceReview | null,
  };
}
