/**
 * The locked closing CTA for blogs and web pages (Sept 28 spec, section 6):
 * "Call today at <phone> for a Free Confidential Case Evaluation."
 *
 * The phone is the operating brief's document/web number and the phrase is the
 * offer phrase, both read from brand_voice_settings with code defaults, so the
 * approval rule that checks the phone and the generator that writes it can
 * never disagree.
 */
import { getOperatingBrief } from "@/lib/social-operating-brief";

export async function closingCtaFor(
  tenantId?: string,
): Promise<{ phone: string; offerPhrase: string }> {
  const brief = await getOperatingBrief(tenantId);
  return { phone: brief.documentPhone, offerPhrase: brief.offerPhrase };
}
