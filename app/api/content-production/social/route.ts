/**
 * POST /api/content-production/social
 *
 * The Repurpose tab's "Generate 3 posts → Scheduler" action. Reuses the existing
 * building blocks (no rebuild):
 *   1. generateMultiFormat() → 3 brand-voice social posts (LinkedIn/Facebook/Instagram),
 *      saved to content_drafts.
 *   2. postToAyrshare() → schedules them Mon/Wed/Fri of next week, recording each
 *      in social_posts. Posts arrive as SCHEDULED (reviewable in the scheduler),
 *      not instantly public.
 *
 * Distribution (Diana's spec):
 *   - Mon: Facebook + Instagram + LinkedIn (educational)
 *   - Wed: LinkedIn (professional)
 *   - Fri: Google My Business (local)
 *
 * Degrades gracefully: if no Ayrshare API key is configured, the 3 posts are
 * still generated + saved as drafts and we return scheduled:false with a note.
 *
 * No UI currently calls this route — it predates the repurpose-review-drawer →
 * /api/content-production/repurpose/schedule flow, which is the maintained path
 * (S3 compliance gate + legal-accuracy layer). Kept for the one-shot "3 posts,
 * auto-scheduled" use case, but it's WHY it needs the same gate applied here:
 * without it, this path would post straight to Ayrshare with no compliance or
 * legal check at all the moment Ayrshare is connected.
 */

import { NextResponse } from "next/server";
import { guardUser } from "@/lib/supabase-route";
import { getTenantDb } from "@/lib/tenant-db";
import { getTenantConfig } from "@/lib/tenant-config";
import { getAyrshareApiKey, postToAyrshare, type AyrsharePlatform } from "@/lib/ayrshare";
import { generateSocialPosts } from "@/lib/content-social";
import type { SocialFormatKey } from "@/lib/social-format-rules";
import { checkSocialCompliance } from "@/lib/social-compliance";
import { getOperatingBrief } from "@/lib/social-operating-brief";
import { runLegalCheck } from "@/lib/legal-verify";
import { syncFindings } from "@/lib/content-findings-store";
import { legalAccuracyEnabled } from "@/lib/feature-flags";

export const runtime = "nodejs";
export const maxDuration = 60;

