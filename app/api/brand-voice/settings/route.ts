/**
 * /api/brand-voice/settings
 *   GET — return all firm-level settings as a flat key/value object
 *   PUT — upsert one or more settings. Body: { settings: { key: value, ... } }
 *
 * These settings feed lib/firm-context.ts, which injects them into the
 * system prompt of every keyword research AI call. Recognized keys include
 * firmName, targetGeography, keyMessages, toneOfVoice — but the table
 * accepts any key so MarketOS can grow into other context fields (e.g.
 * brandStory, valueProps) without schema changes.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";

const MAX_VALUE_LENGTH = 40000;

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("brand_voice_settings")
      .select("key, value, updated_at");

    if (error) {
      console.error("[brand-voice/settings GET] Supabase error:", error.message);
      return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
    }

    const settings: Record<string, string> = {};
    for (const row of data ?? []) {
      if (row?.key) settings[row.key] = row.value ?? "";
    }
    return NextResponse.json({ settings });
  } catch (err: any) {
    console.error("[brand-voice/settings GET] Failed:", err?.message);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { settings } = body || {};

    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      return NextResponse.json(
        { error: "settings must be an object of key/value pairs" },
        { status: 400 },
      );
    }

    const rows: { key: string; value: string; updated_at: string }[] = [];
    const now = new Date().toISOString();
    for (const [key, value] of Object.entries(settings)) {
      if (typeof key !== "string" || key.length === 0 || key.length > 100) {
        return NextResponse.json(
          { error: `Invalid settings key: ${key}` },
          { status: 400 },
        );
      }
      if (typeof value !== "string") {
        return NextResponse.json(
          { error: `Value for "${key}" must be a string` },
          { status: 400 },
        );
      }
      if (value.length > MAX_VALUE_LENGTH) {
        return NextResponse.json(
          { error: `Value for "${key}" must be under ${MAX_VALUE_LENGTH} characters` },
          { status: 400 },
        );
      }
      rows.push({ key, value, updated_at: now });
    }

    if (rows.length === 0) {
      return NextResponse.json({ settings: {} });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("brand_voice_settings")
      .upsert(rows, { onConflict: "key" });

    if (error) {
      console.error("[brand-voice/settings PUT] Supabase error:", error.message);
      return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
    }

    // Return the full updated set so the client can swap state in one go.
    const { data: updated } = await supabase
      .from("brand_voice_settings")
      .select("key, value");
    const out: Record<string, string> = {};
    for (const r of updated ?? []) out[r.key] = r.value ?? "";
    return NextResponse.json({ settings: out });
  } catch (err: any) {
    console.error("[brand-voice/settings PUT] Failed:", err?.message);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
