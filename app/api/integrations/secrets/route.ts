/**
 * Per-tenant integration secrets (Workstream B5).
 *
 *   GET — returns which secret keys are SET for this firm (booleans only; never
 *         the values). Used by the settings UI to show connected/not-connected.
 *   PUT — set or clear one secret. Body: { key, value }. Empty value clears it.
 *
 * Write-only by design: values can be saved but never read back through the API
 * (like Vercel "sensitive" vars). Secrets live in tenant_secrets (service-role
 * only). Scoped to the caller's own tenant via getTenantSecret/setTenantSecret.
 */

import { NextRequest, NextResponse } from "next/server";
import { guardUser } from "@/lib/supabase-route";
import {
  getTenantSecret,
  setTenantSecret,
  TENANT_SECRET_KEYS,
  type TenantSecretKey,
} from "@/lib/tenant-secrets";

export const runtime = "nodejs";

const MAX_VALUE_LENGTH = 60000;

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;
  const present: Record<string, boolean> = {};
  for (const key of TENANT_SECRET_KEYS) {
    present[key] = Boolean(await getTenantSecret(key));
  }
  return NextResponse.json({ present });
}

export async function PUT(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const key = body?.key;
  const value = body?.value;
  if (typeof key !== "string" || !TENANT_SECRET_KEYS.includes(key as TenantSecretKey)) {
    return NextResponse.json(
      { error: `key must be one of: ${TENANT_SECRET_KEYS.join(", ")}` },
      { status: 400 },
    );
  }
  if (typeof value !== "string") {
    return NextResponse.json({ error: "value must be a string" }, { status: 400 });
  }
  if (value.length > MAX_VALUE_LENGTH) {
    return NextResponse.json(
      { error: `value must be under ${MAX_VALUE_LENGTH} characters` },
      { status: 400 },
    );
  }
  // Validate the Google service-account JSON before storing so a firm gets
  // immediate feedback instead of a silent failure at query time.
  if (key === "GOOGLE_SERVICE_ACCOUNT_JSON" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (!parsed.client_email || !parsed.private_key) {
        return NextResponse.json(
          { error: "That JSON is missing client_email / private_key — not a service-account key." },
          { status: 400 },
        );
      }
    } catch {
      return NextResponse.json({ error: "Value is not valid JSON." }, { status: 400 });
    }
  }

  try {
    await setTenantSecret(key, value);
    return NextResponse.json({ ok: true, key, set: Boolean(value.trim()) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to save secret" },
      { status: 500 },
    );
  }
}
