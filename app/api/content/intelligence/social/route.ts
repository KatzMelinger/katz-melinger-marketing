/**
 * POST /api/content/intelligence/social
 *   body: { topic: string, platform: "tiktok" | "instagram" | "linkedin" | "twitter" | "facebook" | "youtube_shorts" }
 *
 * Returns a complete social-media playbook for a topic on a specific platform:
 * hashtag pack (broad + niche), 3 short-form video hooks, 5 caption variants,
 * best posting times, visual treatment ideas, and platform-specific tips.
 *
 * Honest limitation: this draws from Claude's general platform-best-practices
 * knowledge — it does NOT know which specific sounds are trending right now
 * (no public TikTok/IG trending API). For real-time trends, pair this with
 * the TikTok / Discover launcher on /community to spot what's hot.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirmContext } from "@/lib/firm-context";
import { extractJSON, getAnthropic, KEYWORD_RESEARCH_MODEL } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 300;

const VALID_PLATFORMS = [
  "tiktok",
  "instagram",
  "linkedin",
  "twitter",
  "facebook",
  "youtube_shorts",
] as const;
type Platform = (typeof VALID_PLATFORMS)[number];

const PLATFORM_RULES: Record<Platform, string> = {
  tiktok: `TikTok rules:
- Hooks must land in the first 3 seconds.
- Vertical 9:16 video, 15-60 seconds for max reach.
- 3-5 broad hashtags + 5-8 niche/long-tail hashtags. Mix #fyp / #foryou with topic-specific.
- Captions: 1-3 short lines, leave most of the storytelling to the video. End with a question or hook.
- Use trending sounds where possible — generic guidance: rapid edits, on-screen text, point-of-view shots.
- Strong CTA in caption like "comment if this happened to you" or "save this for later".`,
  instagram: `Instagram rules:
- For Reels, same 3-second hook rule as TikTok. Vertical 9:16, 15-60s.
- For carousel posts, slide 1 needs a strong hook image + headline.
- 5-10 hashtags total, mix size: 1-2 mega (#law, #legaltips), 3-4 mid (#employmentlaw, #workplacerights), 3-4 niche (#nycemploymentlawyer, #nywagetheft).
- Captions: punchy first line (the only line shown without "more"), then 2-4 paragraphs.
- Geo-tag NYC for local discovery.`,
  linkedin: `LinkedIn rules:
- First 1-2 lines visible without "see more" — make them count.
- 150-300 words for native posts. Carousel/PDF for long-form.
- 3-5 hashtags max. Use #EmploymentLaw / #LaborLaw / #NYCLaw / #NewYorkLaw / #WorkplaceRights.
- Ask a question at the end to drive comments. LinkedIn ranks engagement-bait better than likes.
- Tone: professional, first-person from an attorney. Cite a recent ruling or law if possible.`,
  twitter: `X / Twitter rules:
- Threads outperform single tweets. Tweet 1 is the hook (under 240 chars to leave room for reactions).
- 1-2 hashtags max. Avoid #FYP-style spam.
- Short, declarative sentences. Use line breaks.
- End with a CTA: "follow for more" or "save this thread".`,
  facebook: `Facebook rules:
- Long-form OK (300-600 words). Personal storytelling crushes statistics here.
- 1-3 hashtags only.
- Photo or carousel beats text-only. Open with a question.
- Geographic targeting matters — mention specific NYC neighborhoods or NJ towns.`,
  youtube_shorts: `YouTube Shorts rules:
- Vertical 9:16, under 60 seconds.
- Hook in 1.5 seconds. Show the payoff up front then explain.
- Title is the most important thing — under 60 chars, packed with intent keywords.
- 3-5 hashtags in description, including #shorts.
- End screen: "subscribe for more employment-law breakdowns".`,
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const topic = (body?.topic as string | undefined)?.trim();
  const platform = body?.platform as Platform | undefined;

  if (!topic) return NextResponse.json({ error: "topic required" }, { status: 400 });
  if (!platform || !VALID_PLATFORMS.includes(platform)) {
    return NextResponse.json(
      { error: `platform must be one of: ${VALID_PLATFORMS.join(", ")}` },
      { status: 400 },
    );
  }

  const firm = await getFirmContext();

  const system = `You are a social media strategist for a NY/NJ plaintiff-side employment law firm. ${firm}

You produce platform-specific playbooks: hashtag packs, video hooks, captions, posting times, and visual ideas — all on-brand for the firm. Don't invent specific trending sounds or songs (you don't have real-time data); give style guidance instead (e.g. "trending audio with rapid edits").

${PLATFORM_RULES[platform]}`;

  const user = `Topic: "${topic}"
Platform: ${platform}

Generate a complete social media playbook. Return JSON only:

{
  "hashtags": {
    "broad": ["3-5 high-volume general hashtags"],
    "niche": ["5-8 topic-specific or geo-targeted hashtags"]
  },
  "hooks": [
    "3 short-form video hooks (15-60s scripts). Each is 1-3 sentences max, optimized for platform's first 3 seconds. Format: 'HOOK: [opening line] | PAYOFF: [what comes after]'."
  ],
  "captions": [
    "5 caption variants of different lengths and tones (urgent, educational, story-driven, list-style, question-led)"
  ],
  "best_times": "1-2 sentence recommendation on best days/hours to post on this platform for the firm's audience (workers in NY/NJ).",
  "visual_ideas": [
    "3-5 specific visual treatment ideas: composition, on-screen text, b-roll, props, location"
  ],
  "platform_tips": [
    "3-5 platform-specific dos and don'ts that apply to this topic"
  ]
}`;

  try {
    const resp = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
    const playbook = extractJSON(text);
    return NextResponse.json({ playbook, platform, topic });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to generate playbook";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
