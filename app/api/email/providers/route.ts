/**
 * GET /api/email/providers — list registered email providers + the active one.
 * Powers a provider picker in the email/settings UI (parallels /api/crm/providers).
 */

import { NextResponse } from "next/server";

import { guardUser } from "@/lib/supabase-route";
import { getTenantConfig } from "@/lib/tenant-config";
import { listEmailProviders, resolveEmailProvider } from "@/lib/email/registry";
import type { EmailProviderId } from "@/lib/email/types";

export const runtime = "nodejs";

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;
  const cfg = await getTenantConfig();
  const active = resolveEmailProvider(cfg.emailProvider as EmailProviderId | null);
  return NextResponse.json({
    providers: listEmailProviders(),
    active: active?.id ?? null,
    configured: cfg.emailProvider ?? null,
  });
}
