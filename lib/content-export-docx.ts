/**
 * Generate a .docx Word document from a content draft.
 *
 * Used by the /api/content/drafts/[id]/export-docx route. Returns a Buffer
 * the route can stream as the response body with a download header.
 */

import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

export type DraftForExport = {
  format: string;
  topic: string;
  title?: string | null;
  body: string;
  metadata?: Record<string, unknown> | null;
  practiceArea?: string | null;
  createdAt?: string | null;
};

function lineToParagraph(line: string): Paragraph {
  // Rough markdown-ish: lines that start with #, ##, ### get headings; lines
  // starting with "- " or "* " get bullets; everything else is body.
  const trimmed = line.replace(/\s+$/, "");
  if (trimmed.startsWith("### ")) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_3,
      children: [new TextRun({ text: trimmed.slice(4) })],
    });
  }
  if (trimmed.startsWith("## ")) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: trimmed.slice(3) })],
    });
  }
  if (trimmed.startsWith("# ")) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: trimmed.slice(2) })],
    });
  }
  if (/^[-*]\s+/.test(trimmed)) {
    return new Paragraph({
      bullet: { level: 0 },
      children: [new TextRun({ text: trimmed.replace(/^[-*]\s+/, "") })],
    });
  }
  if (/^\d+\.\s+/.test(trimmed)) {
    return new Paragraph({
      numbering: { reference: "default-numbering", level: 0 },
      children: [new TextRun({ text: trimmed.replace(/^\d+\.\s+/, "") })],
    });
  }
  return new Paragraph({
    children: [new TextRun({ text: trimmed })],
  });
}

export async function buildDraftDocx(draft: DraftForExport): Promise<Buffer> {
  const lines = (draft.body ?? "").split(/\r?\n/);
  const bodyParagraphs = lines.map(lineToParagraph);

  const headerChildren: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: draft.title || draft.topic, bold: true })],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: [
            draft.format ? `Format: ${draft.format}` : "",
            draft.practiceArea ? `Practice area: ${draft.practiceArea}` : "",
            draft.createdAt ? `Generated: ${new Date(draft.createdAt).toLocaleString()}` : "",
          ]
            .filter(Boolean)
            .join("  ·  "),
          italics: true,
          size: 18,
          color: "666666",
        }),
      ],
    }),
    new Paragraph({ text: "" }),
  ];

  const subjectLine =
    typeof draft.metadata?.subject === "string" && draft.metadata.subject
      ? [
          new Paragraph({
            children: [
              new TextRun({ text: "Subject: ", bold: true }),
              new TextRun({ text: draft.metadata.subject as string }),
            ],
          }),
          new Paragraph({ text: "" }),
        ]
      : [];

  const doc = new Document({
    creator: "Katz Melinger Marketing",
    title: draft.title || draft.topic,
    description: `Generated content for ${draft.format}`,
    numbering: {
      config: [
        {
          reference: "default-numbering",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {},
        children: [...headerChildren, ...subjectLine, ...bodyParagraphs],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

export function suggestFilename(draft: DraftForExport): string {
  const topic = (draft.topic || draft.title || "draft")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "draft";
  return `${draft.format}-${topic}.docx`;
}
