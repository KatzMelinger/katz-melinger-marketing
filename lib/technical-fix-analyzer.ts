/**
 * Combines a fresh page snapshot with Claude (via tool-use) to produce
 * concrete, AutoPilot-shaped fix suggestions for a single URL. Each
 * suggestion maps 1:1 to a row that can be inserted into
 * `wp_autopilot_recommendations` and applied by the WP plugin.
 *
 * We only ever suggest fix_types the plugin actually handles today
 * (meta_title, meta_description, canonical, og_title, og_description,
 * schema_jsonld). Risky fix types (h1, internal_link_insert, alt_text) are
 * skipped because the plugin currently logs-and-skips those.
 */

import { getAnthropic, KEYWORD_RESEARCH_MODEL } from "@/lib/anthropic";
import { getFirmContext } from "@/lib/firm-context";
import { snapshotPage, type PageSnapshot } from "@/lib/page-snapshot";

export type FixType =
  | "meta_title"
  | "meta_description"
  | "canonical"
  | "schema_jsonld"
  | "og_title"
  | "og_description";

export type SuggestedFix = {
  fix_type: FixType;
  current_value: string | null;
  suggested_value: string;
  rationale: string;
};

export type FixAnalysis = {
  snapshot: PageSnapshot;
  fixes: SuggestedFix[];
};

const APPLYABLE_FIX_TYPES: FixType[] = [
  "meta_title",
  "meta_description",
  "canonical",
  "schema_jsonld",
  "og_title",
  "og_description",
];

export async function analyzePageForFixes(url: string): Promise<FixAnalysis> {
  const snapshot = await snapshotPage(url);
  const firm = await getFirmContext();

  const system = `You are an on-page SEO auditor for a law firm. Your job is to compare the current on-page SEO of a single URL against best practices and suggest concrete, ready-to-apply fixes that a WordPress plugin will write to the page.

${firm}

Rules:
- Only suggest fixes for fix_types the plugin supports: meta_title (≤65 chars), meta_description (140-160 chars ideal), canonical (full URL), og_title, og_description, schema_jsonld (valid JSON only — ONLY FAQPage, Attorney, or LegalService).
- Do NOT suggest fixes for headings, internal links, alt text, or content body — those aren't supported yet.
- Only emit a fix when it actually improves something. If the current value is already good, don't include it.
- For each fix, write a 1-sentence rationale the marketer will see in the dashboard explaining WHY this is better.
- Keep titles and descriptions on-brand and geo-targeted (NY/NJ) where natural. Don't invent facts.
- For schema_jsonld: this site runs Yoast SEO, which already emits the base @graph (WebPage, Article, Organization, WebSite, BreadcrumbList, author) on every page. NEVER suggest Article/BlogPosting, WebPage, Organization, or BreadcrumbList schema — that would duplicate Yoast and fail validation. Only suggest FAQPage (for pages with Q&A), Attorney (bio pages), or LegalService (firm-level pages) when that type is genuinely missing. Return ONLY valid JSON (an object), no surrounding markdown.`;

  const userParts: string[] = [];
  userParts.push(`URL: ${snapshot.url}`);
  userParts.push(`Status code: ${snapshot.status}`);
  userParts.push(`\nCurrent on-page values:`);
  userParts.push(`- Title: ${snapshot.title ?? "(missing)"}`);
  userParts.push(
    `- Meta description: ${snapshot.metaDescription ?? "(missing)"}`,
  );
  userParts.push(`- Canonical: ${snapshot.canonical ?? "(missing)"}`);
  userParts.push(`- og:title: ${snapshot.ogTitle ?? "(missing)"}`);
  userParts.push(
    `- og:description: ${snapshot.ogDescription ?? "(missing)"}`,
  );
  userParts.push(`- First H1: ${snapshot.h1 ?? "(missing)"}`);
  userParts.push(
    `- JSON-LD blocks present: ${snapshot.jsonLdBlocks.length === 0 ? "none" : `${snapshot.jsonLdBlocks.length} block(s)`}`,
  );
  if (snapshot.detectedIssues.length > 0) {
    userParts.push(`\nDetected surface issues:`);
    for (const issue of snapshot.detectedIssues) {
      userParts.push(`- ${issue}`);
    }
  }
  userParts.push(`\nHead + body excerpt (for context — do not include this in your output):`);
  userParts.push("```html");
  userParts.push(snapshot.htmlExcerpt);
  userParts.push("```");
  userParts.push(
    `\nCall the return_fixes tool with the list of fixes you want to apply. Skip any fix_type where the current value is already good. Maximum 6 fixes.`,
  );

  const resp = await getAnthropic().messages.create({
    model: KEYWORD_RESEARCH_MODEL,
    max_tokens: 4096,
    system,
    tools: [
      {
        name: "return_fixes",
        description:
          "Return concrete on-page SEO fixes ready to be queued for the WordPress AutoPilot plugin.",
        input_schema: {
          type: "object" as const,
          properties: {
            fixes: {
              type: "array",
              description:
                "One entry per fix you want applied. Omit fixes where the current value is already good.",
              items: {
                type: "object",
                properties: {
                  fix_type: {
                    type: "string",
                    enum: APPLYABLE_FIX_TYPES,
                    description: "Which on-page field to change.",
                  },
                  current_value: {
                    type: "string",
                    description:
                      "The exact value present on the page now. Use an empty string if nothing is set.",
                  },
                  suggested_value: {
                    type: "string",
                    description:
                      "The new value to write. For schema_jsonld, valid JSON only (no markdown fences).",
                  },
                  rationale: {
                    type: "string",
                    description:
                      "One sentence the marketer will see explaining why this fix is better.",
                  },
                },
                required: [
                  "fix_type",
                  "current_value",
                  "suggested_value",
                  "rationale",
                ],
              },
            },
          },
          required: ["fixes"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "return_fixes" },
    messages: [{ role: "user", content: userParts.join("\n") }],
  });

  const toolUse = resp.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return { snapshot, fixes: [] };
  }
  const input = toolUse.input as { fixes?: Array<Record<string, unknown>> };
  const fixes: SuggestedFix[] = [];
  for (const raw of input.fixes ?? []) {
    const fix_type = raw.fix_type;
    if (typeof fix_type !== "string") continue;
    if (!APPLYABLE_FIX_TYPES.includes(fix_type as FixType)) continue;
    const suggested_value = raw.suggested_value;
    if (typeof suggested_value !== "string" || !suggested_value.trim()) continue;
    fixes.push({
      fix_type: fix_type as FixType,
      current_value:
        typeof raw.current_value === "string" && raw.current_value.length > 0
          ? raw.current_value
          : null,
      suggested_value,
      rationale:
        typeof raw.rationale === "string" ? raw.rationale : "AI-suggested fix",
    });
  }
  return { snapshot, fixes };
}
