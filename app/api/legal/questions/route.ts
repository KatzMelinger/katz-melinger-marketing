/**
 * GET  /api/legal/questions[?attorney=email]
 *      The attorney review queue (Oct 20 spec, Task A14). An attorney sees only
 *      their own questions; anyone else sees all, or one attorney's.
 * POST /api/legal/questions   { draftId, hash, action: "approve" | "replace", replacement? }
 *      An attorney's answer. Only the reviewing attorneys may answer (any of the
 *      three, as backup for each other).
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase-route";
import { getTenantClient } from "@/lib/tenant-db";
import { canClearLegalHold } from "@/lib/legal-reviewers";
import { answerQuestion, listQuestions } from "@/lib/attorney-questions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { tenantId } = await getTenantClient();
  const isAttorney = canClearLegalHold(user.email ?? "");
  const filter = isAttorney && req.nextUrl.searchParams.get("all") !== "1" ? user.email : req.nextUrl.searchParams.get("attorney");
  const questions = await listQuestions(tenantId, { attorneyEmail: filter || null });
  return NextResponse.json({ questions, isAttorney, me: user.email });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canClearLegalHold(user.email ?? "")) {
    return NextResponse.json({ error: "Only a reviewing attorney (Nicole Grunfeld, Adam Sackowitz or Kenneth Katz) can answer." }, { status: 403 });
  }
  const b = (await req.json().catch(() => ({}))) as { draftId?: string; hash?: string; action?: string; replacement?: string };
  if (!b.draftId || !b.hash || (b.action !== "approve" && b.action !== "replace")) {
    return NextResponse.json({ error: "draftId, hash and action are required" }, { status: 400 });
  }
  const { tenantId } = await getTenantClient();
  try {
    const r = await answerQuestion({
      tenantId,
      draftId: b.draftId,
      hash: b.hash,
      action: b.action,
      replacement: b.replacement ?? null,
      by: { id: user.id, email: user.email ?? "" },
    });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }
}
