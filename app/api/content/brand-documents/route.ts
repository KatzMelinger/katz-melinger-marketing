/**
 * Brand-voice document uploads.
 *
 * Accepts .pdf, .docx, .txt, .md, .rtf, .html (see lib/document-extract.ts).
 * Each uploaded file is parsed to plain text, stored as a brand_voice_document
 * row, and then the brand profile is recomputed from the new corpus.
 */

import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";

import {
  getLatestBrandProfile,
  insertBrandDocument,
  listBrandDocuments,
  recomputeAndSaveBrandProfile,
  type BrandDocumentType,
} from "@/lib/content-brand-voice";
import {
  extractText,
  isSupportedUpload,
  SUPPORTED_UPLOAD_EXTENSIONS,
} from "@/lib/document-extract";

export const dynamic = "force-dynamic";

function parseDocumentType(value: FormDataEntryValue | null): BrandDocumentType {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return raw === "sample" ? "sample" : "brand";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const typeRaw = searchParams.get("type");
  const type = typeRaw === "brand" || typeRaw === "sample" ? typeRaw : undefined;
  const [documents, profile] = await Promise.all([
    listBrandDocuments(type),
    getLatestBrandProfile(),
  ]);
  return NextResponse.json({ documents, profile });
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data." }, { status: 400 });
  }

  const documentType = parseDocumentType(form.get("documentType"));
  const files = form
    .getAll("files")
    .filter((v): v is File => typeof File !== "undefined" && v instanceof File);

  if (!files.length) {
    return NextResponse.json(
      {
        error: `No files uploaded. Attach one or more files (${SUPPORTED_UPLOAD_EXTENSIONS.join(", ")}).`,
      },
      { status: 400 },
    );
  }

  const accepted = files.filter((f) => isSupportedUpload(f.name));
  const rejectedForType = files
    .filter((f) => !isSupportedUpload(f.name))
    .map((f) => ({
      filename: f.name,
      error: `Unsupported file type. Supported: ${SUPPORTED_UPLOAD_EXTENSIONS.join(", ")}.`,
    }));

  if (!accepted.length) {
    return NextResponse.json(
      {
        error: `No supported files found. Supported: ${SUPPORTED_UPLOAD_EXTENSIONS.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  const uploaded: Array<{ filename: string; chars: number; format: string }> = [];
  const failures: Array<{ filename: string; error: string }> = [...rejectedForType];

  for (const file of accepted) {
    try {
      const arr = await file.arrayBuffer();
      const extracted = await extractText({
        filename: file.name,
        buffer: Buffer.from(arr),
      });
      const text = (extracted.text ?? "").trim();
      if (!text) {
        failures.push({
          filename: file.name,
          error: "No extractable text found in file.",
        });
        continue;
      }
      const saved = await insertBrandDocument({
        filename: file.name,
        documentType,
        extractedText: text,
      });
      if (!saved.ok) {
        failures.push({
          filename: file.name,
          error: saved.error ?? "Could not save extracted text.",
        });
        continue;
      }
      uploaded.push({ filename: file.name, chars: text.length, format: extracted.format });
    } catch (e) {
      failures.push({
        filename: file.name,
        error: e instanceof Error ? e.message : "Failed to process file.",
      });
    }
  }

  let profile = await getLatestBrandProfile();
  if (uploaded.length > 0) {
    const recomputed = await recomputeAndSaveBrandProfile();
    if (recomputed.ok && recomputed.profile) {
      profile = recomputed.profile;
    }
  }

  const status = uploaded.length > 0 ? 200 : 400;
  return NextResponse.json(
    {
      ok: uploaded.length > 0,
      uploaded,
      failures,
      profile,
      message:
        uploaded.length > 0
          ? `Processed ${uploaded.length} file(s) for ${documentType} voice training.`
          : "No files were processed successfully.",
    },
    { status },
  );
}
