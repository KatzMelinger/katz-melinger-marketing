/**
 * POST /api/seo/backlinks/strategy
 *
 * Crawls the firm's outbound link profile, pulls existing Semrush
 * competitor data, and generates a Claude-powered link-building plan:
 * specific outreach categories, target organizations, email templates,
 * reciprocal link ideas, content-for-links suggestions, and a 3-month
 * action plan.
 */

import { NextResponse } from "next/server";
import { analyzeOutboundLinkProfile } from "@/lib/backlink-strategy";
import {
  extractJSON,
  getAnthropic,
  KEYWORD_RESEARCH_MODEL,
} from "@/lib/anthropic";
import { guardUser } from "@/lib/supabase-route";
import { getTenantConfig } from "@/lib/tenant-config";

export const runtime = "nodejs";
export const maxDuration = 300;

const PRACTICE_AREAS = [
  "Employment Discrimination",
  "FMLA",
  "Wage & Hour Claims",
  "Wrongful Termination",
  "Sexual Harassment at Work",
  "Severance Negotiations",
  "Commercial Collections",
  "Judgment Enforcement",
];

export async function POST() {
  const denied = await guardUser();
  if (denied) return denied;
  try {
    const cfg = await getTenantConfig();
    const profile = await analyzeOutboundLinkProfile();

    const existingOutbound = profile.externalLinksOut
      .slice(0, 30)
      .map(
        (l) => `- ${l.url} (anchor: "${l.anchorText.slice(0, 80)}", from: ${l.sourcePage})`,
      )
      .join("\n");

    const system = `You are an expert SEO link-building strategist for law firms. You're analyzing ${cfg.seoDomain} — a law firm whose practice areas include ${PRACTICE_AREAS.join(", ")}.

Provide actionable, specific backlink strategies. Name real organizations and publications when you can; avoid generic advice like "guest post on relevant blogs."`;

    const user = `Analyze the firm's outbound link profile and suggest specific link-building opportunities.

CURRENT SITE DATA:
- Pages scanned: ${profile.sitePages.length}
- Outbound external links found: ${profile.externalLinksOut.length}
- Total internal links: ${profile.internalLinkCount}
- Total external links: ${profile.externalLinkCount}

EXISTING OUTBOUND LINKS (where ${cfg.seoDomain} currently links to):
${existingOutbound || "(none found)"}

Return JSON only:

{
  "overallAssessment": "1-2 sentence read on the firm's current outbound + inbound link posture",
  "currentStrengths": ["3-5 things working in the firm's favor"],
  "currentWeaknesses": ["3-5 specific gaps or red flags"],
  "backlinkOpportunities": [
    {
      "category": "e.g. Legal Directories, NY/NJ Bar Resources, Industry Publications, Local News, Worker Advocacy Orgs, Guest Posting on HR Blogs",
      "priority": "high|medium|low",
      "description": "What this category is and why it matters for an employment firm",
      "specificTargets": ["Real organizations / publications / sites — be specific"],
      "outreachTemplate": "1-2 sentence outreach approach or email opener",
      "expectedImpact": "Concrete benefit if landed",
      "difficulty": "easy|moderate|hard"
    }
  ],
  "reciprocalLinkIdeas": [
    {
      "existingOutboundLink": "URL the firm already links to",
      "suggestion": "How to turn this into a reciprocal or stronger relationship"
    }
  ],
  "contentForLinks": [
    {
      "contentIdea": "Concrete piece of content the firm could publish that would naturally attract backlinks",
      "targetKeywords": ["primary keywords"],
      "linkableFormat": "guide | tool | study | infographic | data report | calculator",
      "potentialLinkers": ["types of sites that would link to this kind of content"]
    }
  ],
  "quickWins": ["5-7 specific, low-effort actions for this week"],
  "monthlyPlan": {
    "month1": "Theme + 3-4 specific actions",
    "month2": "Theme + 3-4 specific actions",
    "month3": "Theme + 3-4 specific actions"
  }
}`;

    const resp = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
    const strategy = extractJSON(text);

    return NextResponse.json({ profile, strategy });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Strategy generation failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
