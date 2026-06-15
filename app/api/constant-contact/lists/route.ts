import { fetchContactListsResponse } from "@/lib/constant-contact-server";
import { guardUser } from "@/lib/supabase-route";

export const dynamic = "force-dynamic";

/** Same as GET /api/constant-contact?action=lists */
export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;
  return fetchContactListsResponse();
}