// next week's <weekday> at 14:00 UTC (~9–10am ET). 1=Mon, 3=Wed, 5=Fri.
function nextWeek(weekday: number): string {
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  const add = ((weekday - d.getUTCDay() + 7) % 7) + 7; // jump into next week
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString();
}

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as {
    topic?: string;
    practiceArea?: string | null;
    sourceText?: string | null;
  };
  const topic = (body.topic ?? "").trim();
  if (!topic) return NextResponse.json({ error: "topic is required" }, { status: 400 });

  // Rule 1 — social posts are generated from an approved source, not a blank
  // topic. Require the source content.
  const sourceText = (body.sourceText ?? "").trim();
  if (!sourceText) {
    return NextResponse.json(
      {
        error:
          "Social posts must be generated from an approved source (published blog, case result, legal update, or service page). Provide the source content, or create the post manually in Content Studio.",
      },
      { status: 422 },
    );
  }

  const db = await getTenantDb();

  // 1) Generate the 3 posts with the dedicated social generator (saved to
  //    content_drafts). Length caps are enforced at generation.
  let gen;
  try {
    gen = await generateSocialPosts({
      source: { kind: "page", title: topic, text: sourceText },
      formats: ["facebook", "linkedin", "instagram"] as SocialFormatKey[],
      practiceArea: body.practiceArea ?? undefined,
      tenantId: db.tenantId,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Generation failed" },
      { status: 500 },
    );
  }
  const byFormat = (f: string) => gen.drafts.find((d) => d.format === f) ?? gen.drafts[0];

  // 2) Map to Diana's distribution plan.
  const plan: { draft: (typeof gen.drafts)[number]; platforms: AyrsharePlatform[]; when: string; angle: string }[] = [
    { draft: byFormat("facebook"), platforms: ["facebook", "instagram", "linkedin"], when: nextWeek(1), angle: "educational" },
    { draft: byFormat("linkedin"), platforms: ["linkedin"], when: nextWeek(3), angle: "professional" },
    { draft: byFormat("instagram"), platforms: ["gmb"], when: nextWeek(5), angle: "local" },
  ];

  const apiKey = getAyrshareApiKey();
  if (!apiKey) {
    return NextResponse.json({
      ok: true,
      scheduled: false,
      message: "3 posts generated and saved as drafts. Social scheduler not connected (no Ayrshare API key) — connect it to auto-schedule.",
      drafts: gen.drafts.map((d) => ({ id: d.id, format: d.format, body: d.body })),
    });
  }

  const { ayrshareProfileKey } = await getTenantConfig(db.tenantId);
  const operatingBrief = await getOperatingBrief(db.tenantId);
  const results: { angle: string; platforms: string[]; when: string; ok: boolean; id?: string; error?: string }[] = [];
  const rows: Record<string, unknown>[] = [];

  for (const p of plan) {
    if (!p.draft) continue;

    // Same S3 compliance gate + legal-accuracy layer as the maintained
    // repurpose/schedule path (app/api/content-production/repurpose/schedule/
    // route.ts) — this route must never post to Ayrshare ungated just because
    // it takes a different code path to get there.
    const ctaType = (p.draft.metadata as Record<string, unknown> | undefined)?.cta_type;
    const blockingFlags = checkSocialCompliance(p.draft.body, {
      socialPhone: operatingBrief.socialPhone,
      platform: p.platforms.includes("instagram") ? "instagram" : p.platforms[0],
      ctaType: typeof ctaType === "string" ? ctaType : undefined,
      offerPhrase: operatingBrief.offerPhrase,
    }).filter((f) => f.severity === "block");

    let legalReasons: string[] = [];
    if (legalAccuracyEnabled()) {
      try {
        const legal = await runLegalCheck(p.draft.body, { tenantId: db.tenantId });
        await syncFindings({ draftId: p.draft.id, tenantId: db.tenantId, incoming: legal.findings });
        legalReasons = legal.findings.filter((f) => f.severity === "critical").map((f) => f.title);
      } catch (e) {
        console.warn(`[content-production/social] legal check failed (draft ${p.draft.id}):`, e);
        legalReasons = ["Legal-accuracy check could not run"];
      }
    }

    if (blockingFlags.length > 0 || legalReasons.length > 0) {
      const reasons = [...blockingFlags.map((f) => f.label), ...legalReasons.map((t) => `Legal review: ${t}`)];
      results.push({ angle: p.angle, platforms: p.platforms, when: p.when, ok: false, error: `Flagged for review: ${reasons.join("; ")}` });
      for (const platform of p.platforms) {
        rows.push({
          platform,
          content: p.draft.body,
          status: "flagged",
          scheduled_at: p.when,
          published_at: null,
          source_draft_id: p.draft.id,
          last_error: `Needs review: ${reasons.join("; ")}`,
        });
      }
      continue;
    }

    try {
      const res = await postToAyrshare({
        apiKey,
        profileKey: ayrshareProfileKey,
        post: p.draft.body,
        platforms: p.platforms,
        scheduleDate: p.when,
      });
      results.push({ angle: p.angle, platforms: p.platforms, when: p.when, ok: res.ok, id: res.id, error: res.errors?.[0]?.message });
      if (res.ok) {
        for (const platform of p.platforms) {
          rows.push({
            platform,
            content: p.draft.body,
            ayrshare_id: res.id ?? null,
            post_url: res.postIds?.find((x) => x.platform === platform)?.postUrl ?? null,
            status: "scheduled",
            scheduled_at: p.when,
            published_at: null,
            source_draft_id: p.draft.id,
          });
        }
      }
    } catch (e) {
      results.push({ angle: p.angle, platforms: p.platforms, when: p.when, ok: false, error: e instanceof Error ? e.message : "schedule failed" });
    }
  }

  if (rows.length) await db.insert("social_posts", rows);

  const scheduled = results.filter((r) => r.ok).length;
  return NextResponse.json({
    ok: scheduled > 0,
    scheduled: scheduled > 0,
    message: `${scheduled} of ${plan.length} posts scheduled (Mon/Wed/Fri next week). Review them in the scheduler before they publish.`,
    results,
    drafts: gen.drafts.map((d) => ({ id: d.id, format: d.format, body: d.body })),
  });
}
