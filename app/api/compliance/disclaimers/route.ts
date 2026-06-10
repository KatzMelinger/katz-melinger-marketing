/**
 * Compliance Disclaimer Library CRUD — reusable required-disclaimer snippets.
 *   GET    /api/compliance/disclaimers?enabledOnly=1
 *   POST   /api/compliance/disclaimers        (create or update; include id to update)
 *   DELETE /api/compliance/disclaimers?id=
 */

import { NextRequest, NextResponse } from "next/server";

import {
  deleteDisclaimer,
  listDisclaimers,
  upsertDisclaimer,
} from "@/lib/compliance-rules-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  try {
    const disclaimers = await listDisclaimers({
      enabledOnly: url.searchParams.get("enabledOnly") === "1",
    });
    return NextResponse.json({ disclaimers });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "load failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!label || !text) {
    return NextResponse.json(
      { error: "label and text required" },
      { status: 400 },
    );
  }
  try {
    const disclaimer = await upsertDisclaimer({
      id: typeof body.id === "string" ? body.id : undefined,
      label,
      text,
      jurisdiction:
        typeof body.jurisdiction === "string" ? body.jurisdiction : null,
      trigger: typeof body.trigger === "string" ? body.trigger : null,
      practice_area:
        typeof body.practice_area === "string" ? body.practice_area : null,
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
      review_status: body.review_status as never,
    });
    return NextResponse.json({ disclaimer });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "save failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await deleteDisclaimer(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delete failed" },
      { status: 500 },
    );
  }
}
