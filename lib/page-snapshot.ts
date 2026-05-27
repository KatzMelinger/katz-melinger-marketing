/**
 * Fetch a URL and extract its current on-page SEO state — title, meta
 * description, canonical, OG tags, first H1, and any JSON-LD blocks. Used by
 * the technical-SEO fix analyzer to compare "what's there now" against "what
 * should be there" before suggesting an AutoPilot fix.
 *
 * Intentionally regex-based: we don't want a heavy HTML parser dep just for
 * <head> introspection, and the meta tags we care about are well-formed in
 * practice. If a page is wildly malformed we just see empty values, which is
 * still useful signal ("canonical missing" is a fixable finding).
 */

export type PageSnapshot = {
  url: string;
  status: number;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  h1: string | null;
  jsonLdBlocks: string[];
  /** Trimmed HTML excerpt (head + first ~2KB of body) for Claude to reference. */
  htmlExcerpt: string;
  /** Surface-area issues we can detect without AI — useful as a primer. */
  detectedIssues: string[];
};

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; KMAutoPilot/0.1; +https://katzmelinger.com)",
  Accept: "text/html,application/xhtml+xml",
};

function firstMatch(html: string, re: RegExp): string | null {
  const m = html.match(re);
  if (!m) return null;
  return m[1].trim().replace(/\s+/g, " ");
}

function allMatches(html: string, re: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push(m[1].trim());
  }
  return out;
}

export async function snapshotPage(url: string): Promise<PageSnapshot> {
  const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
  const html = await res.text();

  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescription = firstMatch(
    html,
    /<meta\s+(?:[^>]*?\s+)?name=["']description["'][^>]*?\s+content=["']([\s\S]*?)["']/i,
  );
  const canonical = firstMatch(
    html,
    /<link\s+(?:[^>]*?\s+)?rel=["']canonical["'][^>]*?\s+href=["']([^"']+)["']/i,
  );
  const ogTitle = firstMatch(
    html,
    /<meta\s+(?:[^>]*?\s+)?property=["']og:title["'][^>]*?\s+content=["']([\s\S]*?)["']/i,
  );
  const ogDescription = firstMatch(
    html,
    /<meta\s+(?:[^>]*?\s+)?property=["']og:description["'][^>]*?\s+content=["']([\s\S]*?)["']/i,
  );
  const h1 = firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)?.replace(
    /<[^>]+>/g,
    "",
  ) ?? null;
  const jsonLdBlocks = allMatches(
    html,
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );

  // Build a compact excerpt: just the head + first 2KB of body. Keeps the
  // Claude call cheap.
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)(?:<\/body>|$)/i);
  const headExcerpt = headMatch ? headMatch[0].slice(0, 4000) : "";
  const bodyExcerpt = bodyMatch
    ? bodyMatch[0].replace(/<script[\s\S]*?<\/script>/gi, "").slice(0, 2000)
    : "";
  const htmlExcerpt = `${headExcerpt}\n\n${bodyExcerpt}`;

  const detectedIssues: string[] = [];
  if (!title) detectedIssues.push("Missing <title> tag");
  else if (title.length < 30) detectedIssues.push("Title is short (< 30 chars)");
  else if (title.length > 65) detectedIssues.push("Title exceeds 65 chars (may truncate in SERPs)");
  if (!metaDescription) detectedIssues.push("Missing meta description");
  else if (metaDescription.length < 80)
    detectedIssues.push("Meta description short (< 80 chars)");
  else if (metaDescription.length > 165)
    detectedIssues.push("Meta description over 165 chars (may truncate)");
  if (!canonical) detectedIssues.push("Missing canonical URL");
  if (!ogTitle) detectedIssues.push("Missing og:title");
  if (!ogDescription) detectedIssues.push("Missing og:description");
  if (!h1) detectedIssues.push("Missing or empty <h1>");
  if (jsonLdBlocks.length === 0)
    detectedIssues.push("No JSON-LD structured data present");

  return {
    url,
    status: res.status,
    title,
    metaDescription,
    canonical,
    ogTitle,
    ogDescription,
    h1,
    jsonLdBlocks,
    htmlExcerpt,
    detectedIssues,
  };
}
