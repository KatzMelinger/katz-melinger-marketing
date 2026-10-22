/**
 * GET  /api/content/drafts/[id]/language-pair            the paired version, and candidates to pair with
 * POST /api/content/drafts/[id]/language-pair { otherId | null }   pair (or unpair) the English and Spanish versions
 *
 * Oct 20 spec, Task A13: English and Spanish versions of the same topic are
 * linked as a pair, and publish with hreflang tags pointing at each other.
 * The pair is stored on both drafts (metadata.language_pair).
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantClient } from "@/lib/tenant-db";
import { getCurrentUser } from "@/lib/supabase-route";
import { draftLanguage } from "@/lib/draft-frame-server";
import { recordAuditEvent } from "@/lib/content-findings-store";

export const dynamic = "force-dynamic";

type Meta = Record<string, unknown>;
const pairOf = (m: Meta | null) => ((m?.language_pair as { draft_id?: string } | undefined)?.draft_id ?? null);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getTenantClient();
  const { data: d } = await supabase.from("content_drafts").select("id, title, metadata").eq("id", id).maybeSingle();
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const meta = (d.metadata as Meta | null) ?? {};
  const language = draftLanguage(meta);
  const pairId = pairOf(meta);
  let pair = null;
  if (pairId) {
    const { data: p } = await supabase.from("content_drafts").select("id, title, status").eq("id", pairId).maybeSingle();
    pair = p ?? null;
  }
  // Candidates: open drafts in the other language, newest first.
  const { data: rows } = await supabase
    .from("content_drafts")
    .select("id, title, status, metadata, updated_at")
    .neq("id", id)
    .not("status", "eq", "archived")
    .order("updated_at", { ascending: false })
    .limit(300);
  const candidates = (rows ?? [])
    .filter((r) => draftLanguage((r.metadata as Meta | null) ?? {}) !== language)
    .slice(0, 50)
    .map((r) => ({ id: r.id as string, title: (r.title as string | null) ?? "(no title)", status: r.status as string }));
  return NextResponse.json({ language, pair, candidates });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const { otherId } = (await req.json().catch(() => ({}))) as { otherId?: string | null };
  const { tenantId, supabase } = await getTenantClient();
  const load = async (draftId: string) => {
    const { data } = await supabase.from("content_drafts").select("id, metadata").eq("id", draftId).maybeSingle();
    return data ? { id: data.id as string, meta: (data.metadata as Meta | null) ?? {} } : null;
  };
  const me = await load(id);
  if (!me) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const other = otherId ? await load(otherId) : null;
  if (otherId && !other) return NextResponse.json({ error: "The other draft was not found." }, { status: 404 });
  if (other && draftLanguage(other.meta) === draftLanguage(me.meta)) {
    return NextResponse.json({ error: "Pair an English draft with a Spanish one." }, { status: 400 });
  }

  const save = async (draftId: string, meta: Meta) => {
    const { error } = await supabase.from("content_drafts").update({ metadata: meta }).eq("id", draftId).eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
  };
  const unpair = (m: Meta) => {
    const next = { ...m };
    delete next.language_pair;
    return next;
  };
  try {
    // Undo any pairing either side had before.
    for (const prev of [pairOf(me.meta), other ? pairOf(other.meta) : null]) {
      if (prev && prev !== other?.id && prev !== me.id) {
        const p = await load(prev);
        if (p) await save(p.id, unpair(p.meta));
      }
    }
    if (other) {
      const at = new Date().toISOString();
      await save(me.id, { ...me.meta, language_pair: { draft_id: other.id, language: draftLanguage(other.meta), by: user.email, at } });
      await save(other.id, { ...other.meta, language_pair: { draft_id: me.id, language: draftLanguage(me.meta), by: user.email, at } });
    } else {
      await save(me.id, unpair(me.meta));
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  await recordAuditEvent({ tenantId, draftId: id, event: other ? "language_paired" : "language_unpaired", actorUserId: user.id, actorEmail: user.email, detail: { otherId: other?.id ?? null } });
  return NextResponse.json({ ok: true });
}
