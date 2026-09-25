/**
 * Import a Word document WITH its structure (Diana's item 10).
 *
 * lib/document-extract.ts already reads .docx, but through
 * `mammoth.extractRawText`, which is the whole problem: it returns the words
 * and throws away the headings. That is fine for its job — feeding source text
 * to a model — and exactly wrong for importing a finished blog, which is how
 * the Unpaid Wages draft arrived with no H1 and its section titles sitting
 * inside paragraphs.
 *
 * `convertToHtml` keeps the outline, so that is what this uses, with a style
 * map for the two things Word writers actually use and mammoth does not map on
 * its own: the built-in "Heading 1"/"Heading 2" styles under their localised
 * names, and "Title", which is what the first line of a Word document usually
 * is rather than a heading at all.
 *
 * The output is Markdown because the draft editor is a textarea holding
 * Markdown. See lib/html-to-markdown.ts for why that conversion is written
 * here rather than pulled in.
 */

import { htmlToMarkdown, normalizeHeadings } from "./html-to-markdown";

/**
 * Word styles → HTML, beyond mammoth's defaults.
 *
 * "Title" is the significant one. A Word author writes the document's name in
 * the Title style, not Heading 1, so mammoth's default map turns the single
 * most important line into a plain paragraph — and the draft then genuinely has
 * no H1, which is what the structure check was reporting all along.
 */
const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "p[style-name='heading 1'] => h1:fresh",
  "p[style-name='heading 2'] => h2:fresh",
  "p[style-name='heading 3'] => h3:fresh",
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote:fresh",
];

export type WordImportResult = {
  markdown: string;
  /** Things a person should look at — never silent corrections. */
  warnings: string[];
};

/**
 * Convert a .docx buffer to structured Markdown.
 *
 * Images are dropped. mammoth would otherwise inline them as base64 data URIs,
 * which bloats the draft body by megabytes and puts an unhostable image in a
 * post that is about to be published — the writer needs to add real images
 * through the media flow either way.
 */
export async function importWordDocument(args: {
  buffer: Buffer;
  /** Used as the H1 when the document itself has no heading. */
  fallbackTitle?: string | null;
  /** Reported against the H1. Never inserted — see normalizeHeadings. */
  targetKeyword?: string | null;
}): Promise<WordImportResult> {
  const mammoth = await import("mammoth");

  const result = await mammoth.convertToHtml(
    { buffer: args.buffer },
    {
      styleMap: STYLE_MAP,
      // Drop images rather than embedding them. See above.
      convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
    },
  );

  const markdown = htmlToMarkdown(result.value ?? "");
  if (!markdown.trim()) {
    return { markdown: "", warnings: ["The document appears to be empty."] };
  }

  const normalized = normalizeHeadings(markdown, {
    fallbackTitle: args.fallbackTitle,
    targetKeyword: args.targetKeyword,
  });

  // mammoth reports styles it could not map. Surfaced rather than swallowed:
  // an unmapped custom heading style is precisely the case where the import
  // looks fine and quietly lost the outline.
  const unmapped = (result.messages ?? [])
    .filter((m) => m.type === "warning")
    .map((m) => m.message)
    .filter((m) => /style/i.test(m))
    .slice(0, 5);

  return {
    markdown: normalized.markdown,
    warnings: [...normalized.warnings, ...unmapped],
  };
}
