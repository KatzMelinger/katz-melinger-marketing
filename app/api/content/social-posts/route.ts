import { NextResponse } from "next/server";

import { getSupabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const platform = typeof o.platform === "string" ? o.platform.trim() : "blog";
  const title = typeof o.title === "string" ? o.title.trim() : null;
  const textBody = typeof o.body === "string" ? o.body : "";
  if (!textBody.trim()) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }

  const sb = getSupabaseServer();
  if (!sb) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const { data, error } = await sb
    .from("social_posts")
    .insert({ platform, title, body: textBody })
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ id: data?.id });
}
