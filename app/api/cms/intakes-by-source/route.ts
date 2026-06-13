import { NextResponse } from "next/server";

import { fetchCmsJson } from "@/lib/cms-server";
import { guardUser } from "@/lib/supabase-route";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;
  const data = await fetchCmsJson<unknown>("/api/v1/intakes/by-source");
  const rows = Array.isArray(data) ? data : [];
  return NextResponse.json(rows);
}
