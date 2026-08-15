/**
 * Backlink verifier — fetches an arbitrary URL and checks whether it links
 * to the firm's own domain (resolved per-tenant).
 *
 * SSRF-protected: blocks localhost, RFC1918 private ranges, link-local,
 * and known cloud metadata endpoints. Only http/https + public hostnames
 * are allowed. Caps response size at 5MB so a hostile server can't blow
 * up the function.
 */

import { safeFetch } from "./url-safety";
import { getTenantConfig } from "./tenant-config";

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (compatible; MarketingDashboard/1.0)";

function getHostname(href: string): string | null {
  try {
    return new URL(href).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isOurDomain(hostname: string, ourDomain: string): boolean {
  return hostname === ourDomain || hostname.endsWith(`.${ourDomain}`);
}

export type VerifyResult = {
  found: boolean;
  url: string;
  anchorText?: string;
  rel?: string;
  error?: string;
};

export async function verifyBacklinkFromUrl(targetUrl: string): Promise<VerifyResult> {
  const ourDomain = (await getTenantConfig()).seoDomain;

  try {
    // safeFetch re-checks each redirect hop. Validating targetUrl and then
    // following redirects would let any open redirect on a public host reach
    // loopback or the cloud metadata endpoint.
    const res = await safeFetch(targetUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      timeoutMs: 15_000,
    });
    if (!res.ok) return { found: false, url: targetUrl, error: `Fetch returned ${res.status}` };

    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("text/xhtml")) {
      return { found: false, url: targetUrl, error: "Not an HTML page" };
    }

    const html = await res.text();
    if (html.length > MAX_RESPONSE_SIZE) {
      return { found: false, url: targetUrl, error: "Page too large to analyze" };
    }

    const regex = /<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(html)) !== null) {
      const beforeHref = m[1];
      const href = m[2];
      const afterHref = m[3];
      const anchor = m[4].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      const hostname = getHostname(href);
      if (!hostname) continue;
      if (isOurDomain(hostname, ourDomain)) {
        const fullTag = beforeHref + " " + afterHref;
        const relMatch = fullTag.match(/\brel\s*=\s*["']([^"']+)["']/i);
        return {
          found: true,
          url: targetUrl,
          anchorText: anchor || href,
          rel: relMatch ? relMatch[1] : undefined,
        };
      }
    }
    return { found: false, url: targetUrl };
  } catch (err) {
    return {
      found: false,
      url: targetUrl,
      error: err instanceof Error ? err.message : "Verification failed",
    };
  }
}
