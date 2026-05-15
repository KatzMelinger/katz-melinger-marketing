/**
 * Legacy redirect. Skills management was folded into the unified
 * /brand-voice dashboard so the firm has one place for voice + scoped
 * content directions. Keep this page as a server-side redirect so any old
 * bookmarks or in-app links keep working.
 */

import { redirect } from "next/navigation";

export default function ContentSkillsRedirect(): never {
  redirect("/brand-voice");
}
