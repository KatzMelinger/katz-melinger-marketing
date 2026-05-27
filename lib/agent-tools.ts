/**
 * Tool definitions and dispatch for the KM Agent.
 *
 * Each tool wraps an existing capability (a Next API route, a lib function,
 * or a direct Supabase read) and exposes it to Claude via the Anthropic
 * Messages API's `tools` parameter. The agent route iterates: ask Claude →
 * run any tool calls → feed results back → ask again, until end_turn.
 *
 * Adding a tool here makes it available to the agent automatically.
 */

import { getSupabaseAdmin } from "./supabase-server";

/** Shape Anthropic SDK expects for a tool. */
export type ToolDef = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

/** Build a fully-qualified URL for an internal Next route. */
function internalUrl(req: { url: string }, path: string): string {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}${path}`;
}

async function postInternal(
  req: { url: string },
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(internalUrl(req, path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { error: (json as { error?: string }).error ?? `HTTP ${res.status}` };
  }
  return json;
}

// ============================================================================
// Tool definitions (the schema Claude sees)
// ============================================================================

export const TOOLS: ToolDef[] = [
  {
    name: "find_trending_topics",
    description:
      "Find current trending topics in NY/NJ employment law that the firm could write about. Returns each topic with urgency (hot/warm/evergreen), suggested angle, and platforms. Respects a recency window so 2024 events don't get surfaced as current.",
    input_schema: {
      type: "object",
      properties: {
        practiceArea: {
          type: "string",
          description:
            "Practice area to focus on, or 'All'. One of: All, Employment Discrimination, FMLA, Wage & Hour Claims, Wrongful Termination, Sexual Harassment at Work, Severance Negotiations, Commercial Collections, Judgment Enforcement.",
        },
        monthsBack: {
          type: "number",
          description:
            "Recency window in months (default 6). Use 3 for the freshest news, 12 to cast a wider net.",
        },
      },
    },
  },
  {
    name: "find_topic_ideas",
    description:
      "Suggest article topic ideas for the firm's blog and content marketing. Each idea includes a headline, summary, practice area, content type, and 'why now' relevance note.",
    input_schema: {
      type: "object",
      properties: {
        practiceArea: { type: "string", description: "Practice area or 'All'." },
        count: { type: "number", description: "How many ideas (3–15, default 6)." },
      },
    },
  },
  {
    name: "generate_social_playbook",
    description:
      "Generate a per-platform social playbook for one topic. Returns hashtag pack, video hooks, caption variants, best times, and visual ideas, all in the firm's Brand Voice.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "The topic or story angle." },
        platform: {
          type: "string",
          description:
            "One of: tiktok, instagram, linkedin, twitter, facebook, youtube_shorts.",
        },
      },
      required: ["topic", "platform"],
    },
  },
  {
    name: "list_active_recommendations",
    description:
      "List the marketer's active strategy recommendations (the ones not done / on hold / disregarded). Useful when the user asks what to work on next.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description:
            "Optional filter: seo, aeo, content, technical, local, or social.",
        },
        limit: {
          type: "number",
          description: "Max items to return (1-50, default 10).",
        },
      },
    },
  },
  {
    name: "list_tracked_keywords",
    description:
      "List the keywords currently being tracked for rank in Semrush. Returns each keyword with practice area, current rank, previous rank, search volume, and difficulty.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max keywords to return (1-100, default 25).",
        },
      },
    },
  },
  {
    name: "refresh_tracked_keywords",
    description:
      "Refresh rank data for all tracked keywords by hitting Semrush. Moves current_rank into previous_rank and writes the latest rank, search volume, and difficulty. Use this when the user asks about rank drops/wins and last_checked_at is stale (more than ~24 hours old) or current_rank is null on keywords you'd expect to rank. Returns the refreshed list.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_autopilot_queue",
    description:
      "List on-page SEO fixes currently in the AutoPilot queue for katzmelinger.com — pending fixes awaiting approval, approved fixes waiting for the WP plugin to apply, or recently applied fixes.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description:
            "One of: pending, approved, applied, rejected, reverted. Default 'pending'.",
        },
        limit: {
          type: "number",
          description: "Max items (1-50, default 20).",
        },
      },
    },
  },
];

// ============================================================================
// Dispatch — given a tool_use block from Claude, run the actual work
// ============================================================================

export async function dispatchTool(
  toolName: string,
  input: Record<string, unknown>,
  req: { url: string },
): Promise<unknown> {
  switch (toolName) {
    case "find_trending_topics":
      return await postInternal(req, "/api/content/intelligence/trends", {
        practiceArea: input.practiceArea ?? "All",
        monthsBack: input.monthsBack ?? 6,
      });

    case "find_topic_ideas":
      return await postInternal(req, "/api/content/intelligence/topics", {
        practiceArea: input.practiceArea ?? "All",
        count: input.count ?? 6,
      });

    case "generate_social_playbook":
      return await postInternal(req, "/api/content/intelligence/social", {
        topic: input.topic,
        platform: input.platform,
      });

    case "list_active_recommendations": {
      const sb = getSupabaseAdmin();
      let q = sb
        .from("recommendation_items")
        .select("id, title, rationale, category, effort, impact, status, created_at")
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(typeof input.limit === "number" ? Math.min(input.limit, 50) : 10);
      if (typeof input.category === "string" && input.category) {
        q = q.eq("category", input.category);
      }
      const { data, error } = await q;
      if (error) return { error: error.message };
      return { items: data ?? [], count: data?.length ?? 0 };
    }

    case "list_tracked_keywords": {
      const sb = getSupabaseAdmin();
      const limit =
        typeof input.limit === "number" ? Math.min(input.limit, 100) : 25;
      const { data, error } = await sb
        .from("seo_keywords")
        .select(
          "id, keyword, practice_area, current_rank, previous_rank, search_volume, difficulty, url, last_checked_at",
        )
        .order("current_rank", { ascending: true, nullsFirst: false })
        .limit(limit);
      if (error) return { error: error.message };
      return { keywords: data ?? [], count: data?.length ?? 0 };
    }

    case "refresh_tracked_keywords": {
      // The route doesn't read its body; an empty POST is fine.
      const res = await fetch(internalUrl(req, "/api/seo/tracked-keywords/refresh"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          error:
            (json as { error?: string }).error ?? `HTTP ${res.status}`,
        };
      }
      // Trim payload — agent only needs the summary + the refreshed keywords.
      const j = json as {
        updated?: number;
        keywords?: Array<{
          keyword?: string;
          current_rank?: number | null;
          previous_rank?: number | null;
          search_volume?: number | null;
          difficulty?: number | null;
          last_checked_at?: string | null;
        }>;
      };
      return {
        updated: j.updated ?? 0,
        keywords: (j.keywords ?? []).map((k) => ({
          keyword: k.keyword,
          current_rank: k.current_rank ?? null,
          previous_rank: k.previous_rank ?? null,
          delta:
            typeof k.current_rank === "number" &&
            typeof k.previous_rank === "number"
              ? k.previous_rank - k.current_rank
              : null,
          search_volume: k.search_volume ?? null,
          difficulty: k.difficulty ?? null,
          last_checked_at: k.last_checked_at ?? null,
        })),
      };
    }

    case "list_autopilot_queue": {
      const sb = getSupabaseAdmin();
      const status =
        typeof input.status === "string" ? input.status : "pending";
      const limit =
        typeof input.limit === "number" ? Math.min(input.limit, 50) : 20;
      const { data, error } = await sb
        .from("wp_autopilot_recommendations")
        .select(
          "id, page_url, fix_type, current_value, suggested_value, rationale, status, applied_at, created_at",
        )
        .eq("status", status)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return { error: error.message };
      return { items: data ?? [], count: data?.length ?? 0 };
    }

    default:
      return { error: `unknown tool: ${toolName}` };
  }
}
