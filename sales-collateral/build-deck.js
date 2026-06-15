const path = require("path");
const PptxGenJS = require(path.join(process.env.GNM, "pptxgenjs"));

const pptx = new PptxGenJS();
pptx.defineLayout({ name: "W16x9", width: 13.333, height: 7.5 });
pptx.layout = "W16x9";
pptx.author = "Katz Melinger";
pptx.company = "MarketOS";

// ---- Palette ----
const NAVY = "0E2240";   // deep navy (dominant)
const NAVY2 = "16305A";  // panel navy
const GOLD = "C8A24A";   // accent
const INK = "1A2233";    // body ink on light
const MUTED = "5C6B7E";  // muted slate
const ICE = "EEF2F8";    // light card fill
const ICE2 = "E2E9F3";   // slightly darker panel
const WHITE = "FFFFFF";
const LINE = "D5DEEA";

const HF = "Georgia";    // header font
const BF = "Calibri";    // body font
const W = 13.333, H = 7.5, M = 0.6;
const CW = W - 2 * M;

function kicker(s, txt, color, x) {
  // small gold square motif + letter-spaced label
  const yy = 0.62;
  s.addShape(pptx.ShapeType.rect, { x: x || M, y: yy + 0.02, w: 0.16, h: 0.16, fill: { color: GOLD } });
  s.addText(txt, { x: (x || M) + 0.28, y: yy - 0.05, w: 8, h: 0.32, fontFace: BF, fontSize: 11,
    bold: true, color: color, charSpacing: 3 });
}

function titleLight(s, txt, y) {
  s.addText(txt, { x: M, y: y || 0.98, w: CW, h: 0.9, fontFace: HF, fontSize: 32, bold: true, color: NAVY });
}

function card(s, x, y, w, h, fill) {
  s.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.08,
    fill: { color: fill || ICE }, line: { color: LINE, width: 0.75 } });
}

// ============ SLIDE 1 — TITLE ============
let s = pptx.addSlide();
s.background = { color: NAVY };
// motif: stacked gold squares top-right
for (let i = 0; i < 3; i++) s.addShape(pptx.ShapeType.rect, { x: 12.25 + 0, y: 0.7 + i * 0.34, w: 0.22, h: 0.22, fill: { color: GOLD } });
kicker(s, "MARKETING INTELLIGENCE PLATFORM", GOLD);
s.addText("MarketOS", { x: M, y: 2.35, w: CW, h: 1.3, fontFace: HF, fontSize: 66, bold: true, color: WHITE });
s.addText("The marketing command center built for law firms.", { x: M, y: 3.75, w: 10.5, h: 0.7, fontFace: BF, fontSize: 23, color: "CADCFC" });
s.addText([
  { text: "One platform for SEO, content, paid ads, reputation, and lead response — ", options: {} },
  { text: "with attribution and bar-compliance built in.", options: { color: GOLD, bold: true } },
], { x: M, y: 4.55, w: 10.6, h: 0.8, fontFace: BF, fontSize: 15, color: "AEBED8", lineSpacingMultiple: 1.15 });
s.addText("Built by Katz Melinger PLLC — a firm that runs on it every day.", { x: M, y: 6.55, w: 11, h: 0.4, fontFace: BF, fontSize: 13, italic: true, color: "8FA2BE" });

// ============ SLIDE 2 — PROBLEM ============
s = pptx.addSlide();
s.background = { color: WHITE };
kicker(s, "THE PROBLEM", GOLD);
titleLight(s, "Law-firm marketing is broken into pieces");
s.addText("Growth lives in a dozen logins, no one can prove what ad spend turned into clients, and every post carries ethics risk.",
  { x: M, y: 1.78, w: CW, h: 0.5, fontFace: BF, fontSize: 15, color: MUTED });

const pains = [
  ["Fragmented stack", "SEO, ads, social, reviews, and CRM scattered across 15+ disconnected tools."],
  ["Blind spend", "No line connecting ad dollars to calls, intakes, and signed matters."],
  ["Compliance risk", "Every ad, post, and reply must satisfy NY / NJ attorney-advertising rules."],
  ["Leaking leads", "Missed calls and after-hours intakes slip away before anyone follows up."],
];
const pcw = (CW - 0.4) / 2, pch = 1.92;
pains.forEach((p, i) => {
  const col = i % 2, row = Math.floor(i / 2);
  const x = M + col * (pcw + 0.4), y = 2.45 + row * (pch + 0.32);
  card(s, x, y, pcw, pch);
  s.addShape(pptx.ShapeType.rect, { x, y: y + 0.28, w: 0.09, h: 0.6, fill: { color: GOLD } });
  s.addText(p[0], { x: x + 0.32, y: y + 0.26, w: pcw - 0.6, h: 0.5, fontFace: HF, fontSize: 19, bold: true, color: NAVY });
  s.addText(p[1], { x: x + 0.32, y: y + 0.86, w: pcw - 0.6, h: 0.9, fontFace: BF, fontSize: 14, color: INK, lineSpacingMultiple: 1.1 });
});

