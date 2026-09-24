/**
 * Real OCR-based legal-accuracy check for images (spec 5.1 / E1).
 *
 * The legal layer (lib/legal-verify.ts) only ever checked body text — a
 * claim baked into a carousel slide's or quote card's pixels was invisible
 * to every check. This extracts the visible text via Claude's vision input
 * (the same Anthropic client already used everywhere else in this app, so no
 * new OCR dependency) and runs it through the exact same runLegalCheck used
 * on body text, so an image-borne legal error is flagged the same way.
 *
 * Extraction is cached by image URL (image_ocr_cache) — a saved image never
 * changes in place, and the gate re-runs on every generation, rewrite,
 * approve, and schedule, so paying for a fresh vision call each time would be
 * pure waste.
 */

import { getAnthropic, CONTENT_SHORT_FORM_MODEL } from "@/lib/anthropic";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { runLegalCheck, runLegalFactChecks } from "@/lib/legal-verify";
import { safeFetch } from "@/lib/url-safety";
import type { NormalizedFinding } from "@/lib/content-findings";

// Instagram carousels cap at 10 slides; this is a defensive ceiling so a
// malformed media list can't turn one gate call into a dozen vision calls.
const MAX_IMAGES_PER_GATE = 10;
// Anthropic's image input cap.
const MAX_IMAGE_BYTES = 5_000_000;

async function fetchImageAsBase64(
  url: string,
): Promise<{ data: string; mediaType: string } | null> {
  try {
    const res = await safeFetch(url, { timeoutMs: 15_000 });
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!contentType.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
    return { data: buf.toString("base64"), mediaType: contentType };
  } catch {
    return null;
  }
}

async function getCachedText(url: string): Promise<string | null> {
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb
      .from("image_ocr_cache")
      .select("extracted_text")
      .eq("url", url)
      .maybeSingle();
    return data ? (data.extracted_text as string) : null;
  } catch {
    return null; // Missing table (migration not run yet) — degrade to no cache.
  }
}

async function setCachedText(url: string, text: string, tenantId: string): Promise<void> {
  try {
    const sb = getSupabaseAdmin();
    await sb
      .from("image_ocr_cache")
      .upsert({ url, extracted_text: text, tenant_id: tenantId }, { onConflict: "url" });
  } catch {
    /* best-effort cache write — a miss just means re-extracting next time */
  }
}

const SUPPORTED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** Extracts the visible text from an image URL, verbatim, via Claude vision. Empty string if none or extraction fails. */
export async function extractImageText(url: string, tenantId: string): Promise<string> {
  const cached = await getCachedText(url);
  if (cached !== null) return cached;

  const image = await fetchImageAsBase64(url);
  if (!image || !SUPPORTED_MEDIA_TYPES.has(image.mediaType)) return "";

  try {
    const resp = await getAnthropic().messages.create({
      model: CONTENT_SHORT_FORM_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: image.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                data: image.data,
              },
            },
            {
              type: "text",
              text: "Transcribe every piece of visible text in this image, verbatim, in reading order. Reply with only the transcribed text — no commentary. If there is no legible text, reply with exactly: NONE",
            },
          ],
        },
      ],
    });
    const block = resp.content.find((b) => b.type === "text");
    const text = block && block.type === "text" ? block.text.trim() : "";
    const result = /^none$/i.test(text) ? "" : text;
    await setCachedText(url, result, tenantId);
    return result;
  } catch {
    return "";
  }
}

/**
 * Runs the legal-accuracy check against the text found in each image, tagging
 * every resulting finding with which image it came from so a reviewer sees
 * "[Image 2] ..." exactly the way they'd see a body-text finding.
 */
export async function checkImagesLegalText(
  imageUrls: string[],
  tenantId: string,
): Promise<NormalizedFinding[]> {
  const urls = imageUrls.slice(0, MAX_IMAGES_PER_GATE);
  const findings: NormalizedFinding[] = [];

  for (let i = 0; i < urls.length; i++) {
    const text = await extractImageText(urls[i], tenantId);
    if (!text) continue;
    // Both halves: the authority loop for cited claims, and the deterministic
    // fact checks — a wrong salary threshold baked into a quote card is the
    // same error it would be in body text, and it is the half that still runs
    // when LEGAL_ACCURACY is off.
    const [result, factFindings] = await Promise.all([
      runLegalCheck(text, { tenantId }).catch(() => null),
      runLegalFactChecks(text, { tenantId }).catch(() => []),
    ]);
    // Not gated on `result`: the authority loop returning null means it could
    // not run, which says nothing about the fact checks that did.
    for (const f of [...(result?.findings ?? []), ...factFindings]) {
      findings.push({
        ...f,
        fingerprint: `image:${i}:${f.fingerprint}`,
        title: `[Image ${i + 1}] ${f.title}`,
      });
    }
  }
  return findings;
}
