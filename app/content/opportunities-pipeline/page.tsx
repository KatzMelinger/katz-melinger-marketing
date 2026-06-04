/**
 * /content/opportunities-pipeline has been combined into the single
 * Opportunities surface.
 *
 * The two opportunity tools (this Tier-3 scoring pipeline and the SEO
 * Opportunity Radar) are consolidated into /seo/opportunities, which feeds the
 * Production Board. This route permanently redirects there so existing links
 * and bookmarks keep working.
 */

import { redirect } from "next/navigation";

export default function OpportunitiesPipelineRedirect() {
  redirect("/seo/opportunities");
}
