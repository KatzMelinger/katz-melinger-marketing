/**
 * /admin/tenants — super-admin firm console.
 *
 * Server-gated: non-super-admins are redirected away (the page never renders
 * cross-tenant data for them). The interactive list/create/suspend UI lives in
 * the client component; every data call it makes is independently gated by
 * requireSuperAdmin() in the API routes.
 */

import { redirect } from "next/navigation";

import { isSuperAdmin } from "@/lib/supabase-route";
import { AdminTenantsClient } from "./admin-tenants-client";

export const dynamic = "force-dynamic";

export default async function AdminTenantsPage() {
  if (!(await isSuperAdmin())) {
    redirect("/");
  }
  return <AdminTenantsClient />;
}
