/**
 * Markdown → plaintext with source-offset mapping.
 *
 * Content bodies are stored and edited as Markdown. Every readability check
 * (sentence/paragraph length, passive voice, transitions, openers, subheading
 * gaps) must run on the prose, not the markup — counting `**`, list bullets, or
 * link URLs as words inflates everything. This helper strips Markdown and, for
 * each surviving prose character, records its offset back into the ORIGINAL
 * source string so a flagged sentence can be highlighted in the editor (which
 * edits the Markdown source directly — see plan §6, CodeMirror 6).
 *
 * It also fixes a latent bug: the existing Flesch metric in lib/content-analysis
 * runs on raw Markdown. Routing that through toPlaintext() (Phase 1) corrects it.
 *
 * Scope: pragmatic, not a full CommonMark parser. Handles the constructs the
 * generators actually emit — ATX headings, list/quote markers, fenced/inline
 * code, emphasis, links, images. Reference-style links and nested emphasis edge
 * cases degrade to "left as text", never to a crash.
 */

export type Sentence = {
  text: string;
  /** Source-string char offsets (into the original Markdown). */
  start: number;
  end: number;
  wordCount: number;
};

export type Paragraph = {
  text: string;
  start: number;
  end: number;
  wordCount: number;
  sentenceCount: number;
};

export type Heading = {
  text: string;
  level: number;
  start: number;
  end: number;
};

export type Plaintext = {
  /** All prose paragraphs joined by blank lines (headings excluded). */
  text: string;
  sentences: Sentence[];
  paragraphs: Paragraph[];
  headings: Heading[];
  wordCount: number;
};

// Abbreviations that end in "." but should not end a sentence.
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "inc",
  "co", "corp", "ltd", "llc", "llp", "no", "dept", "fig", "al", "approx",
  "e.g", "i.e", "u.s", "u.k", "a.m", "p.m",
]);

function countWords(text: string): number {
  const m = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g);
  return m ? m.length : 0;
}

/** Locate an inline `[text](url)` starting at `[` (index i). Null if not one. */
function matchLink(src: string, i: number): { textStart: number; textEnd: number; end: number } | null {
  let k = i + 1;
  while (k < src.length && src[k] !== "]" && src[k] !== "\n") k++;
  if (k >= src.length || src[k] !== "]") return null;
  const textStart = i + 1;
  const textEnd = k;
  if (src[k + 1] !== "(") return null;
  let m = k + 2;
  while (m < src.length && src[m] !== ")" && src[m] !== "\n") m++;
  if (m >= src.length || src[m] !== ")") return null;
  return { textStart, textEnd, end: m + 1 };
}

/**
 * Strip inline Markdown from a source slice, returning the cleaned text and,
 * for each cleaned char, its absolute offset in the original source.
 * `base` is the absolute source offset of src[0].
 */
function cleanInline(src: string, base: number): { text: string; offsets: number[] } {
  const out: string[] = [];
  const offsets: number[] = [];
  const push = (ch: string, idx: number) => {
    out.push(ch);
    offsets.push(base + idx);
  };

  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];

    // Image: ![alt](url) — drop entirely (alt text isn't prose).
    if (c === "!" && src[i + 1] === "[") {
      const link = matchLink(src, i + 1);
      if (link) {
        i = link.end;
        continue;
      }
    }

    // Link: [text](url) — keep text, drop the target.
    if (c === "[") {
      const link = matchLink(src, i);
      if (link) {
        for (let k = link.textStart; k < link.textEnd; k++) push(src[k], k);
        i = link.end;
        continue;
      }
    }

    // Inline code: `code` — keep the code words, drop the backticks.
    if (c === "`") {
      const end = src.indexOf("`", i + 1);
      if (end !== -1) {
        for (let k = i + 1; k < end; k++) push(src[k], k);
        i = end + 1;
        continue;
      }
    }

    // Emphasis / strikethrough markers: drop runs of * _ ~.
    if (c === "*" || c === "_" || c === "~") {
      let j = i;
      while (j < n && src[j] === c) j++;
      i = j;
      continue;
    }

    // Escaped char: \x — keep x, drop the backslash.
    if (c === "\\" && i + 1 < n) {
      push(src[i + 1], i + 1);
      i += 2;
      continue;
    }

    push(c, i);
    i++;
  }

  return { text: out.join(""), offsets };
}

