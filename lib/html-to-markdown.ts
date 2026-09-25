/**
 * HTML to Markdown, scoped to what Word actually produces.
 *
 * Item 10: pasting a blog from Word flattened the structure — the Unpaid Wages
 * draft arrived with no real H1 and its section titles sitting inside
 * paragraphs, so the "exactly one H1 with the keyword" check failed on a
 * document that had perfectly good headings before it was pasted.
 *
 * WHY THIS EXISTS RATHER THAN A LIBRARY
 *
 * The draft editor is a plain textarea holding Markdown (rendered with
 * `marked`), so the target is Markdown, not a rich-text document model. There
 * is no HTML-to-Markdown converter in the dependency list, and the input here
 * is not arbitrary HTML: it is either mammoth's .docx output or a Word
 * clipboard payload, both of which use a small, predictable subset.
 *
 * So this handles that subset and says so, rather than pretending to be a
 * general converter. Anything it does not recognise degrades to its text
 * content, which is the same outcome as before for those elements and never
 * worse.
 *
 * WORD'S OWN MARKUP IS STRIPPED FIRST
 *
 * A Word clipboard payload is mostly not content: conditional comments, mso-
 * styles, <o:p> tags, empty spans wrapping every run, and `class="MsoNormal"`
 * on everything. Left in, they survive into the Markdown as noise. Removing
 * them is most of what makes the result readable.
 */

/** Elements whose content is dropped entirely, tags and all. */
const DROP_ELEMENTS = /<(script|style|xml|meta|link)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Word's conditional comments, `<o:p>` runs, and ordinary comments. */
const WORD_NOISE = [
  /<!--\[if[\s\S]*?<!\[endif\]-->/gi,
  /<!\[if[\s\S]*?<!\[endif\]>/gi,
  /<\/?o:p\b[^>]*>/gi,
  /<\/?w:[^>]*>/gi,
  /<!--[\s\S]*?-->/g,
];

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&rdquo;": "”",
  "&ldquo;": "“",
  "&hellip;": "…",
  "&mdash;": "—",
  "&ndash;": "–",
};

function decodeEntities(s: string): string {
  let out = s;
  for (const [entity, char] of Object.entries(ENTITIES)) {
    out = out.split(entity).join(char);
  }
  // Numeric entities, decimal and hex.
  out = out.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
  out = out.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  return out;
}

/** Strip every remaining tag and decode entities — the fallback for anything unhandled. */
function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ").trim();
}

/** Inline formatting, innermost first so nested bold/italic survives. */
function inlineToMarkdown(html: string): string {
  let s = html;

  // Links first: their text may itself be bold or italic.
  s = s.replace(
    /<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, inner: string) => {
      const text = inlineToMarkdown(inner).trim();
      const url = href.trim();
      // A bookmark link (Word's internal anchors) has no destination worth
      // keeping — the text is the content, the "#_Toc12345" is not.
      if (!url || url.startsWith("#")) return text;
      return text ? `[${text}](${url})` : url;
    },
  );

  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => {
    const text = inlineToMarkdown(inner).trim();
    return text ? `**${text}**` : "";
  });
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => {
    const text = inlineToMarkdown(inner).trim();
    return text ? `*${text}*` : "";
  });
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner: string) => {
    const text = textOf(inner);
    return text ? `\`${text}\`` : "";
  });

  s = s.replace(/<br\s*\/?>/gi, "\n");
  return decodeEntities(s.replace(/<[^>]+>/g, ""));
}

/**
 * Split a list's contents into its top-level items.
 *
 * NOT a regex, because the obvious one is wrong. `<li>([\s\S]*?)</li>` is
 * non-greedy, so on `<li>First<ul><li>Sub</li></ul></li>` it stops at the
 * INNER `</li>` and returns "First<ul><li>Sub" — an item carrying an unclosed
 * list, which then matches nothing and loses the nested content silently.
 * Word nests lists constantly, so this is the common case, not an edge one.
 *
 * Tracking ul/ol depth and splitting only on `<li>` tags at depth zero is what
 * makes nesting survive.
 */
function splitListItems(inner: string): string[] {
  const items: string[] = [];
  const tagRe = /<(\/?)(li|ul|ol)\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  let depth = 0;
  let start = -1;

  while ((m = tagRe.exec(inner)) !== null) {
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (tag === "ul" || tag === "ol") {
      depth = closing ? Math.max(0, depth - 1) : depth + 1;
      continue;
    }
    if (depth > 0) continue; // an <li> belonging to a nested list
    if (!closing) {
      // An unclosed previous item ends where this one begins — Word omits
      // </li> often enough that dropping those items would lose real content.
      if (start !== -1) items.push(inner.slice(start, m.index));
      start = m.index + m[0].length;
    } else if (start !== -1) {
      items.push(inner.slice(start, m.index));
      start = -1;
    }
  }
  if (start !== -1) items.push(inner.slice(start));
  return items;
}

/** One list as markdown items, with nested lists indented under their parent. */
function listToMarkdown(inner: string, ordered: boolean): string {
  const out: string[] = [];
  let n = 1;

  for (const raw of splitListItems(inner)) {
    const nested: string[] = [];
    const withoutNested = raw.replace(
      /<(ul|ol)\b[^>]*>([\s\S]*)<\/\1>/i,
      (_mm, tag: string, sub: string) => {
        for (const line of listToMarkdown(sub, tag.toLowerCase() === "ol").split("\n")) {
          if (line.trim()) nested.push(`  ${line}`);
        }
        return "";
      },
    );
    const text = inlineToMarkdown(withoutNested).replace(/\s+/g, " ").trim();
    if (text) out.push(ordered ? `${n++}. ${text}` : `- ${text}`);
    out.push(...nested);
  }
  return out.join("\n");
}

