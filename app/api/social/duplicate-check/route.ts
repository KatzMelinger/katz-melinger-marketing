/**
 * POST /api/social/duplicate-check
 *   body: { posts: [{ platform?, body }] }
 *
 * Live duplicate/angle check for the composer: compares each candidate against
 * the whole Content Calendar (semantically, via the synonym-aware angle
 * signature — not exact text) and returns the best matching post per candidate,
 * so the composer can show a "similar angle already scheduled" alert before the
 * user schedules. Enforcement still happens server-side in the schedule route;
 * this endpoint is the advisory heads-up.
 */

import { NextResponse } from "next/server";

import { checkCalendarDuplicates } from "@/lib/social-duplicate";
import { guardUser } from "@/lib/supabase-route";
import { getTenantDb } from "@/lib/tenant-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingPost = { platform?: string; body?: string };

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { posts?: IncomingPost[] };
  const posts = Array.isArray(body.posts) ? body.posts : [];
  const candidates = posts
    .map((p) => ({ platform: p?.platform ?? "", body: typeof p?.body === "string" ? p.body : "" }))
    .filter((p) => p.body.trim().length > 0);

  if (candidates.length === 0) {
    return NextResponse.json({ ran: false, matches: [] });
  }

  try {
    const db = await getTenantDb();
    const dup = await checkCalendarDuplicates({
      tenantId: db.tenantId,
      candidates: candidates.map((c) => ({ body: c.body })),
    });
    // Return the single best conflict per candidate (or null), tagged with the
    // candidate's platform so the composer can key alerts by network.
    const matches = candidates.map((c, i) => {
      const conflict = dup.conflicts[i]?.[0] ?? null;
      return { platform: c.platform, conflict };
    });
    return NextResponse.json({ ran: dup.ran, matches });
  } catch (e) {
    const message = e instanceof Error ? e.message : "check failed";
    return NextResponse.json({ ran: false, matches: [], error: message });
  }
}
