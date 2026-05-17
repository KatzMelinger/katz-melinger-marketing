/**
 * Generate a .docx Word document from a content draft.
 *
 * Used by the /api/content/drafts/[id]/export-docx route. Returns a Buffer
 * the route can stream as the response body with a download header.
 *
 * Markdown handling:
 *   - Block-level: # / ## / ###, "- " / "* " bullets, "1. " numbered lists
 *   - Inline: **bold**, *italic*, `code`
 *   - Horizontal rule: "---" or "***" alone on a line
 *   - Literal "\n" escape sequences (e.g. from JSON-stringified bodies) are
 *     converted to real newlines before splitting into lines
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

/**
 * Parses inline markdown markers (**bold**, *italic*, `code`) into a list of
 * TextRun children with the right run properties. Falls back to a single
 * plain run if no markers are found.
 */
function inlineRuns(text: string): TextRun[] {
  if (!text) return [new TextRun({ text: "" })];

  // Tokenize on **bold**, *italic*, `code`. Order matters — ** before *.
  const tokens: TextRun[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("**", i)) {
      const close = text.indexOf("**", i + 2);
      if (close !== -1) {
        tokens.push(new TextRun({ text: text.slice(i + 2, close), bold: true }));
        i = close + 2;
        continue;
      }
    }
    if (text[i] === "*") {
      const close = text.indexOf("*", i + 1);
      if (close !== -1 && close !== i + 1) {
        tokens.push(new TextRun({ text: text.slice(i + 1, close), italics: true }));
        i = close + 1;
        continue;
      }
    }
    if (text[i] === "`") {
      const close = text.indexOf("`", i + 1);
      if (close !== -1 && close !== i + 1) {
        tokens.push(
          new TextRun({
            text: text.slice(i + 1, close),
            font: "Consolas",
          }),
        );
        i = close + 1;
        continue;
      }
    }
    // Accumulate plain text until the next marker.
    let next = text.length;
    for (const marker of ["**", "*", "`"]) {
      const idx = text.indexOf(marker, i);
      if (idx !== -1 && idx < next) next = idx;
    }
    if (next > i) {
      tokens.push(new TextRun({ text: text.slice(i, next) }));
      i = next;
    } else {
      // Stray marker at position i with no close — emit literally and advance.
      tokens.push(new TextRun({ text: text[i] }));
      i += 1;
    }
  }
  return tokens.length > 0 ? tokens : [new TextRun({ text: "" })];
}

function lineToParagraph(line: string): Paragraph {
  const trimmed = line.replace(/\s+$/, "");

  // Horizontal rule
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed.trim())) {
    return new Paragraph({
      border: {
        bottom: {
          color: "BBBBBB",
          space: 1,
          style: "single",
          size: 6,
        },
      },
      children: [new TextRun({ text: "" })],
    });
  }
  if (trimmed.startsWith("### ")) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_3,
      children: inlineRuns(trimmed.slice(4)),
    });
  }
  if (trimmed.startsWith("## ")) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: inlineRuns(trimmed.slice(3)),
    });
  }
  if (trimmed.startsWith("# ")) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: inlineRuns(trimmed.slice(2)),
    });
  }
  if (/^[-*]\s+/.test(trimmed)) {
    return new Paragraph({
      bullet: { level: 0 },
      children: inlineRuns(trimmed.replace(/^[-*]\s+/, "")),
    });
  }
  if (/^\d+\.\s+/.test(trimmed)) {
    return new Paragraph({
      numbering: { reference: "default-numbering", level: 0 },
      children: inlineRuns(trimmed.replace(/^\d+\.\s+/, "")),
    });
  }
  // Bare line that looks like a markdown-bolded standalone label
  // (e.g. **Section Heading**) — treat as a heading-2.
  const boldOnly = trimmed.match(/^\*\*(.+)\*\*$/);
  if (boldOnly) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: boldOnly[1], bold: true })],
    });
  }
  return new Paragraph({
    children: inlineRuns(trimmed),
  });
}

export async function buildDraftDocx(draft: DraftForExport): Promise<Buffer> {
  // Bodies that came from a JSON-stringified Claude response can contain
  // literal `\n` and `\"` escape sequences instead of real newlines. Decode
  // them before splitting so the markdown renderer sees actual line breaks.
  const decoded = (draft.body ?? "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "  ")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'");

  const lines = decoded.split(/\r?\n/);
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
