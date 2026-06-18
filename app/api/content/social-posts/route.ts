import { NextResponse } from "next/server";

import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

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

  // social_posts has no `title` column — fold the title into `content` so it
  // isn't lost, and write the text to `content` (the real column, not `body`).
  const content = title ? `${title}\n\n${textBody}` : textBody;
  const { data, error } = await sb
    .from("social_posts")
    .insert({ platform, content, tenant_id: await resolveTenantId() })
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ id: data?.id });
}
