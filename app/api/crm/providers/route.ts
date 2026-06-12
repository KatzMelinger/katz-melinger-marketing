/**
 * GET /api/crm/providers — lists every CRM/intake provider the app supports,
 * whether each is configured (keys present), its capabilities, and which one is
 * currently active. Powers a connections panel and proves the layer is
 * vendor-agnostic.
 */

import { NextResponse } from "next/server";

import { listCrmProviders, resolveCrmProvider } from "@/lib/crm/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const providers = listCrmProviders();
  const active = resolveCrmProvider();
  return NextResponse.json({
    active: active ? { id: active.id, label: active.label, capabilities: active.capabilities } : null,
    providers,
  });
}
