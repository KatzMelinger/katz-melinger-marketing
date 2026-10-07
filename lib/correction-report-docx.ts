/**
 * The correction report (Diana's Oct 6 spec, Task 23): one Word document per
 * draft listing every correction the system made (original, corrected, reason,
 * source, date) and every open decision, so Diana can send it to Kenneth or
 * the reviewing attorney. Word rather than a Google Doc (Kenneth, 2026-10-07):
 * the app already writes .docx, and Drive opens it as a Google Doc on upload.
 */
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

import type { FixChange } from "./legal-fix-log";
import type { StoredFinding } from "./content-findings";

export type CorrectionReportInput = {
  title: string;
  status: string;
  reviewer: string | null;
  changes: FixChange[];
  decisions: StoredFinding[];
  reviewedAt: string | null;
  generatedAt: string;
};

const label = (s: string, v: string) =>
  new Paragraph({ children: [new TextRun({ text: `${s}: `, bold: true }), new TextRun({ text: v })] });

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" }) : "");

export async function buildCorrectionReport(r: CorrectionReportInput): Promise<Buffer> {
  const live = r.changes.filter((c) => !c.undone_at);
  const children: Paragraph[] = [
    new Paragraph({ text: `Correction report: ${r.title}`, heading: HeadingLevel.TITLE }),
    label("Status", r.status),
    label("Reviewing attorney", r.reviewer ?? "not assigned"),
    label("Report date", day(r.generatedAt)),
    label("Corrections", `${live.length}${r.reviewedAt ? ` (marked reviewed ${day(r.reviewedAt)})` : " (not yet marked reviewed)"}`),
    label("Open decisions", String(r.decisions.length)),
    new Paragraph({ text: "Corrections made", heading: HeadingLevel.HEADING_1 }),
  ];
  if (!live.length) children.push(new Paragraph({ text: "None." }));
  live.forEach((c, i) => {
    children.push(
      new Paragraph({ text: `${i + 1}. ${c.where || "Body"}`, heading: HeadingLevel.HEADING_3 }),
      label("Original", c.from || "(nothing; text added)"),
      label("Corrected", c.to || "(removed)"),
      label("Reason", c.reason),
      label("Source", `${c.source}${c.source_ref ? ` (${c.source_ref})` : ""}`),
      label("Date", day(c.at)),
    );
  });
  children.push(new Paragraph({ text: "Needs a decision", heading: HeadingLevel.HEADING_1 }));
  if (!r.decisions.length) children.push(new Paragraph({ text: "None." }));
  r.decisions.forEach((f, i) => {
    children.push(
      new Paragraph({ text: `${i + 1}. ${f.title}`, heading: HeadingLevel.HEADING_3 }),
      ...(f.excerpt ? [label("Text", f.excerpt)] : []),
      ...(f.detail ? [label("Why", f.detail)] : []),
      label("Severity", f.severity),
      ...(f.resolutionNote ? [label("Status", f.resolutionNote)] : []),
    );
  });
  const doc = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}
