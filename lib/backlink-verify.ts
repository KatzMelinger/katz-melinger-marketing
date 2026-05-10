/**
 * Backlink verifier — fetches an arbitrary URL and checks whether it links
 * to katzmelinger.com.
 *
 * SSRF-protected: blocks localhost, RFC1918 private ranges, link-local,
 * and known cloud metadata endpoints. Only http/https + public hostnames
 * are allowed. Caps response size at 5MB so a hostile server can't blow
 * up the function.
 */

const OUR_DOMAIN = "katzmelinger.com";
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (compatible; KMDashboard/1.0; +https://katzmelinger.com)";

function isPublicUrl(urlStr: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const hostname = parsed.hostname.toLowerCase();

  // Hard blocks.
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") return false;
  if (hostname === "[::1]" || hostname.startsWith("[")) return false;
  if (hostname.endsWith(".local") || hostname.endsWith(".internal")) return false;

  // RFC1918 + link-local.
  if (/^10\./.test(hostname)) return false;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname)) return false;
  if (/^192\.168\./.test(hostname)) return false;
  if (/^169\.254\./.test(hostname)) return false;

  // Cloud metadata.
  if (hostname.includes("metadata.google") || hostname.includes("169.254.169.254")) return false;

  return true;
}

function getHostname(href: string): string | null {
  try {
    return new URL(href).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isOurDomain(hostname: string): boolean {
  return hostname === OUR_DOMAIN || hostname.endsWith(`.${OUR_DOMAIN}`);
}

export type VerifyResult = {
  found: boolean;
  url: string;
  anchorText?: string;
  rel?: string;
  error?: string;
};

export async function verifyBacklinkFromUrl(targetUrl: string): Promise<VerifyResult> {
  if (!isPublicUrl(targetUrl)) {
    return { found: false, url: targetUrl, error: "Only public HTTP/HTTPS URLs are allowed" };
  }

  try {
    const res = await fetch(targetUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
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
      if (isOurDomain(hostname)) {
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
