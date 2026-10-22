/**
 * Publishing (Oct 20 spec, Task A12, and the "can publish" permission),
 * checked offline.
 *
 *   node scripts/run.mjs scripts/check-publish.ts
 *
 * Read-only, no DB, no network: who may publish, which plugin versions get
 * the new actions, and what the live page check calls a problem.
 */
import { parsePublishers } from "../lib/publish-permission";
import { pluginAtLeast } from "../lib/wp-content-publish";
import { articleLinks, frameProblems } from "../lib/live-page-check";

let failed = 0;
const check = (ok: boolean, what: string, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${what}${ok || !extra ? "" : `\n        ${extra}`}`);
};

console.log("-- who may publish --------------------------------------------------");
check(parsePublishers('["Diana@KatzMelinger.com", "x@y.com"]').join() === "diana@katzmelinger.com,x@y.com", "a JSON list, lowercased");
check(parsePublishers("diana@katzmelinger.com, kjkatz@katzmelinger.com").length === 2, "a comma list");
check(parsePublishers("not an email").length === 0, "non-emails ignored");
check(parsePublishers("").length === 0, "empty -> nobody beyond Admins");

console.log("\n-- plugin versions ----------------------------------------------------");
check(!pluginAtLeast(null, "0.7.0"), "no version header = 0.6, no go_live / rollback items");
check(!pluginAtLeast("0.6.0", "0.7.0"), "0.6.0 is older");
check(pluginAtLeast("0.7.0", "0.7.0") && pluginAtLeast("0.10.1", "0.7.0"), "0.7.0 and 0.10.1 qualify");

console.log("\n-- the live page check -------------------------------------------------");
const url = "https://katzmelinger.com/collection-agency-law-firm/";
const good = `<html><head><link rel="canonical" href="${url}"><script type="application/ld+json">{"@type":"FAQPage"}</script></head>
<body><article><p><em>Attorney Advertising</em></p><h1>Collection Agency Law Firm</h1>
<p>Reviewed by <a href="https://katzmelinger.com/attorney/adam-j-sackowitz/">Adam Sackowitz</a>, Esq. | Last updated October 2026</p>
<p>See <a href="/commercial-collections/">collections</a> and <a href="https://www.nysenate.gov/legislation/laws/CVP/5222">CPLR 5222</a>.</p>
<p><strong>Call today at <a href="tel:+12124600047">212-460-0047</a> for a Free Confidential Case Evaluation.</strong></p>
<p><em>This article is for general informational purposes only, is not legal advice...</em></p></article></body></html>`;
const args = { url, offerPhrase: "Free Confidential Case Evaluation", expectReviewedBy: true, expectFaqSchema: true, language: "en" as const };
check(frameProblems(good, args).length === 0, "a correct page has no problems", frameProblems(good, args).join("; "));
check(frameProblems(good.replace("Attorney Advertising", ""), args).some((p) => /label/.test(p)), "missing label");
check(frameProblems(good.replace(/Reviewed by/, "Pending attorney review:"), args).some((p) => /Pending attorney review/.test(p)), "a pending byline on a live page is a problem");
check(frameProblems(good.replace(`href="${url}"`, 'href="https://katzmelinger.com/other/"'), args).some((p) => /canonical/.test(p)), "canonical pointing elsewhere");
check(frameProblems(good.replace("<head>", '<head><meta name="robots" content="noindex">'), args).some((p) => /noindex/.test(p)), "noindex");
check(frameProblems(good.replace('{"@type":"FAQPage"}', '{"@type":"Article"}'), args).some((p) => /FAQPage/.test(p)), "missing FAQPage schema");
const links = articleLinks(good, url);
check(links.includes("https://katzmelinger.com/commercial-collections/") && !links.some((l) => l.startsWith("tel:")), "article links resolved, tel: skipped");

console.log(failed === 0 ? "\nall passed" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
