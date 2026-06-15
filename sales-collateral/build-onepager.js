const path = require("path");
const fs = require("fs");
const GNM = process.env.GNM;
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign } = require(path.join(GNM, "docx"));

const NAVY = "0E2240";
const GOLD = "B0892F";
const INK = "1A2233";
const MUTED = "5C6B7E";
const ICE = "EEF2F8";
const LINE = "D5DEEA";
const HF = "Georgia";
const BF = "Calibri";

const CONTENT_W = 12240 - 1440; // 0.5" margins => 10800

const noBorder = { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } };

function spacer(h) { return new Paragraph({ spacing: { before: 0, after: h }, children: [new TextRun("")] }); }

function sectionHeading(txt) {
  return new Paragraph({
    spacing: { before: 220, after: 90 },
    children: [
      new TextRun({ text: "■ ", font: BF, size: 18, color: GOLD }),
      new TextRun({ text: txt.toUpperCase(), font: BF, size: 19, bold: true, color: NAVY, characterSpacing: 30 }),
    ],
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 4 } },
  });
}

function bodyPara(txt, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after != null ? opts.after : 100 },
    children: Array.isArray(txt) ? txt : [new TextRun({ text: txt, font: BF, size: 20, color: INK })],
  });
}

// Feature cell for the 2-col capability grid
function featureCell(title, body) {
  return new TableCell({
    width: { size: CONTENT_W / 2, type: WidthType.DXA },
    margins: { top: 100, bottom: 100, left: 160, right: 160 },
    shading: { fill: ICE, type: ShadingType.CLEAR },
    borders: { top: { style: BorderStyle.SINGLE, size: 8, color: "FFFFFF" }, bottom: { style: BorderStyle.SINGLE, size: 8, color: "FFFFFF" }, left: { style: BorderStyle.SINGLE, size: 8, color: "FFFFFF" }, right: { style: BorderStyle.SINGLE, size: 8, color: "FFFFFF" } },
    children: [
      new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: title, font: HF, size: 21, bold: true, color: NAVY })] }),
      new Paragraph({ children: [new TextRun({ text: body, font: BF, size: 17, color: INK })] }),
    ],
  });
}

function featureGrid(pairs) {
  const rows = [];
  for (let i = 0; i < pairs.length; i += 2) {
    rows.push(new TableRow({ children: [
      featureCell(pairs[i][0], pairs[i][1]),
      pairs[i + 1] ? featureCell(pairs[i + 1][0], pairs[i + 1][1]) : new TableCell({ width: { size: CONTENT_W / 2, type: WidthType.DXA }, borders: noBorder, children: [new Paragraph("")] }),
    ] }));
  }
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: [CONTENT_W / 2, CONTENT_W / 2], borders: noBorder, rows });
}

// ---------- HEADER BLOCK (navy banner via single-cell shaded table) ----------
const headerTable = new Table({
  width: { size: CONTENT_W, type: WidthType.DXA },
  columnWidths: [CONTENT_W],
  borders: noBorder,
  rows: [new TableRow({ children: [new TableCell({
    width: { size: CONTENT_W, type: WidthType.DXA },
    margins: { top: 220, bottom: 220, left: 260, right: 260 },
    shading: { fill: NAVY, type: ShadingType.CLEAR },
    borders: noBorder,
    children: [
      new Paragraph({ spacing: { after: 30 }, children: [new TextRun({ text: "MARKETING INTELLIGENCE PLATFORM", font: BF, size: 16, bold: true, color: GOLD, characterSpacing: 40 })] }),
      new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: "MarketOS", font: HF, size: 52, bold: true, color: "FFFFFF" })] }),
      new Paragraph({ children: [new TextRun({ text: "The marketing command center built for law firms.", font: BF, size: 24, color: "CADCFC" })] }),
    ],
  })] })],
});

// ---------- INTEGRATIONS chip line ----------
const tools = ["Claude AI", "Semrush", "Search Console", "Google Analytics 4", "CallRail", "Ayrshare", "Constant Contact", "Google Business Profile"];

