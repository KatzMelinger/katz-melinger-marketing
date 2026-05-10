/**
 * Legacy /seo/competitors/add page.
 *
 * Adding competitors is now done inline on /seo/competitors. This route
 * permanently redirects to keep any existing bookmarks / links working.
 */

import { redirect } from "next/navigation";

export default function AddCompetitorPage() {
  redirect("/seo/competitors");
}