// ============ SLIDE 3 — MEET MARKETOS ============
s = pptx.addSlide();
s.background = { color: WHITE };
kicker(s, "THE SOLUTION", GOLD);
titleLight(s, "One platform for everything that brings clients in");
// left text
s.addText("MarketOS unifies the entire marketing operation into a single command center — from the first search impression to the signed retainer.",
  { x: M, y: 2.05, w: 5.6, h: 1.4, fontFace: BF, fontSize: 16, color: INK, lineSpacingMultiple: 1.25 });
s.addText([
  { text: "AI does the heavy lifting", options: { bold: true, color: NAVY } },
  { text: " — drafting content, surfacing prioritized actions, and reviewing every asset for compliance before it ships.", options: {} },
], { x: M, y: 3.6, w: 5.6, h: 1.4, fontFace: BF, fontSize: 16, color: INK, lineSpacingMultiple: 1.25 });
// right panel — 9 departments
const px = 6.6, pw = W - M - px;
card(s, px, 1.95, pw, 4.85, NAVY);
s.addText("NINE DEPARTMENTS, ONE LOGIN", { x: px + 0.35, y: 2.2, w: pw - 0.7, h: 0.35, fontFace: BF, fontSize: 11, bold: true, charSpacing: 2, color: GOLD });
const depts = ["SEO & Content", "On-Page SEO", "Off-Page SEO", "AI Visibility (AEO)", "Local SEO", "Campaigns & Lead Gen", "Social & Reputation", "Intelligence & Attribution", "Workspace & AI Assistant"];
depts.forEach((d, i) => {
  const yy = 2.72 + i * 0.44;
  s.addShape(pptx.ShapeType.rect, { x: px + 0.4, y: yy + 0.07, w: 0.13, h: 0.13, fill: { color: GOLD } });
  s.addText(d, { x: px + 0.68, y: yy - 0.07, w: pw - 1.1, h: 0.4, fontFace: BF, fontSize: 14.5, color: WHITE });
});

// ============ SLIDE 4 — FULL FUNNEL ============
s = pptx.addSlide();
s.background = { color: WHITE };
kicker(s, "ATTRIBUTION", GOLD);
titleLight(s, "See the whole funnel — spend to signed matters");
const stages = ["Spend", "Sessions", "Calls", "Intakes", "Matters", "Revenue"];
const bw = 1.6, bh = 1.15, gap = 0.5, fy = 3.25;
stages.forEach((st, i) => {
  const x = M + i * (bw + gap);
  const isLast = i === stages.length - 1;
  s.addShape(pptx.ShapeType.roundRect, { x, y: fy, w: bw, h: bh, rectRadius: 0.06,
    fill: { color: isLast ? GOLD : NAVY } });
  s.addText(st, { x, y: fy, w: bw, h: bh, align: "center", valign: "middle", fontFace: BF, fontSize: 15, bold: true, color: isLast ? NAVY : WHITE });
  if (i < stages.length - 1) {
    s.addText("›", { x: x + bw, y: fy, w: gap, h: bh, align: "center", valign: "middle", fontFace: BF, fontSize: 30, bold: true, color: GOLD });
  }
});
s.addText("Attribution connects every marketing dollar to revenue — automatically, with no spreadsheets.",
  { x: M, y: fy + bh + 0.55, w: CW, h: 0.5, align: "center", fontFace: BF, fontSize: 16, italic: true, color: MUTED });
s.addText("Pulls live data from Google Analytics, Search Console, CallRail, and your CMS into one connected view.",
  { x: M, y: fy + bh + 1.1, w: CW, h: 0.5, align: "center", fontFace: BF, fontSize: 13, color: MUTED });

