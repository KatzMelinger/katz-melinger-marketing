/**
 * /seo/suggestions has been folded into the Recommendations queue.
 *
 * The standalone SEO Strategy Engine queue is now the "SEO" source filter
 * inside /recommendations, so this route permanently redirects there with that
 * filter pre-applied. Kept as a redirect (not deleted) so existing links and
 * bookmarks keep working.
 */

import { redirect } from "next/navigation";

export default function SuggestionsRedirect() {
  redirect("/recommendations?category=seo");
}
