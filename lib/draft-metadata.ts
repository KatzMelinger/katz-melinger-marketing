/**
 * SEO metadata for drafts the Brief Wizard never touched.
 *
 * Diana's D1: "Run metadata generation whenever a keyword and an H1 exist, on
 * generated, imported, and edited drafts alike; surface a blocking prompt when
 * either is missing."
 *
 * The generator itself already existed and worked. It just had exactly one
 * caller — the wizard's "Draft with AI" button — so an imported page or a
 * hand-written draft silently got no meta title, no description, and no slug.
 * Nothing errored and nothing said why; the fields were simply blank forever.
 *
 * WHY IT IS SKIPPED RATHER THAN FAILED
 *
 * Generation needs a primary keyword and an H1. Without them there is nothing
 * to write metadata ABOUT, and inventing a keyword would be worse than leaving
 * the field empty — it would produce a page optimised for a phrase nobody chose.
 * So a missing prerequisite returns a NAMED reason, which the QA gate already
 * surfaces (`metaDescription` and `bodyH1` are both required checks). That is
 * Diana's "blocking prompt": the draft cannot pass QA, and now it can say why.
 */

import { getSupabaseAdmin } from "./supabase-server";
import { extractJSON, getAnthropic, CONTENT_SHORT_FORM_MODEL } from "./anthropic";
import { getTenantConfig } from "./tenant-config";

export type MetadataOutcome =
  | { status: "generated"; metaTitle: string; metaDescription: string }
  | { status: "already_present" }
  | { status: "skipped"; reason: string };

type DraftRow = {
  id: string;
  title: string | null;
  topic: string | null;
  body: string;
  format: string | null;
  practice_area: string | null;
  metadata: Record<string, unknown> | null;
  seo_brief: Record<string, unknown> | null;
};

/** The body's markdown H1 — the title field is not a substitute. */
export function bodyH1(body: string): string {
  return (body ?? "").match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
}

/**
 * The keyword this draft is for, from wherever it was recorded.
 *
 * Drafts arrive from the wizard, the SEO brief, imports and the agent, and each
 * put the keyword somewhere slightly different. Reading all of them is what
 * makes this work on the drafts the wizard never saw.
 */
