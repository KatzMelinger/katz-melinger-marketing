/**
 * Legacy redirect. "Sales Coach" (the call-scoring rubric + SOPs) is now a tab
 * on the unified /coaching workspace, alongside the per-rep coaching rollups it
 * drives. The page logic lives in ./sales-training-client, which the coaching
 * workspace imports. Keep this as a server-side redirect so old bookmarks and
 * in-app links keep working.
 */

import { redirect } from "next/navigation";

export default function SalesTrainingRedirect(): never {
  redirect("/coaching?tab=rubric");
}
