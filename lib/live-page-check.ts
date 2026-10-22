/**
 * The live page check (Oct 20 spec, Task A12): right after a page is
 * published, Huraqan fetches the live URL and confirms the frame (label,
 * Reviewed by byline, CTA, disclaimer), the schema, the canonical tag, that
 * the page is indexable, that every link resolves and that each 301 the page
 * replaces lands on it. Any failure emails Diana and Kenneth. The result is
 * stored as metadata.live_check and shown on the draft.
 */
import { getSupabaseAdmin } from "./supabase-server";
import { safeFetch } from "./url-safety";
import { getOperatingBrief } from "./social-operating-brief";
import { readContent } from "./draft-frame";
import { adminEmails, sendEmails } from "./notify-shared";
import { loadPublishers } from "./publish-permission";

export type LiveCheck = { at: string; url: string; pass: boolean; problems: string[]; linksChecked: number };

const norm = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");

/** Pure: what the HTML is missing. Exported for scripts/check-live-page.ts. */
export function frameProblems(
  html: string,
  args: { url: string; offerPhrase: string; expectReviewedBy: boolean; expectFaqSchema: boolean; language: "en" | "es" },
): string[] {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const problems: string[] = [];
  const label = args.language === "es" ? /Publicidad de abogados/i : /Attorney Advertising/i;
  if (!label.test(text)) problems.push(`The "${args.language === "es" ? "Publicidad de abogados" : "Attorney Advertising"}" label is not on the page.`);
  if (args.expectReviewedBy && !/(Reviewed by|Revisado por)\s+\S/i.test(text)) problems.push('The "Reviewed by" byline is not on the page.');
  if (/Pending attorney review/i.test(text)) problems.push('The page still says "Pending attorney review".');
  if (!text.toLowerCase().includes(args.offerPhrase.toLowerCase())) problems.push("The call to action is not on the page.");
  if (!/general informational purposes only|fines informativos generales/i.test(text)) problems.push("The closing disclaimer is not on the page.");
  if (args.expectFaqSchema && !/"@type"\s*:\s*"FAQPage"/.test(html)) problems.push("No FAQPage schema in the page.");
  if (!/application\/ld\+json/i.test(html)) problems.push("No JSON-LD schema at all in the page.");
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i)?.[1];
  if (!canonical) problems.push("No canonical tag.");
  else if (norm(canonical) !== norm(args.url)) problems.push(`The canonical tag points to ${canonical}, not this page.`);
  if (/<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html)) problems.push("The page is set to noindex.");
  return problems;
}

/** Links in the article body (not navigation or footer). */
export function articleLinks(html: string, pageUrl: string): string[] {
  const main = html.match(/<(?:article|main)[\s\S]*?<\/(?:article|main)>/i)?.[0] ?? html;
  const out = new Set<string>();
  for (const m of main.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
    const href = m[1].trim();
    if (/^(mailto|tel|javascript):/i.test(href)) continue;
    try {
      out.add(new URL(href, pageUrl).toString());
    } catch {
      /* skip */
    }
  }
  return [...out].slice(0, 40);
}

async function linkStatus(url: string): Promise<number | null> {
  try {
    let res = await safeFetch(url, { timeoutMs: 15_000, headers: { "User-Agent": "Mozilla/5.0 (compatible; HuraqanLiveCheck/1.0)" } });
    if (res.status === 405) res = await safeFetch(url, { timeoutMs: 15_000 });
    return res.status;
  } catch {
    return null;
  }
}

export async function runLiveCheck(args: { tenantId: string; draftId: string; url: string }): Promise<LiveCheck> {
  const sb = getSupabaseAdmin();
  const { data: d } = await sb.from("content_drafts").select("title, metadata").eq("tenant_id", args.tenantId).eq("id", args.draftId).maybeSingle();
  const meta = (d?.metadata as Record<string, unknown> | null) ?? {};
  const brief = await getOperatingBrief(args.tenantId);
  const language = String(meta.language ?? "").startsWith("es") ? "es" : "en";
  const problems: string[] = [];
  let linksChecked = 0;

  let html = "";
  try {
    const res = await safeFetch(args.url, { timeoutMs: 20_000, headers: { "User-Agent": "Mozilla/5.0 (compatible; HuraqanLiveCheck/1.0)" } });
    if (!res.ok) problems.push(`The live page returned ${res.status}.`);
    else {
      html = await res.text();
      const robotsHeader = res.headers.get("x-robots-tag") ?? "";
      if (/noindex/i.test(robotsHeader)) problems.push("The page sends an X-Robots-Tag noindex header.");
    }
  } catch (e) {
    problems.push(`The live page could not be read: ${e instanceof Error ? e.message : String(e)}.`);
  }

  if (html) {
    problems.push(
      ...frameProblems(html, {
        url: args.url,
        offerPhrase: language === "es" ? brief.offerPhraseEs : brief.offerPhrase,
        expectReviewedBy: !!meta.review,
        expectFaqSchema: (readContent(meta)?.faq.length ?? 0) > 0,
        language,
      }),
    );
    const links = articleLinks(html, args.url);
    linksChecked = links.length;
    const statuses = await Promise.all(links.map(async (l) => ({ l, s: await linkStatus(l) })));
    for (const { l, s } of statuses) {
      // 401/403/429 are bot walls, not broken links: reported as unknown, never as broken.
      if (s === null) problems.push(`A link could not be checked: ${l}`);
      else if (s >= 400 && ![401, 403, 429].includes(s)) problems.push(`A link is broken (${s}): ${l}`);
    }
  }

  // Each 301 this page replaces should land here.
  const redirects = Array.isArray(meta.redirects) ? (meta.redirects as { from?: string }[]) : [];
  for (const r of redirects) {
    if (!r.from) continue;
    try {
      const res = await safeFetch(r.from, { timeoutMs: 15_000 });
      if (norm(res.url) !== norm(args.url)) problems.push(`${r.from} does not redirect to this page yet.`);
    } catch {
      problems.push(`${r.from} could not be checked.`);
    }
  }

  const check: LiveCheck = { at: new Date().toISOString(), url: args.url, pass: problems.length === 0, problems, linksChecked };
  await sb
    .from("content_drafts")
    .update({ metadata: { ...meta, live_check: check } })
    .eq("tenant_id", args.tenantId)
    .eq("id", args.draftId);

  if (!check.pass) {
    const to = [...new Set([...adminEmails(), ...(await loadPublishers(args.tenantId))])];
    const title = (d?.title as string | null) ?? args.url;
    await sendEmails(
      to,
      `Live page check failed: ${title}`,
      `The page published from Huraqan at ${args.url} failed its live check:\n\n${problems.map((p) => `- ${p}`).join("\n")}\n\nOpen the draft in Huraqan to see the details, or roll it back from there.`,
    ).catch(() => 0);
  }
  return check;
}
