/**
 * POST /api/content/pillars/suggest — AI assist for the pillar-creation wizard.
 *
 * Two modes:
 *   - "single": given a pillar name (+ practice area), propose a clean slug id,
 *     a display label, a suggested URL slug, and grouper keyword hints.
 *   - "set":    given a practice area + short description, propose a full set of
 *     3–8 pillars (each with id, label, url, keywords).
 *
 * Returns proposals only — nothing is saved. The wizard shows them for review,
 * then the editor PUTs the final list to /api/content/pillars.
 */

import { NextResponse } from "next/server";

import {
  CONTENT_SHORT_FORM_MODEL,
  extractJSON,
  getAnthropic,
} from "@/lib/anthropic";
import { normalizePillar, type KMPillar } from "@/lib/km-content-system";
import { guardUser } from "@/lib/supabase-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const mode = asString(body.mode) === "set" ? "set" : "single";
  const practiceArea =
    asString(body.practiceArea) === "collections" ? "collections" : "employment";
  const name = asString(body.name);
  const description = asString(body.description);

  if (mode === "single" && !name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const areaLabel =
    practiceArea === "collections" ? "commercial collections" : "employment law";

  const prompt =
    mode === "single"
      ? [
          `You are defining one SEO content pillar for a ${areaLabel} law firm.`,
          `Pillar topic: "${name}".`,
          "Return ONLY a JSON object:",
          `{"id": "<kebab-case-slug>", "label": "<Title Case display name>", "url": "/<url-slug>/", "keywords": ["<8-15 lowercase search-term hints a keyword would contain to belong to this pillar>"]}`,
          "The keywords are matching hints used to route keywords to this pillar — be specific and varied (synonyms, statutes, common phrasings).",
        ].join("\n")
      : [
          `You are defining the SEO content pillars for a ${areaLabel} practice area${description ? `: ${description}` : ""}.`,
          "Propose 3 to 8 distinct, non-overlapping pillars that cover the major sub-topics.",
          "Return ONLY a JSON object with a \"pillars\" array:",
          `{"pillars": [{"id": "<kebab-case-slug>", "label": "<Title Case>", "url": "/<url-slug>/", "keywords": ["<8-15 lowercase matching hints>"]}]}`,
          "Each pillar's keywords are matching hints used to route keywords to it — specific and varied.",
        ].join("\n");

  try {
    const msg = await getAnthropic().messages.create({
      model: CONTENT_SHORT_FORM_MODEL,
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });
    const block = msg.content.find((b) => b.type === "text");
    const text = block && block.type === "text" ? block.text : "";

    const withArea = (o: unknown) => {
      const merged =
        o && typeof o === "object" ? { ...(o as object), practiceArea } : o;
      return normalizePillar(merged);
    };

    if (mode === "single") {
      const parsed = extractJSON<Record<string, unknown>>(text);
      const pillar = withArea(parsed);
      if (!pillar) {
        return NextResponse.json(
          { error: "Could not parse a pillar from the model" },
          { status: 502 },
        );
      }
      return NextResponse.json({ pillars: [pillar] });
    }

    const parsed = extractJSON<{ pillars?: unknown[] }>(text);
    const list = Array.isArray(parsed.pillars) ? parsed.pillars : [];
    const pillars = list
      .map(withArea)
      .filter((p): p is KMPillar => p !== null);
    if (pillars.length === 0) {
      return NextResponse.json(
        { error: "Could not parse pillars from the model" },
        { status: 502 },
      );
    }
    return NextResponse.json({ pillars });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Suggestion failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
