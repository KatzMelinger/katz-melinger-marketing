import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
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
