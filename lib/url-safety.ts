/**
 * SSRF guard for server-side fetches of user-supplied URLs (site-inventory
 * ingest, citation link audit). Blocks non-http(s) schemes and any host that
 * resolves to a private / loopback / link-local address — including cloud
 * metadata (169.254.169.254) and DNS names that point at internal IPs.
 *
 * Best-effort: it resolves the hostname once and checks the result. A determined
 * DNS-rebinding attacker could still race the resolution, but this closes the
 * practical exposure (direct internal IPs/hostnames and metadata endpoints).
 */

import { lookup } from "node:dns/promises";
import net from "node:net";

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true; // malformed → refuse
  const [a, b] = parts;
  if (a === 0) return true; // "this" network
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  const low = ip.toLowerCase();
  if (low === "::1" || low === "::") return true; // loopback / unspecified
  if (low.startsWith("::ffff:")) return isPrivateIpv4(low.slice(7)); // v4-mapped
  if (low.startsWith("fc") || low.startsWith("fd")) return true; // unique-local
  if (low.startsWith("fe80")) return true; // link-local
  return false;
}

/**
 * Resolve + validate a URL. Throws on anything unsafe to fetch. Returns the
 * parsed URL on success.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  const host = u.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) {
    throw new Error("Refusing to fetch an internal host");
  }

  let ips: string[];
  if (net.isIP(host)) {
    ips = [host];
  } else {
    try {
      const res = await lookup(host, { all: true });
      ips = res.map((r) => r.address);
    } catch {
      throw new Error("Could not resolve host");
    }
  }
  if (ips.length === 0 || ips.some(isPrivateIp)) {
    throw new Error("Refusing to fetch a private/internal address");
  }
  return u;
}

/** Boolean form — true if the URL is safe to fetch server-side. */
export async function isPublicUrl(raw: string): Promise<boolean> {
  try {
    await assertPublicUrl(raw);
    return true;
  } catch {
    return false;
  }
}
