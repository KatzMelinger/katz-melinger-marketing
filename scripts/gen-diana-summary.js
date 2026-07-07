const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, Header, Footer,
} = require("docx");

const ACCENT = "1F4E79";
const LIGHT = "EAF1FA";
const GREY = "F2F2F2";
const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };

const P = (text, opts = {}) =>
  new Paragraph({ spacing: { after: 120 }, ...opts, children: [new TextRun({ text, ...(opts.run || {}) })] });

const bullet = (text, runs) =>
  new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 80 },
    children: runs || [new TextRun(text)],
  });

const num = (text) =>
  new Paragraph({
    numbering: { reference: "numbers", level: 0 },
    spacing: { after: 80 },
    children: [new TextRun(text)],
  });

const runs = (...parts) =>
  new Paragraph({ spacing: { after: 80 }, children: parts.map((p) =>
    typeof p === "string" ? new TextRun(p) : new TextRun(p)) });

const b = (t) => ({ text: t, bold: true });

function cell(text, { width, head = false, fill, bold = false } = {}) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: fill || (head ? ACCENT : "FFFFFF"), type: ShadingType.CLEAR },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: head || bold, color: head ? "FFFFFF" : "000000", size: 20 })],
      }),
    ],
  });
}

function table(headers, rows, widths) {
  const total = widths.reduce((a, c) => a + c, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => cell(h, { width: widths[i], head: true })),
      }),
      ...rows.map((r, ri) =>
        new TableRow({
          children: r.map((c, i) =>
            cell(c, { width: widths[i], fill: ri % 2 ? GREY : "FFFFFF" })),
        })
      ),
    ],
  });
}