// ============ SLIDE 5 — CAPABILITIES ============
s = pptx.addSlide();
s.background = { color: WHITE };
kicker(s, "CAPABILITIES", GOLD);
titleLight(s, "Everything your marketing runs on");
const caps = [
  ["SEO & Content", "AI-drafted blogs, emails & social, keyword rank tracking, and technical SEO audits."],
  ["Paid Ads & Lead Gen", "Multi-channel campaigns, call tracking, web forms, and a managed sales pipeline."],
  ["Reputation & Social", "Review monitoring & requests, plus social publishing and analytics in one place."],
  ["AI Visibility (AEO)", "Track and grow your share of voice across ChatGPT, Claude, Perplexity & Gemini."],
  ["Intelligence", "Full-funnel reporting, cross-channel correlation, and AI-prioritized recommendations."],
  ["Compliance", "Every outbound asset reviewed against NY / NJ bar rules before it publishes."],
];
const ccw = (CW - 2 * 0.35) / 3, cch = 2.18;
caps.forEach((c, i) => {
  const col = i % 3, row = Math.floor(i / 3);
  const x = M + col * (ccw + 0.35), y = 2.0 + row * (cch + 0.3);
  card(s, x, y, ccw, cch);
  s.addShape(pptx.ShapeType.roundRect, { x: x + 0.28, y: y + 0.26, w: 0.42, h: 0.42, rectRadius: 0.06, fill: { color: NAVY } });
  s.addText(String(i + 1), { x: x + 0.28, y: y + 0.26, w: 0.42, h: 0.42, align: "center", valign: "middle", fontFace: HF, fontSize: 16, bold: true, color: GOLD });
  s.addText(c[0], { x: x + 0.82, y: y + 0.28, w: ccw - 1.05, h: 0.42, valign: "middle", fontFace: HF, fontSize: 16.5, bold: true, color: NAVY });
  s.addText(c[1], { x: x + 0.28, y: y + 0.86, w: ccw - 0.56, h: 1.2, fontFace: BF, fontSize: 13, color: INK, lineSpacingMultiple: 1.12 });
});

// ============ SLIDE 6 — COMPLIANCE (dark) ============
s = pptx.addSlide();
s.background = { color: NAVY };
kicker(s, "DIFFERENTIATOR", GOLD);
s.addText("Compliance built in, not bolted on", { x: M, y: 0.98, w: CW, h: 0.9, fontFace: HF, fontSize: 34, bold: true, color: WHITE });
s.addText("Generic marketing tools don’t know a bar rule from a banner ad. MarketOS does.",
  { x: M, y: 2.0, w: 7.4, h: 0.8, fontFace: BF, fontSize: 18, color: "CADCFC", lineSpacingMultiple: 1.2 });
const cc = [
  ["Every asset, screened", "Ads, posts, GBP replies, and pipeline drafts are checked against NY / NJ attorney-advertising rules."],
  ["A score, not a guess", "AI returns a compliance score with specific warnings, so you fix issues before anything goes public."],
  ["Hard gate on autopilot", "The autonomous content agent will not publish anything that fails the compliance check."],
];
cc.forEach((c, i) => {
  const y = 3.05 + i * 1.28;
  s.addShape(pptx.ShapeType.rect, { x: M, y: y + 0.05, w: 0.11, h: 0.95, fill: { color: GOLD } });
  s.addText(c[0], { x: M + 0.35, y: y, w: 11.5, h: 0.45, fontFace: HF, fontSize: 18, bold: true, color: GOLD });
  s.addText(c[1], { x: M + 0.35, y: y + 0.46, w: 11.4, h: 0.7, fontFace: BF, fontSize: 14.5, color: "DCE6F5", lineSpacingMultiple: 1.1 });
});

// ============ SLIDE 7 — AEO ============
s = pptx.addSlide();
s.background = { color: WHITE };
kicker(s, "AI VISIBILITY", GOLD);
titleLight(s, "Be the answer in AI search");
s.addText("Your clients are asking AI assistants for legal help. MarketOS runs buyer-intent prompts across every major engine, then measures whether your firm gets cited — and how you stack up against competitors.",
  { x: M, y: 1.8, w: CW, h: 1.0, fontFace: BF, fontSize: 16, color: INK, lineSpacingMultiple: 1.25 });
const engines = ["ChatGPT", "Claude", "Perplexity", "Gemini"];
const ecw = (CW - 3 * 0.35) / 4, ey = 3.4, ech = 1.5;
engines.forEach((e, i) => {
  const x = M + i * (ecw + 0.35);
  s.addShape(pptx.ShapeType.roundRect, { x, y: ey, w: ecw, h: ech, rectRadius: 0.08, fill: { color: NAVY } });
  s.addText(e, { x, y: ey + 0.28, w: ecw, h: 0.5, align: "center", fontFace: HF, fontSize: 19, bold: true, color: WHITE });
  s.addText("share of voice", { x, y: ey + 0.82, w: ecw, h: 0.4, align: "center", fontFace: BF, fontSize: 12, color: GOLD });
});
s.addText("Plus an AI-readiness scanner, referral-traffic tracking, bot-crawl detection, and an llms.txt builder.",
  { x: M, y: 5.3, w: CW, h: 0.5, align: "center", fontFace: BF, fontSize: 14, italic: true, color: MUTED });

