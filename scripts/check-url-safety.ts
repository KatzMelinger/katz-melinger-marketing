/**
 * SSRF guard regression tests.
 *
 *   node scripts/run.mjs scripts/check-url-safety.ts
 *
 * lib/url-safety.ts is the only thing standing between a signed-in user and
 * the server fetching whatever they name — cloud metadata, loopback, the
 * internal network. The cases below are the ones an attacker actually tries,
 * including the redirect bypass that plain fetch(redirect:"follow") cannot
 * defend against.
 *
 * Hits the network: it resolves real hostnames and fetches two real URLs.
 */
import { assertPublicUrl, isPublicUrl, safeFetch } from "@/lib/url-safety";

let pass = 0, fail = 0;
const t = (n: string, c: boolean) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n); } };
const blocked = async (u: string) => !(await isPublicUrl(u));

async function main() {
  console.log("Cloud metadata and loopback:");
  t("169.254.169.254 (AWS/GCP metadata)", await blocked("http://169.254.169.254/latest/meta-data/"));
  t("metadata.google.internal", await blocked("http://metadata.google.internal/"));
  t("127.0.0.1", await blocked("http://127.0.0.1:3000/api/content/drafts"));
  t("localhost", await blocked("http://localhost/"));
  t("[::1]", await blocked("http://[::1]/"));
  t("0.0.0.0", await blocked("http://0.0.0.0/"));

  console.log("\nPrivate ranges:");
  t("10.0.0.1", await blocked("http://10.0.0.1/"));
  t("172.16.0.1", await blocked("http://172.16.0.1/"));
  t("192.168.1.1", await blocked("http://192.168.1.1/"));
  t("100.64.0.1 (CGNAT)", await blocked("http://100.64.0.1/"));
  t("fd00:: (ULA)", await blocked("http://[fd00::1]/"));
  t("fe80:: (link-local)", await blocked("http://[fe80::1]/"));

  console.log("\nEncoding and scheme tricks:");
  t("decimal-encoded 127.0.0.1 (2130706433)", await blocked("http://2130706433/"));
  t("IPv4-mapped IPv6 ::ffff:127.0.0.1", await blocked("http://[::ffff:127.0.0.1]/"));
  t("file://", await blocked("file:///etc/passwd"));
  t("gopher://", await blocked("gopher://127.0.0.1:11211/"));
  t("data:", await blocked("data:text/plain,hi"));
  t(".internal suffix", await blocked("http://vault.internal/"));
  t(".local suffix", await blocked("http://printer.local/"));

  console.log("\nLegitimate targets still work:");
  t("katzmelinger.com is allowed", await isPublicUrl("https://katzmelinger.com/"));
  // A host that will not resolve must be REFUSED, not allowed. Fail-closed on
  // an unknown host is the correct behaviour and is easy to regress into
  // "allow when unsure", so it is asserted explicitly.
  t("an unresolvable host is refused", await blocked("https://no-such-host.invalid/"));
  t("assertPublicUrl returns the parsed URL",
    (await assertPublicUrl("https://katzmelinger.com/about/")).hostname === "katzmelinger.com");

  console.log("\nsafeFetch end to end:");
  try {
    await safeFetch("http://169.254.169.254/latest/meta-data/", { timeoutMs: 4000 });
    t("safeFetch refuses metadata", false);
  } catch (e) {
    t("safeFetch refuses metadata (" + (e as Error).message + ")", true);
  }
  try {
    const r = await safeFetch("https://katzmelinger.com/", { timeoutMs: 15000 });
    t("safeFetch fetches a real page (HTTP " + r.status + ")", r.ok);
  } catch (e) {
    t("safeFetch fetches a real page — " + (e as Error).message, false);
  }
  // The redirect case is the one raw fetch could not defend: a public host that
  // 302s inward. httpbin echoes an arbitrary Location, which is exactly the
  // shape of an open redirect.
  try {
    await safeFetch("https://httpbin.org/redirect-to?url=http://169.254.169.254/", { timeoutMs: 12000 });
    t("safeFetch blocks a redirect INTO metadata", false);
  } catch (e) {
    const m = (e as Error).message;
    t("safeFetch blocks a redirect into metadata (" + m.slice(0, 60) + ")", /Redirect blocked|private|internal/i.test(m));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