const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const spacer = () => new Paragraph({ spacing: { after: 120 }, children: [] });

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 30, bold: true, font: "Arial", color: ACCENT },
        paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Arial", color: "000000" },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [
      { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•",
        alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 600, hanging: 280 } } } }] },
      { reference: "numbers", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.",
        alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 600, hanging: 280 } } } }] },
    ],
  },
  sections: [
    {
      properties: {
        page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "Diana review summary — prepared for Kenneth Katz — page ", size: 16, color: "888888" }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "888888" }),
            ],
          })],
        }),
      },
      children: [
        new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: "Diana’s Review — Analysis & WordPress Decision", bold: true, size: 36, color: ACCENT })],
        }),
        new Paragraph({
          spacing: { after: 240 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 4 } },
          children: [new TextRun({ text: "MarketOS / Huraqan  ·  June 22, 2026  ·  Status: analysis complete, no code written yet", italics: true, size: 20, color: "555555" })],
        }),

        // INTRO
        P("This summarizes the full review of everything Diana sent on June 22, plus the WordPress publishing decision we worked through. Nothing has been built yet — this is the analysis and the recommended path so you can review it before any code is written."),

        // 1. WHAT DIANA ASKED FOR
        H1("1.  What Diana asked for"),
        P("Her message bundled four separate pieces of work:"),
        num("Content Production — the “Copy” button on a draft has no metadata. She wants copy that includes the metadata, attorney-advertising compliance applied automatically, a “Next” button that carries everything into the full draft, then “Approve,” then a real publish to WordPress."),
        num("Put “Opportunities” back in the Overview main tab “as before.”"),
        num("A new “Canonical Content Registry” — a background layer that tracks every keyword, draft, and published page and blocks duplicates before new content is created (a 5-task spec)."),
        num("Two Social Media bugs: (a) “Create post” opens the wrong tab; (b) generated content is a dead end with nowhere to go — she wants a Metricool-style composer with live preview that schedules onto a weekly calendar."),
        spacer(),
        new Paragraph({
          shading: { fill: LIGHT, type: ShadingType.CLEAR },
          spacing: { before: 80, after: 80 },
          border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 10 } },
          children: [new TextRun({ text: "Worth knowing: the two screenshots Diana sent are a mock-up of the target design (you can see the chat box at the bottom), not the current build. The tabbed “Social Ops Hub” with a calendar and composer doesn’t exist yet — building it is essentially the social-media plan we’d already drafted.", italics: true, size: 20 })],
        }),

        // 2. STATUS & SIZING
        H1("2.  Status and size of each piece"),
        P("After auditing the actual code, here is where each request stands:"),
        table(
          ["Request", "Reality today", "Effort"],
          [
            ["Draft copy + metadata + auto-compliance + Next/Approve", "Metadata, compliance check, and the approval stage bar all already exist; the Copy button just ignores them. Mostly assembly.", "Small"],
            ["Publish to WordPress", "Currently a stub — it only changes a status label, no real publish. This is the one genuinely new build (see section 3).", "Medium"],
            ["Opportunities back in Overview", "Three possible “Overview” screens; can’t tell which she means. Small once clarified.", "Small — blocked on Diana"],
            ["Canonical Content Registry", "~70% of the parts already exist (keyword matching, clustering, overlap detection, the three entry points, a placeholder “Issues to fix” box).", "Medium"],
            ["Social bug #1 (wrong tab)", "Confirmed one-line fix.", "Trivial"],
            ["Social bug #2 (composer + calendar)", "The composer, live preview, and weekly calendar genuinely don’t exist. This is the largest item — the Metricool replacement.", "Large"],
          ],
          [3000, 4600, 1760]
        ),

        // 3. WORDPRESS DECISION
        H1("3.  The WordPress publishing decision"),
        P("Diana wants “Approve → publish to WordPress” to actually work. The key question we worked through: does the firm have to set something up on WordPress, or does it all go through our system?"),

        H2("What we already have"),
        P("There is already an authenticated connection into katzmelinger.com — a custom “KM AutoPilot” WordPress plugin that we control (its source lives in our own codebase). It logs in with a token we issue, runs inside WordPress, and every 15 minutes pulls approved changes from our dashboard and applies them. Today it only updates SEO fields on existing pages — it does not yet publish new blog posts. Because it runs inside WordPress and only calls out to us, it never touches WordPress’s public API and is not affected by the site’s security plugin (Wordfence)."),

        H2("Two ways to publish new posts"),
        table(
          ["", "Option A — Extend the plugin we already have", "Option B — WordPress “Application Password”"],
          [
            ["Login", "Reuses the token we already issue", "Needs a new password generated in WordPress"],
            ["Security plugin (Wordfence)", "Avoids it entirely", "Wordfence is currently blocking it; must be re-enabled, plus likely a firewall allow-list"],
            ["Speed", "Pull — up to ~15 min (adjustable), plus a manual “Sync now” button", "Push — near-instant"],
            ["Work involved", "Add a “publish post” job on our side + update the plugin on the site", "Build a publisher on our side; no plugin change"],
          ],
          [1900, 3730, 3730]
        ),
        spacer(),
        new Paragraph({
          shading: { fill: LIGHT, type: ShadingType.CLEAR },
          spacing: { before: 80, after: 80 },
          border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 10 } },
          children: [
            new TextRun({ text: "Recommendation: ", bold: true, size: 22, color: ACCENT }),
            new TextRun({ text: "go with Option A (extend the plugin we already have). Wordfence is already blocking the Application-Password route, and Option A sidesteps that completely by reusing the connection we already control. A blog post doesn’t need to publish instantly — a 15-minute cycle plus a “Sync now” button is fine.", size: 22 }),
          ],
        }),

        H2("What metadata we already store (and would publish)"),
        P("Each draft already carries: page title, body, URL slug, primary and secondary keywords, meta title and meta description, internal links, and the practice-area pillar. Title, body, and slug publish cleanly either way. The SEO meta title/description need one small one-time snippet on the site to sync automatically — otherwise everything else still publishes."),

        H2("The one thing to confirm"),
        P("Is the KM AutoPilot plugin actually installed and switched on at katzmelinger.com right now, with a token configured? If yes, Option A is mostly our-side work plus a plugin update. If it isn’t installed, we’d be installing it anyway — the same step under either option."),

        // 4. OPEN DECISIONS
        H1("4.  What I need from you to move forward"),
        bullet(null, [new TextRun({ text: "Diana: ", bold: true }), new TextRun("which “Overview” she means for “put Opportunities back as before” (you’re checking).")]),
        bullet(null, [new TextRun({ text: "WordPress: ", bold: true }), new TextRun("confirm whether the KM AutoPilot plugin is live on the site, and a yes/no on Option A vs Option B.")]),
        bullet(null, [new TextRun({ text: "Publish behavior: ", bold: true }), new TextRun("when a post is approved, should it go live immediately, or land as a WordPress draft for a final human glance first? (I’d suggest “draft” for the first few weeks, then switch to live.)")]),

        // 5. BUILD ORDER
        H1("5.  Recommended build order (once approved)"),
        num("Quick wins — the wrong-tab fix, plus metadata-included copy and auto-compliance on drafts."),
        num("WordPress publishing — via the plugin (Option A), once confirmed."),
        num("Canonical Content Registry — the duplicate-prevention layer (touches the most places, saves wasted drafts)."),
        num("Social composer + weekly calendar — the largest piece, the Metricool replacement."),
        num("Opportunities placement — slot in as soon as Diana clarifies (small)."),
        spacer(),
        new Paragraph({
          spacing: { before: 200 },
          children: [new TextRun({ text: "Reference docs in the project: diana-review-plan.md (full plan), wordpress-setup.md (WordPress steps), social-hub-plan.md (the social/calendar build).", italics: true, size: 18, color: "777777" })],
        }),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync("Diana-Review-Summary.docx", buf);
  console.log("wrote Diana-Review-Summary.docx (" + buf.length + " bytes)");
});
