/**
 * Parse a generated carousel script (the "Slide 1: … / Slide 2: … / Caption: …"
 * Markdown the carousel format produces) into structured slides + the posting
 * caption, so the renderer can lay out one image per slide and the scheduler can
 * post the caption as the body text.
 *
 * Tolerant of the usual model drift: "Slide 1:", "**Slide 1**", "Slide 1 -",
 * leading bullets/markdown, and a Caption block under "Caption:" / "Post
 * caption:".
 */

export type CarouselSlide = {
  /** 1-based slide number. */
  n: number;
  /** Short bold line shown large. */
  headline: string;
  /** Optional supporting line(s). */
  sub: string;
};

export type ParsedCarousel = {
  slides: CarouselSlide[];
  caption: string;
};

/** Strip surrounding markdown emphasis / list markers from a line. */
function clean(line: string): string {
  return line
    .replace(/^\s*[-*•]\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/, "")
    .replace(/^_+|_+$/g, "")
    .trim();
}

const SLIDE_RE = /^\s*(?:[-*•]\s*)?(?:\*\*)?slide\s*(\d+)\s*(?:\*\*)?\s*[:\-–—.)]\s*(.*)$/i;
const CAPTION_RE = /^\s*(?:[-*•]\s*)?(?:\*\*)?(?:post\s+)?caption\s*(?:\*\*)?\s*[:\-–—]\s*(.*)$/i;

export function parseCarouselScript(body: string): ParsedCarousel {
  const lines = (body ?? "").replace(/\r\n/g, "\n").split("\n");

  const slides: CarouselSlide[] = [];
  const captionLines: string[] = [];
  let mode: "pre" | "slide" | "caption" = "pre";
  let current: { n: number; lines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const text = current.lines.map(clean).filter(Boolean);
    const headline = text[0] ?? "";
    const sub = text.slice(1).join(" ");
    if (headline) slides.push({ n: current.n, headline, sub });
    current = null;
  };

  for (const raw of lines) {
    const slideMatch = raw.match(SLIDE_RE);
    const captionMatch = raw.match(CAPTION_RE);

    if (captionMatch) {
      flush();
      mode = "caption";
      const first = clean(captionMatch[1] ?? "");
      if (first) captionLines.push(first);
      continue;
    }
    if (slideMatch) {
      flush();
      mode = "slide";
      current = { n: Number(slideMatch[1]), lines: [slideMatch[2] ?? ""] };
      continue;
    }

    if (mode === "caption") {
      captionLines.push(raw.trim());
    } else if (mode === "slide" && current) {
      current.lines.push(raw);
    }
    // `pre` lines (preamble before the first slide) are ignored.
  }
  flush();

  // Renumber defensively in case the model skipped/repeated a number.
  slides.forEach((s, i) => (s.n = i + 1));

  return {
    slides,
    caption: captionLines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}
