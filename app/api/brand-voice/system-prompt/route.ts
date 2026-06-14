/**
 * Per-tenant content-generation SYSTEM PROMPT (Workstream E).
 *
 *   GET  — returns the firm's saved override (or null) plus the effective prompt
 *          that content generation currently uses and whether it's the built-in
 *          default.
 *   PUT  — save an override. Body: { systemPrompt: string }. Empty string clears
 *          the override (falls back to the built-in default).
 *   POST — generate a draft system prompt from the firm's profile via Claude.
 *          Body: {} → { systemPrompt }. Does NOT save; the user reviews then PUTs.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTenantDb } from "@/lib/tenant-db";
import { getTenantConfig } from "@/lib/tenant-config";
import { generateSystemPrompt } from "@/lib/system-prompt-generator";

export const runtime = "nodejs";

const MAX_LEN = 40000;

export async function GET() {
  try {
    const db = await getTenantDb();
    const { data } = await db
      .from("tenant_settings")
      .select("system_prompt")
      .maybeSingle();
    const saved =
      typeof data?.system_prompt === "string" && data.system_prompt.trim()
        ? (data.system_prompt as string)
        : null;
    // Effective prompt content generation actually uses (default-resolved).
    const effective = (await getTenantConfig(db.tenantId)).systemPrompt;
    return NextResponse.json({ saved, effective, isDefault: saved === null });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const value = body?.systemPrompt;
    if (typeof value !== "string") {
      return NextResponse.json({ error: "systemPrompt must be a string" }, { status: 400 });
    }
    if (value.length > MAX_LEN) {
      return NextResponse.json(
        { error: `systemPrompt must be under ${MAX_LEN} characters` },
        { status: 400 },
      );
    }
    const db = await getTenantDb();
    // Empty → store null so the firm falls back to the built-in default.
    const toStore = value.trim() ? value : null;
    const { error } = await db.upsert(
      "tenant_settings",
      [{ system_prompt: toStore, updated_at: new Date().toISOString() }],
      { onConflict: "tenant_id" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, saved: toStore });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to save" },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const systemPrompt = await generateSystemPrompt();
    return NextResponse.json({ systemPrompt });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to generate" },
      { status: 500 },
    );
  }
}
