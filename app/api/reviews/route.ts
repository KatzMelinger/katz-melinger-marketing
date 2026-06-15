import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { guardUser } from "@/lib/supabase-route";
import { resolveTenantId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceRoleKey) {
    return NextResponse.json({
      reviews: [],
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  try {
    const supabase = createClient(url, serviceRoleKey);
    const { data, error } = await supabase
      .from("reviews")
      .select("*")
      .eq("tenant_id", await resolveTenantId())
      .order("review_date", { ascending: false, nullsFirst: false });

    if (error) {
      return NextResponse.json({ reviews: [], error: error.message });
    }

    return NextResponse.json({ reviews: data ?? [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ reviews: [], error: message });
  }
}
