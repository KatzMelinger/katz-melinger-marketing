/**
 * GET /api/email — provider-agnostic email dashboard.
 *
 * Resolves the tenant's email provider via the registry (tenant_settings.
 * email_provider → EMAIL_PROVIDER env → first available) and returns its
 * normalized dashboard. Backfills the contact/growth tiles from the CMS lead
 * summary when the provider doesn't supply them. Replaces the Constant-Contact-
 * specific /api/email/constant-contact route as the page's data source.
 */

import { NextRequest, NextResponse } from "next/server";

import { fetchCmsJson } from "@/lib/cms-server";
import { guardUser } from "@/lib/supabase-route";
import { getTenantConfig } from "@/lib/tenant-config";
import { resolveEmailProvider } from "@/lib/email/registry";
import { emptyEmailDashboard, type EmailProviderId } from "@/lib/email/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;

  const cfg = await getTenantConfig();
  const provider = resolveEmailProvider(cfg.emailProvider as EmailProviderId | null);

  const queryListId = req.nextUrl.searchParams.get("listId")?.trim() || null;
  const envListId = process.env.CONSTANT_CONTACT_LIST_ID?.trim() || null;
  const listId = queryListId === "all" ? null : queryListId ?? envListId;

  // Provider-agnostic CMS fallback for the contact/growth tiles.
  const cms =
    (await fetchCmsJson<{ totalLeads?: number; monthlyGrowth?: number }>(
      "/api/v1/leads/summary",
    )) ?? null;
  const cmsContacts = Number(cms?.totalLeads) || 0;
  const cmsGrowth = Number(cms?.monthlyGrowth) || 0;

  if (!provider) {
    const payload = emptyEmailDashboard("No email provider is configured for this firm.");
    payload.dashboard.contacts = cmsContacts;
    payload.dashboard.monthlyGrowth = cmsGrowth;
    return NextResponse.json({ ...payload, provider: null });
  }

  const dash = await provider.getDashboard({ listId });
  if (!dash.dashboard.contacts) dash.dashboard.contacts = cmsContacts;
  if (!dash.dashboard.monthlyGrowth) dash.dashboard.monthlyGrowth = cmsGrowth;

  return NextResponse.json({ ...dash, provider: provider.id });
}
