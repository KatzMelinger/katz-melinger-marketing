import { NextResponse } from "next/server";

import { getSupabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const prospectId = url.searchParams.get("prospect_id")?.trim();
  if (!prospectId) {
    return NextResponse.json({ error: "prospect_id required" }, { status: 400 });
  }

  const sb = getSupabaseServer();
  if (!sb) {
    return NextResponse.json(
      { error: "Supabase is not configured", activities: [] },
      { status: 503 },
    );
  }

  const { data, error } = await sb
    .from("sales_activities")
    .select("*")
    .eq("prospect_id", prospectId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message, activities: [] }, { status: 500 });
  }
  return NextResponse.json({ activities: data ?? [] });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const prospectId = typeof o.prospect_id === "string" ? o.prospect_id.trim() : "";
  const type = typeof o.type === "string" ? o.type.trim() : "";
  const notes = typeof o.notes === "string" ? o.notes.trim() : null;
  const staffMember =
    typeof o.staff_member === "string" ? o.staff_member.trim() : null;
  const nextFollowup =
    typeof o.next_followup === "string" && o.next_followup.trim()
      ? o.next_followup.trim()
      : null;

  if (!prospectId || !type) {
    return NextResponse.json(
      { error: "prospect_id and type required" },
      { status: 400 },
    );
  }

  const row = {
    prospect_id: prospectId,
    type,
    notes,
    staff_member: staffMember,
    next_followup: nextFollowup,
  };

  const sb = getSupabaseServer();
  if (!sb) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const { data, error } = await sb
    .from("sales_activities")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await sb
    .from("prospects")
    .update({ last_activity: new Date().toISOString().slice(0, 10) })
    .eq("id", prospectId);

  return NextResponse.json({ id: data?.id });
}
