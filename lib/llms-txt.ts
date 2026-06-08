/**
 * llms.txt generator.
 *
 * llms.txt is a markdown manifest at the site root that gives LLMs a curated
 * map of the site's most important content (https://llmstxt.org/). We build it
 * from:
 *   - the firm context (brand voice settings) for the headline / description
 *   - the sitemap.xml for the page list, with titles pulled from <title> tags
 *
 * Output is plain text suitable for pasting at /llms.txt on the firm's site.
 * Each generation is logged in `llms_txt_versions` so we can diff over time.
 */

import { getFirmContext } from "./firm-context";
import { getSupabaseAdmin } from "./supabase-server";
import { resolveTenantId } from "./tenant-context";
import { logger } from "./logger";

const USER_AGENT = "KMDashboard-LLMSTxt/1.0";
const MAX_PAGES = 40;

type SitemapPage = {
  url: string;
  title: string;
  description: string;
  section: string;
};

function classifySection(pathname: string): string {
  const lc = pathname.toLowerCase();
  if (lc.includes("/practice") || lc.includes("/services")) return "Practice Areas";
  if (lc.includes("/blog") || lc.includes("/news") || lc.includes("/article")) return "Insights";
  if (lc.includes("/attorney") || lc.includes("/team") || lc.includes("/about")) return "About";
  if (lc.includes("/contact") || lc.includes("/intake")) return "Get in Touch";
  if (lc.includes("/case") || lc.includes("/result")) return "Case Results";
  if (lc.includes("/faq") || lc.includes("/question")) return "FAQ";
  return "Pages";
}

async function fetchPageMeta(url: string): Promise<{ title: string; description: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const descMatch = html.match(
      /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i,
    );
    return {
      title: titleMatch ? titleMatch[1].trim() : url,
      description: descMatch ? descMatch[1].trim() : "",
    };
  } catch (err) {
    logger.warn(
      { url, error: err instanceof Error ? err.message : String(err) },
      "llms.txt page fetch failed",
    );
    return null;
  }
}

async function resolveSitemap(base: string, host: string): Promise<string[]> {
  try {
    const res = await fetch(`${base}/sitemap.xml`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [base];
    const xml = await res.text();
    const re = /<loc>(.*?)<\/loc>/g;
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const u = m[1].trim();
      if (u && u.includes(host)) out.push(u);
    }
    return out.length > 0 ? out : [base];
  } catch {
    return [base];
  }
}

export async function generateLlmsTxt(input: string): Promise<{
  domain: string;
  content: string;
  sourcePages: SitemapPage[];
  versionId: string;
}> {
  let raw = (input || "").trim();
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  const u = new URL(raw);
  const base = `${u.protocol}//${u.host}`;
  const host = u.host.replace(/^www\./, "");

  const [firmContext, urls] = await Promise.all([
    getFirmContext(),
    resolveSitemap(base, host),
  ]);

  const targets = urls.slice(0, MAX_PAGES);
  const pages: SitemapPage[] = [];
  for (const url of targets) {
    const meta = await fetchPageMeta(url);
    if (!meta) continue;
    let pathname = "/";
    try {
      pathname = new URL(url).pathname;
    } catch {
      /* ignore */
    }
    pages.push({
      url,
      title: meta.title.replace(/\s*[|–-]\s*Katz Melinger.*/i, "").trim() || meta.title,
      description: meta.description,
      section: classifySection(pathname),
    });
  }

  // Group by section in display order.
  const sectionOrder = [
    "Practice Areas",
    "About",
    "Case Results",
    "Insights",
    "FAQ",
    "Get in Touch",
    "Pages",
  ];
  const grouped = new Map<string, SitemapPage[]>();
  for (const p of pages) {
    const arr = grouped.get(p.section) ?? [];
    arr.push(p);
    grouped.set(p.section, arr);
  }

  const headline = firmContext.split("\n")[0]?.trim() ?? `Site overview for ${host}.`;
  const blurb = firmContext
    .split("\n")
    .slice(1)
    .filter((l) => l.trim().length > 0)
    .join(" ");

  let md = `# ${host}\n\n> ${headline}\n\n`;
  if (blurb) md += `${blurb}\n\n`;

  for (const section of sectionOrder) {
    const list = grouped.get(section);
    if (!list || list.length === 0) continue;
    md += `## ${section}\n\n`;
    for (const page of list) {
      const desc = page.description ? `: ${page.description}` : "";
      md += `- [${page.title}](${page.url})${desc}\n`;
    }
    md += "\n";
  }

  const supabase = getSupabaseAdmin();
  const { data: row, error } = await supabase
    .from("llms_txt_versions")
    .insert({ domain: host, content: md, source_pages: pages, tenant_id: await resolveTenantId() })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to save version: ${error.message}`);

  return { domain: host, content: md, sourcePages: pages, versionId: row.id };
}
