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

/**
 * Attorney-advertising terms that are barred outright, checked deterministically.
 *
 * lib/compliance-core.ts already states these rules — RPC 7.4 forbids "expert"
 * and "specialist" absent certification, and records that Katz Melinger holds
 * none — but it states them as PROSE IN A MODEL PROMPT. A model asked for
 * "compelling" marketing copy reaches for "Expert" every time, and nothing
 * downstream was checking meta descriptions against those rules at all.
 *
 * That is exactly what happened: the first backfill produced eight descriptions
 * led by "Expert", each a per-se RPC 7.4 violation on a page meant to rank.
 *
 * So the prompt asks, and this list enforces. A prompt is a request; a regex is
 * a rule. For a constraint the firm can be disciplined over, the rule wins.
 */
const BARRED_AD_TERMS: { re: RegExp; why: string }[] = [
  { re: /\b(expert|experts|expertise)\b/i, why: "RPC 7.4 — 'expert' requires certification the firm does not hold" },
  { re: /\b(specialist|specialists|specializ(?:e|es|ing))\b/i, why: "RPC 7.4 — 'specialist' requires certification the firm does not hold" },
  { re: /\b(best|top|#\s*1|number one|premier|leading|unmatched|unrivall?ed|most experienced)\b/i, why: "RPC 7.1(a) — unsubstantiable comparative claim" },
  { re: /\b(guarantee[ds]?|guaranteeing|we win|will win|no risk|risk[-\s]free)\b/i, why: "RPC 7.1 — prediction or guarantee of result" },
];

/** Which barred terms appear in this copy, with the rule each one breaks. */
export function barredAdTerms(text: string): { term: string; why: string }[] {
  const out: { term: string; why: string }[] = [];
  for (const t of BARRED_AD_TERMS) {
    const m = text.match(t.re);
    if (m) out.push({ term: m[0], why: t.why });
  }
  return out;
}

async function generate(args: {
  primaryKeyword: string;
  h1: string;
  practiceArea: string;
  contentType: string;
  /** Violations from a previous attempt, quoted back so the retry is informed. */
  priorViolations?: { term: string; why: string }[];
}): Promise<{ metaTitle: string; metaDescription: string } | null> {
  const firmName = (await getTenantConfig()).firmName || "the firm";
  const areaLabel =
    args.practiceArea === "collections" ? "commercial collections" : "employment law";
  const retryNote = args.priorViolations?.length
    ? `
Your previous attempt used ${args.priorViolations
        .map((v) => `"${v.term}" (${v.why})`)
        .join(" and ")}. Rewrite without those words.`
    : "";
  const prompt = [
    `You are writing SEO meta tags for a ${areaLabel} ${args.contentType.replace("_", " ")} for the law firm ${firmName}.`,
    `Primary keyword: "${args.primaryKeyword}".`,
    `Page H1: "${args.h1}".`,
    "",
    "Return ONLY a JSON object with two fields:",
    `- "metaTitle": a compelling page title, 50-60 characters, includes the primary keyword, ends with " | ${firmName}" if it fits.`,
    `- "metaDescription": a benefit-driven description, MAXIMUM 155 characters, includes the primary keyword naturally. Never exceed 155 characters.`,
    "",
    "ATTORNEY ADVERTISING RULES — these are not style preferences, they are NY/NJ",
    "Rules of Professional Conduct and this copy is regulated speech:",
    `- NEVER use "expert", "expertise", "specialist" or "specializing". RPC 7.4 permits them only with a certification ${firmName} does not hold. Write "experienced" or name the practice area instead.`,
    '- NEVER use superlatives or comparative claims ("best", "top", "#1", "leading", "premier"). RPC 7.1(a) bars claims that cannot be factually substantiated.',
    '- NEVER predict or guarantee an outcome ("we win", "risk-free", "guaranteed").',
    "- Do not state or imply how the firm charges. You may say an initial consultation is free; say nothing else about fees.",
    retryNote,
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

  const base = {
    primaryKeyword: keyword,
    h1,
    practiceArea: (draft.practice_area ?? "employment").toLowerCase(),
    contentType: (draft.format ?? "blog_post").replace(/^km_/, ""),
  };
  // Generate, check against the advertising rules, and retry ONCE naming the
  // violation. If the second attempt still breaks a rule, write nothing: an
  // empty meta description is a task on someone's list, while a compliant-
  // looking one that says "expert" is a regulatory exposure nobody is looking at.
  let generated = await generate(base);
  if (generated) {
    const violations = barredAdTerms(`${generated.metaTitle} ${generated.metaDescription}`);
    if (violations.length) {
      console.warn(
        `[draft-metadata] ${draftId}: retrying, barred term(s) ${violations.map((v) => v.term).join(", ")}`,
      );
      const retry = await generate({ ...base, priorViolations: violations });
      const stillBad = retry ? barredAdTerms(`${retry.metaTitle} ${retry.metaDescription}`) : violations;
      if (retry && stillBad.length === 0) {
        generated = retry;
      } else {
        return {
          status: "skipped",
          reason: `Generated copy broke an attorney-advertising rule twice: ${stillBad
            .map((v) => `"${v.term}" — ${v.why}`)
            .join("; ")}. Write this one by hand.`,
        };
      }
    }
  }
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
