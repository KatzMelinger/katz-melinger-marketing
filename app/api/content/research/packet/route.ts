/**
 * Research Packet API.
 *   POST /api/content/research/packet
 *     body: { topic, practiceArea?, primaryKeyword?, enabledSources?, captureToLibrary? }
 *     → runs the research layer, persists, returns the packet.
 *   GET  /api/content/research/packet            → list recent packets
 *   GET  /api/content/research/packet?id=<uuid>  → fetch one packet
 */

import { NextRequest, NextResponse } from "next/server";

import {
  generateResearchPacket,
  getResearchPacket,
  listResearchPackets,
} from "@/lib/research-packet";
import type { PeopleAskSourceType } from "@/lib/research-libraries";
import { guardUser } from "@/lib/supabase-route";

export const runtime = "nodejs";
export const maxDuration = 300;

const VALID_SOURCES: PeopleAskSourceType[] = [
  "dataforseo",
  "search_console",
  "autocomplete",
  "reddit",
  "youtube",
];

export async function GET(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id");
  try {
    if (id) {
      const packet = await getResearchPacket(id);
      if (!packet) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }
      return NextResponse.json({ packet });
    }
    const packets = await listResearchPackets();
    return NextResponse.json({ packets });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "load failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic) {
    return NextResponse.json({ error: "topic required" }, { status: 400 });
  }
  const enabledSources = Array.isArray(body.enabledSources)
    ? (body.enabledSources as string[]).filter((s): s is PeopleAskSourceType =>
        VALID_SOURCES.includes(s as PeopleAskSourceType),
      )
    : undefined;
  try {
    const packet = await generateResearchPacket({
      topic,
      practiceArea:
        typeof body.practiceArea === "string" ? body.practiceArea : null,
      primaryKeyword:
        typeof body.primaryKeyword === "string" ? body.primaryKeyword : null,
      enabledSources: enabledSources && enabledSources.length > 0 ? enabledSources : undefined,
      captureToLibrary: body.captureToLibrary !== false,
    });
    return NextResponse.json({ packet });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "packet generation failed" },
      { status: 500 },
    );
  }
}
