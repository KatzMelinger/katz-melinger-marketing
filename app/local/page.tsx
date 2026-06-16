/**
 * Legacy redirect. The standalone "Local Listings" dashboard was folded into
 * the unified /local-seo page, whose Google Business Profile / Reviews /
 * Rankings / Citations tabs cover everything this page showed (and pull live
 * GBP data instead of the old mock feed). Keep this as a server-side redirect
 * so old bookmarks and in-app links keep working.
 */

import { redirect } from "next/navigation";

export default function LocalListingsRedirect(): never {
  redirect("/local-seo");
}
