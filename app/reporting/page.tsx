/**
 * Legacy redirect. Board-ready Reporting (weekly/monthly) is now a tab on the
 * unified /executive workspace, alongside the executive dashboard it shares a
 * funnel with. The page logic lives in ./reporting-client, which the executive
 * workspace imports. Keep this as a server-side redirect so old bookmarks and
 * in-app links keep working.
 */

import { redirect } from "next/navigation";

export default function ReportingRedirect(): never {
  redirect("/executive?tab=reporting");
}
