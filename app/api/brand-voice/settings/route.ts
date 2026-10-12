/**
 * /api/brand-voice/settings
 *   GET — return all firm-level settings as a flat key/value object
 *   PUT — upsert one or more settings. Body: { settings: { key: value, ... } }
 *
 * These settings feed lib/firm-context.ts, which injects them into the
 * system prompt of every keyword research AI call. Recognized keys include
 * firmName, targetGeography, keyMessages, toneOfVoice — but the table
 * accepts any key so Huraqan can grow into other context fields (e.g.
 * brandStory, valueProps) without schema changes.
 *
 * Every changed value is recorded in rule_changes (Oct 6 spec, Task 24), so a
 * brand constant can be restored from Rules history.
 */

import { NextRequest, NextResponse } from "next/server";
import { IDENTITY_TO_COLUMN } from "@/lib/brand-settings";
import { recordRuleChange } from "@/lib/rule-changes";
import { getCurrentUser, guardUser } from "@/lib/supabase-route";
import { getTenantClient, getTenantDb } from "@/lib/tenant-db";

export const runtime = "nodejs";

const MAX_VALUE_LENGTH = 40000;

// Firm-identity fields are mirrored into tenant_settings: lib/brand-settings.ts.

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;
  try {
    const db = await getTenantDb();
    const { data, error } = await db
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

    // Overlay the canonical firm-identity values from tenant_settings so the
    // form reflects the single source of truth (and stays consistent with the
    // sidebar / content generation) regardless of where it was last edited.
    try {
      const { data: ts } = await db
        .from("tenant_settings")
        .select("firm_name, firm_address, firm_phone, firm_email, firm_website, target_geography, firm_spokesperson, brand_primary_color, logo_url")
        .maybeSingle();
      if (ts) {
        for (const [key, col] of Object.entries(IDENTITY_TO_COLUMN)) {
          const v = (ts as Record<string, string | null>)[col];
          if (typeof v === "string" && v.trim()) settings[key] = v;
        }
      }
    } catch {
      /* tenant_settings unavailable — fall back to brand_voice_settings values */
    }

    return NextResponse.json({ settings });
  } catch (err) {
    console.error("[brand-voice/settings GET] Failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
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

    const db = await getTenantDb();
    const { data: beforeRows } = await db
      .from("brand_voice_settings")
      .select("key, value")
      .in("key", rows.map((r) => r.key));
    const before = new Map((beforeRows ?? []).map((r) => [r.key as string, (r.value as string | null) ?? ""]));

    const { error } = await db.upsert("brand_voice_settings", rows, {
      onConflict: "tenant_id,key",
    });

    if (error) {
      console.error("[brand-voice/settings PUT] Supabase error:", error.message);
      return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
    }

    const { tenantId } = await getTenantClient();
    for (const r of rows) {
      const old = before.get(r.key);
      if (old === r.value || (old === undefined && r.value === "")) continue;
      await recordRuleChange(tenantId, {
        kind: "brand",
        ref: r.key,
        label: r.key,
        action: old === undefined ? "create" : "update",
        oldValue: old ?? null,
        newValue: r.value,
        by: user.email,
      });
    }

    // Mirror any firm-identity fields into tenant_settings (the canonical home),
    // so edits here also update the sidebar wordmark and every per-tenant feature.
    const identityPatch: Record<string, string> = {};
    for (const [key, col] of Object.entries(IDENTITY_TO_COLUMN)) {
      const v = (settings as Record<string, unknown>)[key];
      if (typeof v === "string") identityPatch[col] = v;
    }
    if (Object.keys(identityPatch).length > 0) {
      identityPatch.updated_at = now;
      const { error: tsError } = await db.upsert("tenant_settings", [identityPatch], {
        onConflict: "tenant_id",
      });
      if (tsError) {
        // Non-fatal: brand_voice_settings already saved. Log and continue.
        console.error("[brand-voice/settings PUT] tenant_settings sync failed:", tsError.message);
      }
    }

    // Return the full updated set so the client can swap state in one go.
    const { data: updated } = await db
      .from("brand_voice_settings")
      .select("key, value");
    const out: Record<string, string> = {};
    for (const r of updated ?? []) out[r.key] = r.value ?? "";
    return NextResponse.json({ settings: out });
  } catch (err) {
    console.error("[brand-voice/settings PUT] Failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