export function primaryKeyword(d: Pick<DraftRow, "metadata" | "seo_brief" | "topic">): string {
  const meta = (d.metadata ?? {}) as Record<string, unknown>;
  const km = (meta.km_brief ?? {}) as Record<string, unknown>;
  const seo = (d.seo_brief ?? {}) as Record<string, unknown>;
  const candidates = [
    km.primaryKeyword,
    seo.primaryKeyword,
    Array.isArray(seo.targetKeywords) ? seo.targetKeywords[0] : undefined,
    meta.primary_keyword,
    meta.keyword,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

function existingMeta(d: Pick<DraftRow, "metadata" | "seo_brief">): {
  title: string;
  description: string;
} {
  const meta = (d.metadata ?? {}) as Record<string, unknown>;
  const km = (meta.km_brief ?? {}) as Record<string, unknown>;
  const seo = (d.seo_brief ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const src of [km, seo, meta]) {
      for (const k of keys) {
        const v = (src as Record<string, unknown>)[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
    }
    return "";
  };
  return {
    title: pick("metaTitle", "meta_title"),
    description: pick("metaDescription", "meta_description"),
  };
}

/** A URL slug from the H1 — deterministic, no model call needed. */
export function slugFrom(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

async function generate(args: {
  primaryKeyword: string;
  h1: string;
  practiceArea: string;
  contentType: string;
}): Promise<{ metaTitle: string; metaDescription: string } | null> {
  const firmName = (await getTenantConfig()).firmName || "the firm";
  const areaLabel =
    args.practiceArea === "collections" ? "commercial collections" : "employment law";
  const prompt = [
    `You are writing SEO meta tags for a ${areaLabel} ${args.contentType.replace("_", " ")} for the law firm ${firmName}.`,
    `Primary keyword: "${args.primaryKeyword}".`,
    `Page H1: "${args.h1}".`,
    "",
    "Return ONLY a JSON object with two fields:",
    `- "metaTitle": a compelling page title, 50-60 characters, includes the primary keyword, ends with " | ${firmName}" if it fits.`,
    `- "metaDescription": a benefit-driven description, MAXIMUM 155 characters, includes the primary keyword naturally. Never exceed 155 characters.`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const res = await getAnthropic().messages.create({
      model: CONTENT_SHORT_FORM_MODEL,
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content[0]?.type === "text" ? res.content[0].text : "";
    const parsed = extractJSON<{ metaTitle?: string; metaDescription?: string }>(text);
    const metaTitle = (parsed?.metaTitle ?? "").trim();
    const metaDescription = (parsed?.metaDescription ?? "").trim();
    if (!metaTitle || !metaDescription) return null;
    // The 155 limit is a hard SEO constraint, not a preference. Trim at a word
    // boundary rather than shipping a description the search engine truncates.
    const capped =
      metaDescription.length <= 155
        ? metaDescription
        : metaDescription.slice(0, 155).replace(/\s+\S*$/, "");
    return { metaTitle, metaDescription: capped };
  } catch (e) {
    console.warn("[draft-metadata] generation failed:", e);
    return null;
  }
}

/**
 * Ensure this draft has meta title and description, generating them if it does
 * not and has what it needs.
 *
 * Never overwrites metadata that already exists — a human may have written it,
 * and a generator quietly replacing a considered title is worse than no
 * generator at all.
 */
export async function ensureDraftMetadata(
  draftId: string,
  tenantId: string,
): Promise<MetadataOutcome> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("content_drafts")
    .select("id, title, topic, body, format, practice_area, metadata, seo_brief")
    .eq("id", draftId)
    .maybeSingle();
  if (error || !data) return { status: "skipped", reason: "draft not found" };
  const draft = data as DraftRow;

  const current = existingMeta(draft);
  if (current.title && current.description) return { status: "already_present" };

  const keyword = primaryKeyword(draft);
  const h1 = bodyH1(draft.body ?? "");
  // Both prerequisites are named separately so the reviewer is told which one to
  // supply, rather than "metadata could not be generated".
  if (!keyword && !h1) {
    return {
      status: "skipped",
      reason: "No primary keyword and no H1 in the body — add both before metadata can be written.",
    };
  }
  if (!keyword) {
    return { status: "skipped", reason: "No primary keyword set on this draft." };
  }
  if (!h1) {
    return { status: "skipped", reason: "No H1 in the body (a line starting with '# ')." };
  }

  const generated = await generate({
    primaryKeyword: keyword,
    h1,
    practiceArea: (draft.practice_area ?? "employment").toLowerCase(),
    contentType: (draft.format ?? "blog_post").replace(/^km_/, ""),
  });
  if (!generated) return { status: "skipped", reason: "The metadata generator did not return usable output." };

  const meta = (draft.metadata ?? {}) as Record<string, unknown>;
  const km = { ...((meta.km_brief ?? {}) as Record<string, unknown>) };
  // Only fill what is missing. A human-written title survives.
  if (!current.title) km.metaTitle = generated.metaTitle;
  if (!current.description) km.metaDescription = generated.metaDescription;
  if (!km.urlSlug) km.urlSlug = slugFrom(h1);
  if (!km.primaryKeyword) km.primaryKeyword = keyword;

  const { error: writeError } = await sb
    .from("content_drafts")
    .update({
      metadata: { ...meta, km_brief: km, metadata_generated_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
    .eq("id", draftId)
    .eq("tenant_id", tenantId);
  if (writeError) return { status: "skipped", reason: `Could not save: ${writeError.message}` };

  return {
    status: "generated",
    metaTitle: current.title || generated.metaTitle,
    metaDescription: current.description || generated.metaDescription,
  };
}