/** Split a cleaned paragraph (with offset map) into sentences. */
function splitSentences(clean: string, offsets: number[]): Sentence[] {
  const result: Sentence[] = [];
  const n = clean.length;
  let startIdx = 0;
  let i = 0;

  const emit = (from: number, to: number) => {
    // Trim surrounding whitespace within [from, to).
    let a = from;
    let b = to;
    while (a < b && /\s/.test(clean[a])) a++;
    while (b > a && /\s/.test(clean[b - 1])) b--;
    if (b <= a) return;
    const text = clean.slice(a, b);
    if (!countWords(text)) return;
    result.push({
      text,
      start: offsets[a],
      end: offsets[b - 1] + 1,
      wordCount: countWords(text),
    });
  };

  const lastWordBefore = (idx: number): string => {
    let b = idx;
    while (b > 0 && /[\s]/.test(clean[b - 1])) b--;
    let a = b;
    while (a > 0 && /[A-Za-z.]/.test(clean[a - 1])) a--;
    return clean.slice(a, b).toLowerCase().replace(/\.$/, "");
  };

  while (i < n) {
    const ch = clean[i];
    if (ch === "." || ch === "!" || ch === "?") {
      let j = i;
      while (j < n && ".!?".includes(clean[j])) j++;
      const next = clean[j];
      const breaks =
        j >= n ||
        (/\s/.test(next) &&
          // Don't break after a known abbreviation ending in "." …
          !(ch === "." && ABBREVIATIONS.has(lastWordBefore(i + 1))) &&
          // … nor after a single-letter initial ("J. Smith").
          !(ch === "." && j - i === 1 && /[A-Za-z]/.test(clean[i - 1] ?? "") && !/[A-Za-z]/.test(clean[i - 2] ?? "")));
      if (breaks) {
        emit(startIdx, j);
        let k = j;
        while (k < n && /\s/.test(clean[k])) k++;
        startIdx = k;
        i = k;
        continue;
      }
      i = j;
      continue;
    }
    i++;
  }
  if (startIdx < n) emit(startIdx, n);
  return result;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LIST_MARKER_RE = /^(\s*)(?:[-*+]\s+|\d+[.)]\s+)/;
const QUOTE_MARKER_RE = /^(\s*>\s?)/;

/** Parse a Markdown body into prose units with source offsets. */
export function toPlaintext(markdown: string): Plaintext {
  const src = markdown ?? "";
  const sentences: Sentence[] = [];
  const paragraphs: Paragraph[] = [];
  const headings: Heading[] = [];

  // Walk lines, tracking each line's absolute start offset.
  let lineStart = 0;
  let inFence = false;
  // Accumulating paragraph: cleaned text + offset map.
  let para: { text: string; offsets: number[] } | null = null;

  const flushParagraph = () => {
    if (!para) return;
    const text = para.text.trim();
    if (text && countWords(text)) {
      const ps = splitSentences(para.text, para.offsets);
      sentences.push(...ps);
      const first = ps[0];
      const last = ps[ps.length - 1];
      paragraphs.push({
        text,
        start: first ? first.start : para.offsets[0],
        end: last ? last.end : para.offsets[para.offsets.length - 1] + 1,
        wordCount: countWords(text),
        sentenceCount: ps.length,
      });
    }
    para = null;
  };

  const appendLineToPara = (lineSrc: string, base: number) => {
    const cleaned = cleanInline(lineSrc, base);
    if (!cleaned.text.trim()) return;
    if (!para) {
      para = { text: "", offsets: [] };
    } else {
      // Soft line break inside a paragraph → join with a space.
      para.text += " ";
      para.offsets.push(base);
    }
    para.text += cleaned.text;
    para.offsets.push(...cleaned.offsets);
  };

  while (lineStart <= src.length) {
    let nl = src.indexOf("\n", lineStart);
    if (nl === -1) nl = src.length;
    const line = src.slice(lineStart, nl);
    const trimmed = line.trim();

    // Fenced code blocks: toggle on ``` / ~~~, skip contents.
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      flushParagraph();
      lineStart = nl + 1;
      if (nl === src.length) break;
      continue;
    }
    if (inFence) {
      lineStart = nl + 1;
      if (nl === src.length) break;
      continue;
    }

    if (trimmed === "") {
      flushParagraph();
      lineStart = nl + 1;
      if (nl === src.length) break;
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const markerLen = line.length - line.replace(/^#{1,6}\s+/, "").length;
      const textBase = lineStart + markerLen;
      const cleaned = cleanInline(heading[2], textBase);
      const text = cleaned.text.trim();
      if (text) {
        headings.push({ text, level, start: lineStart, end: nl });
      }
      lineStart = nl + 1;
      if (nl === src.length) break;
      continue;
    }

    // Strip a leading list or blockquote marker; keep the rest as prose.
    let contentOffset = lineStart;
    let content = line;
    const listM = line.match(LIST_MARKER_RE);
    if (listM) {
      contentOffset = lineStart + listM[0].length;
      content = line.slice(listM[0].length);
    } else {
      const quoteM = line.match(QUOTE_MARKER_RE);
      if (quoteM) {
        contentOffset = lineStart + quoteM[0].length;
        content = line.slice(quoteM[0].length);
      }
    }

    appendLineToPara(content, contentOffset);

    lineStart = nl + 1;
    if (nl === src.length) break;
  }
  flushParagraph();

  const text = paragraphs.map((p) => p.text).join("\n\n");
  const wordCount = paragraphs.reduce((sum, p) => sum + p.wordCount, 0);
  return { text, sentences, paragraphs, headings, wordCount };
}
