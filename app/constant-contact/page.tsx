/**
 * Legacy redirect. The standalone Constant Contact dashboard was folded into
 * the unified /email page, where Campaigns / Lists / Automation / Analytics are
 * now tabs alongside the Overview summary (the panel logic lives in
 * components/constant-contact-workspace). Keep this as a server-side redirect
 * so old bookmarks, in-app links, and the OAuth return path keep working.
 */

import { redirect } from "next/navigation";

export default function ConstantContactRedirect(): never {
  redirect("/email");
}