// ============ SLIDE 8 — WHY (built by a firm) ============
s = pptx.addSlide();
s.background = { color: WHITE };
kicker(s, "WHY MARKETOS", GOLD);
titleLight(s, "Built by a law firm, for law firms");
const why = [
  ["Practitioners, not vendors", "Designed inside a working plaintiff-side firm — it speaks legal marketing and ethics natively."],
  ["Best-in-class data", "Connects the tools you already trust into one place, instead of replacing them with something weaker."],
  ["AI where it earns its keep", "Drafting, recommendations, and compliance — the work that actually moves the needle."],
];
const wcw = (CW - 2 * 0.35) / 3;
why.forEach((wv, i) => {
  const x = M + i * (wcw + 0.35), y = 2.0;
  card(s, x, y, wcw, 2.35);
  s.addText(wv[0], { x: x + 0.3, y: y + 0.28, w: wcw - 0.6, h: 0.85, fontFace: HF, fontSize: 18, bold: true, color: NAVY });
  s.addText(wv[1], { x: x + 0.3, y: y + 1.15, w: wcw - 0.6, h: 1.05, fontFace: BF, fontSize: 14, color: INK, lineSpacingMultiple: 1.15 });
});
s.addText("WORKS WITH THE STACK YOU ALREADY USE", { x: M, y: 4.85, w: CW, h: 0.35, align: "center", fontFace: BF, fontSize: 11, bold: true, charSpacing: 2, color: MUTED });
const tools = ["Claude AI", "Semrush", "Google Search Console", "Google Analytics 4", "CallRail", "Ayrshare", "Constant Contact", "Google Business Profile"];
const chipGap = 0.25, chipH = 0.5;
const chipW = (t) => Math.max(1.3, 0.115 * t.length + 0.5);
function drawChipRow(items, yy) {
  const widths = items.map(chipW);
  const total = widths.reduce((a, b) => a + b, 0) + chipGap * (items.length - 1);
  let x = (W - total) / 2;
  items.forEach((t, i) => {
    const cw = widths[i];
    s.addShape(pptx.ShapeType.roundRect, { x, y: yy, w: cw, h: chipH, rectRadius: 0.25, fill: { color: ICE2 }, line: { color: LINE, width: 0.75 } });
    s.addText(t, { x, y: yy, w: cw, h: chipH, align: "center", valign: "middle", fontFace: BF, fontSize: 12, bold: true, color: NAVY });
    x += cw + chipGap;
  });
}
drawChipRow(tools.slice(0, 4), 5.35);
drawChipRow(tools.slice(4), 5.95);

// ============ SLIDE 9 — CTA ============
s = pptx.addSlide();
s.background = { color: NAVY };
for (let i = 0; i < 3; i++) s.addShape(pptx.ShapeType.rect, { x: M + i * 0.34, y: 1.0, w: 0.22, h: 0.22, fill: { color: GOLD } });
s.addText("Stop juggling tools.\nStart compounding growth.", { x: M, y: 2.2, w: 11.5, h: 1.9, fontFace: HF, fontSize: 42, bold: true, color: WHITE, lineSpacingMultiple: 1.05 });
s.addText("Book a 30-minute demo and we’ll map MarketOS to your firm’s funnel.",
  { x: M, y: 4.35, w: 11, h: 0.6, fontFace: BF, fontSize: 19, color: "CADCFC" });
s.addText([
  { text: "MarketOS", options: { bold: true, color: GOLD } },
  { text: "   by Katz Melinger PLLC", options: { color: "AEBED8" } },
], { x: M, y: 6.4, w: 8, h: 0.4, fontFace: BF, fontSize: 15 });
s.addText("kjkatz@katzmelinger.com", { x: W - M - 5, y: 6.4, w: 5, h: 0.4, align: "right", fontFace: BF, fontSize: 14, color: "CADCFC" });

pptx.writeFile({ fileName: path.join(__dirname, "MarketOS-Sales-Deck.pptx") }).then(f => console.log("WROTE", f));
