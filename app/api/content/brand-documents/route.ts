import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";

import {
  getLatestBrandProfile,
  insertBrandDocument,
  listBrandDocuments,
  recomputeAndSaveBrandProfile,
  type BrandDocumentType,
} from "@/lib/content-brand-voice";

type PdfParseCtor = new (opts: { data: Buffer }) => {
  getText: () => Promise<{ text?: string }>;
  destroy: () => Promise<void> | void;
};

async function loadPdfParse(): Promise<
  | { ok: true; PDFParse: PdfParseCtor }
  | { ok: false; error: string }
> {
  try {
    const specifier = "pdf-parse";
    const mod = (await import(/* webpackIgnore: true */ specifier)) as {
      PDFParse?: PdfParseCtor;
    };
    if (!mod.PDFParse) {
      return { ok: false, error: "pdf-parse module is missing PDFParse export." };
    }
    return { ok: true, PDFParse: mod.PDFParse };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? `pdf-parse is not available: ${e.message}`
          : "pdf-parse is not available in this deployment.",
    };
  }
}

export const dynamic = "force-dynamic";

function isPdfFile(file: File): boolean {
  const byType = file.type.toLowerCase() === "application/pdf";
  const byName = file.name.toLowerCase().endsWith(".pdf");
  return byType || byName;
}

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
      { error: "No files uploaded. Attach one or more PDF files." },
      { status: 400 },
    );
  }

  const accepted = files.filter(isPdfFile);
  if (!accepted.length) {
    return NextResponse.json(
      { error: "Only PDF files are supported." },
      { status: 400 },
    );
  }

  const uploaded: Array<{ filename: string; chars: number }> = [];
  const failures: Array<{ filename: string; error: string }> = [];

  const pdfModule = await loadPdfParse();
  if (!pdfModule.ok) {
    return NextResponse.json(
      {
        ok: false,
        uploaded,
        failures: accepted.map((file) => ({ filename: file.name, error: pdfModule.error })),
        profile: await getLatestBrandProfile(),
        message: pdfModule.error,
      },
      { status: 503 },
    );
  }

  for (const file of accepted) {
    try {
      const arr = await file.arrayBuffer();
      const parser = new pdfModule.PDFParse({ data: Buffer.from(arr) });
      const parsed = await parser.getText();
      await parser.destroy();
      const text = (parsed.text ?? "").trim();
      if (!text) {
        failures.push({ filename: file.name, error: "No extractable text found in PDF." });
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
      uploaded.push({ filename: file.name, chars: text.length });
    } catch (e) {
      failures.push({
        filename: file.name,
        error: e instanceof Error ? e.message : "Failed to process PDF.",
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
          ? `Processed ${uploaded.length} PDF file(s) for ${documentType} voice training.`
          : "No files were processed successfully.",
    },
    { status },
  );
}
