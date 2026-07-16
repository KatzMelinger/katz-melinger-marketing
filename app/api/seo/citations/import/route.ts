/**
 * POST /api/seo/citations/import
 *   body: { text: string }
 *
 * Bulk-load tracked citation listings from a pasted list. Accepts:
 *   - one URL per line, or
 *   - CSV / TSV rows of "Domain, Citation Link" (a header row is skipped).
 *
 * Each parsed row seeds a tracked citation with its listing_url, so the
 * "Audit from saved links" run picks it up automatically. Domain → source
 * label; the full URL → listing_url.
 */

import { NextResponse } from "next/server";

import { importCitations } from "@/lib/seo-citations";
import { guardUser } from "@/lib/supabase-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Capitalize the first label of a hostname: "avvo.com" → "Avvo". */
function sourceFromHost(host: string): string {
  const label = host.replace(/^www\./, "").split(".")[0] ?? host;
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : host;
}

function normalizeUrl(raw: string): string | null {
  let url = raw.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) {
    // Bare domain like "avvo.com/lawyer/..." → assume https.
    if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(url)) url = `https://${url}`;
    else return null;
  }
  try {
    // Round-trip through URL to validate + canonicalize.
    return new URL(url).toString();
  } catch {
    return null;
  }
}

function parseImport(text: string): { source: string; listing_url: string }[] {
  const out: { source: string; listing_url: string }[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // Skip an obvious header row ("Domain, Citation Link").
    if (/^(domain|source|name)\b/i.test(line) && /(citation|link|url)/i.test(line)) continue;

    const parts = line.split(/[,\t]/).map((s) => s.trim()).filter(Boolean);
    let domainLabel = "";
    let urlPart = "";
    if (parts.length >= 2) {
      urlPart = parts.find((p) => /^https?:\/\//i.test(p)) ?? parts[1];
      domainLabel = parts.find((p) => p !== urlPart) ?? parts[0];
    } else {
      urlPart = parts[0] ?? line;
    }

    const url = normalizeUrl(urlPart);
    if (!url) continue;

    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    const source = (domainLabel || sourceFromHost(host)).trim();
    const key = source.toLowerCase();
    if (seen.has(key)) continue; // de-dupe within the batch
    seen.add(key);
    out.push({ source, listing_url: url });
  }
  return out;
}

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = typeof body.text === "string" ? body.text : "";
  const entries = parseImport(text);
  if (entries.length === 0) {
    return NextResponse.json(
      { error: "No usable URLs found. Paste one URL per line, or Domain,Link rows." },
      { status: 400 },
    );
  }

  try {
    const result = await importCitations(entries);
    const parts = [
      result.added ? `${result.added} added` : "",
      result.updated ? `${result.updated} updated` : "",
      result.skipped ? `${result.skipped} skipped (already tracked or invalid)` : "",
    ].filter(Boolean);
    return NextResponse.json({
      ok: true,
      ...result,
      parsed: entries.length,
      message: `Imported ${entries.length} listing(s): ${parts.join(", ") || "no changes"}.`,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Import failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
