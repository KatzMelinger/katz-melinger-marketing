/**
 * Who may read the Intake & Sales dashboard: app admins (it shows individual
 * staff performance), or a server holding SALES_DASHBOARD_API_KEY — the CMS
 * owners section reads the same numbers that way instead of recomputing them.
 */
import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/supabase-route";
import { resolveTenantId, DEFAULT_TENANT_ID } from "@/lib/tenant-context";

import { DASHBOARD_SINCE } from "./intakes";
import type { Filters } from "./metrics";

export async function guardDashboard(
  req: Request,
): Promise<{ denied: NextResponse } | { denied: null; tenantId: string }> {
  const key = process.env.SALES_DASHBOARD_API_KEY?.trim();
  if (key && req.headers.get("authorization") === `Bearer ${key}`) {
    // The Airtable intake base is Katz Melinger's, i.e. the default tenant.
    return { denied: null, tenantId: DEFAULT_TENANT_ID };
  }
  try {
    await requireAdmin();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unauthorized";
    return { denied: NextResponse.json({ error: message }, { status: message.startsWith("Forbidden") ? 403 : 401 }) };
  }
  return { denied: null, tenantId: await resolveTenantId() };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** ?from=&to=&category=&source= with the dashboard's defaults (2026 to date). */
export function filtersFrom(url: URL): Filters {
  const sp = url.searchParams;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  let from = sp.get("from") ?? DASHBOARD_SINCE;
  let to = sp.get("to") ?? today;
  if (!DATE.test(from) || from < DASHBOARD_SINCE) from = DASHBOARD_SINCE;
  if (!DATE.test(to)) to = today;
  if (to < from) to = from;
  return { from, to, category: sp.get("category") || null, source: sp.get("source") || null };
}