/**
 * Convert a Word-flavoured HTML fragment to Markdown.
 *
 * Handles: h1-h6, p, ul/ol/li, blockquote, hr, pre, strong/b, em/i, code, a,
 * br. Tables are reduced to their cell text on separate lines — a Markdown
 * table built from Word's nested-table markup is more often wrong than right,
 * and silently mangled data is worse than plain lines.
 */
export function htmlToMarkdown(html: string): string {
  if (!html?.trim()) return "";

  let s = html;
  s = s.replace(DROP_ELEMENTS, "");
  for (const re of WORD_NOISE) s = s.replace(re, "");

  // Block elements, outermost patterns first.
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => {
    const text = inlineToMarkdown(inner).replace(/\s+/g, " ").trim();
    return text ? `\n\n${"#".repeat(Number(level))} ${text}\n\n` : "";
  });

  s = s.replace(/<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, tag: string, inner: string) => {
    const list = listToMarkdown(inner, tag.toLowerCase() === "ol");
    return list ? `\n\n${list}\n\n` : "";
  });

  s = s.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) => {
    const text = inlineToMarkdown(inner).replace(/\s+/g, " ").trim();
    return text ? `\n\n> ${text}\n\n` : "";
  });

  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => {
    const text = textOf(inner);
    return text ? `\n\n\`\`\`\n${text}\n\`\`\`\n\n` : "";
  });

  // Table cells become plain lines. See the doc comment for why.
  s = s.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_m, row: string) => {
    const cells: string[] = [];
    const re = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let c: RegExpExecArray | null;
    while ((c = re.exec(row)) !== null) {
      const text = inlineToMarkdown(c[1]).replace(/\s+/g, " ").trim();
      if (text) cells.push(text);
    }
    return cells.length ? `\n\n${cells.join(" | ")}\n\n` : "";
  });

  s = s.replace(/<hr\s*\/?>/gi, "\n\n---\n\n");

  s = s.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_m, inner: string) => {
    const text = inlineToMarkdown(inner).replace(/[ \t]+/g, " ").trim();
    return text ? `\n\n${text}\n\n` : "";
  });

  s = s.replace(/<div\b[^>]*>([\s\S]*?)<\/div>/gi, (_m, inner: string) => {
    const text = inlineToMarkdown(inner).replace(/[ \t]+/g, " ").trim();
    return text ? `\n\n${text}\n\n` : "";
  });

  // Whatever is left is inline or unrecognised — keep its text.
  s = inlineToMarkdown(s);

  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Enforce "exactly one H1, and it carries the target keyword" (Diana item 10).
 *
 * Word documents routinely have several Heading 1s, or none at all with the
 * title living in the document properties. Both fail the structure check for
 * reasons that have nothing to do with the writing.
 *
 * The first top-level heading is promoted to the single H1; later H1s become
 * H2s, which preserves the outline rather than deleting the duplicates. When
 * the document has no heading at all, `fallbackTitle` becomes the H1.
 *
 * The keyword is REPORTED, never inserted. An H1 is the line a reader sees
 * first and an editor chose; rewriting it to smuggle a keyword in is the kind
 * of automated help that gets switched off.
 */
export function normalizeHeadings(
  markdown: string,
  opts: { fallbackTitle?: string | null; targetKeyword?: string | null } = {},
): { markdown: string; warnings: string[] } {
  const warnings: string[] = [];
  const lines = markdown.split("\n");

  const h1Indexes: number[] = [];
  let firstHeadingIndex = -1;
  lines.forEach((line, i) => {
    const m = /^(#{1,6})\s+\S/.exec(line);
    if (!m) return;
    if (firstHeadingIndex === -1) firstHeadingIndex = i;
    if (m[1].length === 1) h1Indexes.push(i);
  });

  let h1Line: string | null = null;

  if (h1Indexes.length === 0 && firstHeadingIndex >= 0) {
    // Headings, but none at level 1 — promote the first one.
    lines[firstHeadingIndex] = lines[firstHeadingIndex].replace(/^#{1,6}\s+/, "# ");
    h1Line = lines[firstHeadingIndex];
    warnings.push("Promoted the document's first heading to the H1.");
  } else if (h1Indexes.length === 0) {
    const title = (opts.fallbackTitle ?? "").trim();
    if (title) {
      lines.unshift(`# ${title}`, "");
      h1Line = `# ${title}`;
      warnings.push("The document had no headings — used its title as the H1.");
    } else {
      warnings.push("No heading found and no title to use, so the draft has no H1.");
    }
  } else {
    h1Line = lines[h1Indexes[0]];
    // Demote the extras rather than deleting them: they are real sections.
    for (const i of h1Indexes.slice(1)) {
      lines[i] = lines[i].replace(/^#\s+/, "## ");
    }
    if (h1Indexes.length > 1) {
      warnings.push(
        `Demoted ${h1Indexes.length - 1} extra H1 heading${
          h1Indexes.length - 1 === 1 ? "" : "s"
        } to H2 — a page has one H1.`,
      );
    }
  }

  const keyword = (opts.targetKeyword ?? "").trim();
  if (keyword && h1Line && !h1Line.toLowerCase().includes(keyword.toLowerCase())) {
    warnings.push(`The H1 does not contain the target keyword "${keyword}" — edit it before approval.`);
  }

  return { markdown: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), warnings };
}
