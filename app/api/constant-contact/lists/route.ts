import { fetchContactListsResponse } from "@/lib/constant-contact-server";

export const dynamic = "force-dynamic";

/** Same as GET /api/constant-contact?action=lists */
export async function GET() {
  return fetchContactListsResponse();
}
