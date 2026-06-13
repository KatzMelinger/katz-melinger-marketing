import { NextResponse } from "next/server";

import { fetchCmsJson } from "@/lib/cms-server";
import { guardUser } from "@/lib/supabase-route";

export const dynamic = "force-dynamic";

type CmsBody = { breakdown?: unknown };

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;
  const data = await fetchCmsJson<CmsBody>("/api/v1/revenue/attribution");
  const breakdown = Array.isArray(data?.breakdown) ? data!.breakdown : [];
  return NextResponse.json({ breakdown });
}
