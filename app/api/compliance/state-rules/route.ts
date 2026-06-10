/**
 * State Compliance Rules CRUD — per-jurisdiction attorney-advertising rules.
 *   GET    /api/compliance/state-rules?enabledOnly=1
 *   POST   /api/compliance/state-rules        (create or update; include id to update)
 *   DELETE /api/compliance/state-rules?id=
 */

import { NextRequest, NextResponse } from "next/server";

import {
  deleteStateRule,
  listStateRules,
  upsertStateRule,
  type KeyRule,
} from "@/lib/compliance-rules-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeKeyRules(v: unknown): KeyRule[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      citation: typeof r.citation === "string" ? r.citation : "",
      rule: typeof r.rule === "string" ? r.rule : "",
      severity: (r.severity === "high" || r.severity === "low"
        ? r.severity
        : "medium") as KeyRule["severity"],
    }))
    .filter((r) => r.rule);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  try {
    const rules = await listStateRules({
      enabledOnly: url.searchParams.get("enabledOnly") === "1",
    });
    return NextResponse.json({ rules });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "load failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const code =
    typeof body.jurisdiction_code === "string"
      ? body.jurisdiction_code.trim().toUpperCase()
      : "";
  const name =
    typeof body.jurisdiction_name === "string"
      ? body.jurisdiction_name.trim()
      : "";
  if (!code || !name) {
    return NextResponse.json(
      { error: "jurisdiction_code and jurisdiction_name required" },
      { status: 400 },
    );
  }
  try {
    const rule = await upsertStateRule({
      id: typeof body.id === "string" ? body.id : undefined,
      jurisdiction_code: code,
      jurisdiction_name: name,
      governing_authority:
        typeof body.governing_authority === "string"
          ? body.governing_authority
          : null,
      rules_summary:
        typeof body.rules_summary === "string" ? body.rules_summary : null,
      key_rules: normalizeKeyRules(body.key_rules),
      required_label:
        typeof body.required_label === "string" ? body.required_label : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
      review_status: body.review_status as never,
      last_verified_at:
        typeof body.last_verified_at === "string"
          ? body.last_verified_at
          : null,
    });
    return NextResponse.json({ rule });
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
    await deleteStateRule(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delete failed" },
      { status: 500 },
    );
  }
}