const doc = new Document({
  creator: "Katz Melinger",
  styles: { default: { document: { run: { font: BF, size: 20, color: INK } } } },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 720, right: 720, bottom: 600, left: 720 } } },
    children: [
      headerTable,
      spacer(120),

      // Intro / value prop
      new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({ text: "Law-firm marketing lives in a dozen disconnected tools, no one can prove what ad spend turned into clients, and every post carries ethics risk. ", font: BF, size: 20, color: INK }),
          new TextRun({ text: "MarketOS unifies it all", font: BF, size: 20, bold: true, color: NAVY }),
          new TextRun({ text: " — SEO, content, paid ads, reputation, and lead response — into one command center, with full-funnel attribution and bar-compliance built in.", font: BF, size: 20, color: INK }),
        ],
      }),

      // Full funnel line
      sectionHeading("The whole funnel, end to end"),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 40, after: 40 },
        children: [new TextRun({ text: "Spend   ›   Sessions   ›   Calls   ›   Intakes   ›   Matters   ›   Revenue", font: HF, size: 24, bold: true, color: NAVY })],
      }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "Attribution connects every marketing dollar to revenue — automatically, no spreadsheets.", font: BF, size: 18, italic: true, color: MUTED })] }),

      // Capabilities grid
      sectionHeading("Everything your marketing runs on"),
      featureGrid([
        ["SEO & Content", "AI-drafted blogs, emails, and social posts; live keyword rank tracking; and technical SEO audits."],
        ["Paid Ads & Lead Gen", "Multi-channel campaigns, call tracking, web forms, and a managed sales pipeline in one view."],
        ["AI Visibility (AEO)", "Track and grow your share of voice across ChatGPT, Claude, Perplexity, and Gemini."],
        ["Reputation & Social", "Review monitoring and request automation, plus social publishing and analytics."],
        ["Intelligence", "Full-funnel reporting, cross-channel correlation, and AI-prioritized recommendations."],
        ["Compliance", "Every outbound asset is screened against NY / NJ bar rules before it publishes."],
      ]),
      spacer(80),

      // Differentiator: compliance
      sectionHeading("Compliance built in, not bolted on"),
      bodyPara([
        new TextRun({ text: "Generic marketing tools don’t know a bar rule from a banner ad. ", font: BF, size: 20, color: INK }),
        new TextRun({ text: "MarketOS scores every ad, post, GBP reply, and draft against NY / NJ attorney-advertising rules", font: BF, size: 20, bold: true, color: NAVY }),
        new TextRun({ text: " and flags specific issues before anything goes public — and the autonomous content agent will not publish anything that fails the check.", font: BF, size: 20, color: INK }),
      ], { after: 80 }),

      // Why us
      sectionHeading("Why MarketOS"),
      ...[
        ["Built by practitioners, not vendors.", " Designed inside a working plaintiff-side employment firm — it speaks legal marketing and ethics natively."],
        ["Best-in-class data, unified.", " Connects the tools you already trust instead of replacing them with something weaker."],
        ["AI where it earns its keep.", " Drafting, prioritized recommendations, and compliance — the work that actually moves the needle."],
      ].map(([b, t]) => new Paragraph({
        spacing: { after: 70 },
        bullet: { level: 0 },
        children: [new TextRun({ text: b, font: BF, size: 20, bold: true, color: NAVY }), new TextRun({ text: t, font: BF, size: 20, color: INK })],
      })),
      spacer(60),
      new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: "WORKS WITH THE STACK YOU ALREADY USE", font: BF, size: 15, bold: true, color: MUTED, characterSpacing: 30 })] }),
      new Paragraph({ children: [new TextRun({ text: tools.join("    •    "), font: BF, size: 18, bold: true, color: NAVY })] }),

      // CTA footer
      spacer(140),
      new Table({
        width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: [CONTENT_W], borders: noBorder,
        rows: [new TableRow({ children: [new TableCell({
          width: { size: CONTENT_W, type: WidthType.DXA }, margins: { top: 160, bottom: 160, left: 260, right: 260 },
          shading: { fill: NAVY, type: ShadingType.CLEAR }, borders: noBorder, verticalAlign: VerticalAlign.CENTER,
          children: [
            new Paragraph({ spacing: { after: 30 }, children: [new TextRun({ text: "Stop juggling tools. Start compounding growth.", font: HF, size: 26, bold: true, color: "FFFFFF" })] }),
            new Paragraph({ children: [
              new TextRun({ text: "Book a 30-minute demo:  ", font: BF, size: 20, color: "CADCFC" }),
              new TextRun({ text: "kjkatz@katzmelinger.com", font: BF, size: 20, bold: true, color: GOLD }),
              new TextRun({ text: "      MarketOS by Katz Melinger PLLC", font: BF, size: 18, color: "8FA2BE" }),
            ] }),
          ],
        })] })],
      }),
    ],
  }],
});

Packer.toBuffer(doc).then(buf => { fs.writeFileSync(path.join(__dirname, "MarketOS-One-Pager.docx"), buf); console.log("WROTE one-pager"); });
