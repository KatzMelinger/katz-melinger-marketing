/**
 * Oct 20 spec, Task A16: social and video built from published content.
 * The video disclosure in the caption, results line and disclaimer link;
 * where repurposing may start; which post claims are inherited and which
 * must go through the source check.
 *
 *   node scripts/run.mjs scripts/check-social-video.ts
 */
import {
  AI_PERFORMER_DISCLOSURE,
  ensureVideoDisclosure,
  isFirmUrl,
  isVideoFormat,
  mentionsResult,
  sameClaim,
  splitPostClaims,
  videoDisclosureProblems,
} from "../lib/social-from-content";
import type { SourceCheckEntry } from "../lib/source-check";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const URL = "https://katzmelinger.com/disclaimer/";
check("Kenneth's wording", AI_PERFORMER_DISCLOSURE === "Attorney Advertising. AI-Generated Performer");
check("reels and short videos are video formats", isVideoFormat("reel") && isVideoFormat("video_short") && !isVideoFormat("carousel") && !isVideoFormat(null));

const bare = "Were you fired for asking about overtime? Here is what New York law says. Call 646-466-6267.";
check("a bare caption is missing the disclosure and the link", videoDisclosureProblems(bare, URL).length === 2, JSON.stringify(videoDisclosureProblems(bare, URL)));
const fixed = ensureVideoDisclosure(bare, URL);
check("ensure adds what is missing", videoDisclosureProblems(fixed, URL).length === 0, fixed);
check("ensure is idempotent", ensureVideoDisclosure(fixed, URL) === fixed);
check("a disclosure in other casing counts", videoDisclosureProblems(`${bare}\nattorney advertising. ai-generated performer\n${URL}`, URL).length === 0);

const result = "We recovered $250,000 for a restaurant worker last year.";
check("a result is recognised", mentionsResult(result) && !mentionsResult(bare));
check("a result without the line is a problem", videoDisclosureProblems(`${result}\n${AI_PERFORMER_DISCLOSURE}\n${URL}`, URL).length === 1);
check("ensure adds the results line too", ensureVideoDisclosure(result, URL).includes("Prior results do not guarantee a similar outcome."));

check("a katzmelinger.com page may be repurposed", isFirmUrl("https://www.katzmelinger.com/blog/overtime/"));
check("another site may not", !isFirmUrl("https://example.com/katzmelinger.com"));

const verified: SourceCheckEntry[] = [
  { hash: "a", sentence: "Most employees must file a charge with the EEOC within 300 days.", type: "deadline", kb_key: "eeoc", kb_label: null, source_url: "https://www.eeoc.gov/", quote: null, verdict: "supported", reason: "", checked_at: "" },
];
check("same figures, same words: the same claim", sameClaim("You must file a charge with the EEOC within 300 days.", verified[0].sentence));
check("a different figure is a new claim", !sameClaim("You must file a charge with the EEOC within 180 days.", verified[0].sentence));
const split = splitPostClaims("You must file a charge with the EEOC within 300 days. Employers with 4 or more employees are covered by the law.", verified);
check("one inherited claim, one new claim", split.inherited.length === 1 && split.fresh.length === 1, JSON.stringify(split));

console.log(failed ? `\n${failed} failed` : "\nAll passed");
process.exit(failed ? 1 : 0);
