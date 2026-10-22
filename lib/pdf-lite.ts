/**
 * A small PDF writer for tables (Oct 20 spec, Task A19: the Needs callback
 * list as a PDF to hand to whoever makes the calls). Landscape letter pages,
 * Helvetica, a title and header lines, a table with a repeated column header,
 * page numbers and a footer. No dependencies: the standard fonts need no
 * embedding, so the file stays a few kilobytes.
 *
 * Text is WinAnsi: characters outside it are replaced with "?".
 */

export type PdfTable = {
  title: string;
  headerLines: string[];
  columns: { label: string; width: number }[];
  rows: string[][];
  footer: string;
};

const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 36;
const ROW_H = 16;

/** Escape for a PDF string literal and keep to WinAnsi. */
function pdfText(s: string): string {
  const winAnsi = s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
  return winAnsi.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Cut a cell to fit its column (Helvetica averages about 0.5em per character). */
function fit(s: string, width: number, size: number): string {
  const max = Math.max(3, Math.floor(width / (size * 0.5)));
  return s.length > max ? `${s.slice(0, max - 1)}.` : s;
}

export function tableToPdf(t: PdfTable): Buffer {
  const pages: string[] = [];
  const firstRows = Math.floor((PAGE_H - MARGIN * 2 - 70 - t.headerLines.length * 13) / ROW_H) - 1;
  const otherRows = Math.floor((PAGE_H - MARGIN * 2 - 30) / ROW_H) - 1;
  const chunks: string[][][] = [];
  let i = 0;
  while (i < t.rows.length || chunks.length === 0) {
    const n = chunks.length === 0 ? firstRows : otherRows;
    chunks.push(t.rows.slice(i, i + n));
    i += n;
  }
  const total = chunks.length;
  chunks.forEach((rows, p) => {
    const ops: string[] = [];
    const text = (x: number, y: number, size: number, bold: boolean, s: string) =>
      ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${pdfText(s)}) Tj ET`);
    let y = PAGE_H - MARGIN;
    if (p === 0) {
      text(MARGIN, y - 14, 16, true, t.title);
      y -= 34;
      for (const h of t.headerLines) {
        text(MARGIN, y, 10, false, h);
        y -= 13;
      }
      y -= 8;
    }
    // Column header with a rule under it.
    let x = MARGIN;
    for (const c of t.columns) {
      text(x, y - 11, 8, true, c.label.toUpperCase());
      x += c.width;
    }
    ops.push(`0.6 w ${MARGIN} ${(y - 15).toFixed(1)} m ${PAGE_W - MARGIN} ${(y - 15).toFixed(1)} l S`);
    y -= ROW_H + 2;
    for (const r of rows) {
      x = MARGIN;
      r.forEach((cell, ci) => {
        const c = t.columns[ci];
        text(x, y - 11, 9, false, fit(cell ?? "", c.width - 4, 9));
        x += c.width;
      });
      ops.push(`0.2 w 0.85 G ${MARGIN} ${(y - 15).toFixed(1)} m ${PAGE_W - MARGIN} ${(y - 15).toFixed(1)} l S 0 G`);
      y -= ROW_H;
    }
    if (rows.length === 0) text(MARGIN, y - 11, 10, false, "Nobody is waiting on a callback.");
    text(MARGIN, MARGIN - 14, 8, false, `${t.footer}   Page ${p + 1} of ${total}`);
    pages.push(ops.join("\n"));
  });

  // Objects: 1 catalog, 2 pages, 3 F1, 4 F2, then a page and its content per page.
  const objs: string[] = [];
  const kids = pages.map((_, n) => `${5 + n * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  pages.forEach((content, n) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + n * 2} 0 R >>`);
    const bytes = Buffer.byteLength(content, "latin1");
    objs.push(`<< /Length ${bytes} >>\nstream\n${content}\nendstream`);
  });

  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objs.forEach((o, n) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${n + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
