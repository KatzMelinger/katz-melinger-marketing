/**
 * GET    /api/seo/backlinks/disavow            — list all disavow actions
 * POST   /api/seo/backlinks/disavow            — { domain, status, notes? }
 * DELETE /api/seo/backlinks/disavow?domain=…   — clear action for one domain
 *
 * Status enum: pending | disavowed | outreach_sent | safe
 *
 * Backs the Disavow Manager on /seo/backlinks. Google's Disavow Tool has
 * no API, so this only tracks our side of the workflow — the actual file
 * upload to Search Console is still manual.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  clearDisavowAction,
  listDisavowActions,
  setDisavowStatus,
  type DisavowStatus,
} from "@/lib/seo-disavow";
import { guardUser } from "@/lib/supabase-route";

export const dynamic = "force-dynamic";

const VALID_STATUSES: DisavowStatus[] = ["pending", "disavowed", "outreach_sent", "safe"];

export async function GET() {
  try {
    const actions = await listDisavowActions();
    return NextResponse.json({ actions });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list disavow actions" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const domain = typeof obj.domain === "string" ? obj.domain : "";
  const statusRaw = typeof obj.status === "string" ? obj.status : "";
  const notes = typeof obj.notes === "string" ? obj.notes : null;
  if (!VALID_STATUSES.includes(statusRaw as DisavowStatus)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  const result = await setDisavowStatus(domain, statusRaw as DisavowStatus, notes);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Failed" }, { status: 400 });
  }
  const actions = await listDisavowActions();
  return NextResponse.json({ ...result, actions });
}

export async function DELETE(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const domain = req.nextUrl.searchParams.get("domain") ?? "";
  const result = await clearDisavowAction(domain);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Failed" }, { status: 400 });
  }
  const actions = await listDisavowActions();
  return NextResponse.json({ ...result, actions });
}
