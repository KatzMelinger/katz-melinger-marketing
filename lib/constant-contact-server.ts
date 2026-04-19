import { NextResponse } from "next/server";

import { fetchCmsJson } from "@/lib/cms-server";

export const CONSTANT_CONTACT_API_BASE = "https://api.constantcontact.com/v3";

export type ConstantContactApiErrorBody = {
  error_key?: string;
  error_message?: string;
  errors?: Array<{ error_key?: string; error_message?: string }>;
  [key: string]: unknown;
};

export type ContactListRow = {
  list_id?: string;
  name?: string;
  description?: string;
  membership_count?: number;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};

export type ContactListsApiResponse = {
  lists?: ContactListRow[];
  lists_count?: number;
  [key: string]: unknown;
};

export function getAuthConfig(): { accessToken: string } | { error: string } {
  const accessToken = process.env.CONSTANT_CONTACT_ACCESS_TOKEN?.trim();
  const apiKey = process.env.CONSTANT_CONTACT_API_KEY?.trim();

  if (!accessToken) {
    return { error: "Missing CONSTANT_CONTACT_ACCESS_TOKEN" };
  }
  if (!apiKey) {
    return { error: "Missing CONSTANT_CONTACT_API_KEY" };
  }

  return { accessToken };
}

export function authHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

export async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function ccErrorResponse(
  body: unknown,
  res: Response,
  fallback: string,
): NextResponse {
  const err = body as ConstantContactApiErrorBody;
  const message =
    err?.error_message ??
    (typeof err?.error_key === "string" ? err.error_key : null) ??
    fallback;
  return NextResponse.json(
    {
      error: message,
      status: res.status,
      details: body,
    },
    { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
  );
}

export async function fetchContactListsResponse(): Promise<NextResponse> {
  const config = getAuthConfig();
  if ("error" in config) {
    return NextResponse.json({ error: config.error }, { status: 503 });
  }

  const url = `${CONSTANT_CONTACT_API_BASE}/contact_lists?limit=1000&include_membership_count=active`;

  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: authHeaders(config.accessToken),
    });

    const body = await parseJsonSafe(res);

    if (!res.ok) {
      return ccErrorResponse(
        body,
        res,
        `Constant Contact API error (${res.status})`,
      );
    }

    const data = body as ContactListsApiResponse;
    const lists = Array.isArray(data.lists) ? data.lists : [];

    return NextResponse.json({
      lists,
      ...(typeof data.lists_count === "number"
        ? { lists_count: data.lists_count }
        : {}),
      ...(data._links ? { _links: data._links } : {}),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to fetch Constant Contact lists",
        details: message,
      },
      { status: 502 },
    );
  }
}

type SyncContactsResult =
  | { ok: true; synced: number; last_sync_at: string; message?: string }
  | { ok: false; error: string };

/**
 * Verifies the list exists, optionally pulls CMS emails, and upserts contacts into CC.
 * CMS export path is optional; without exported emails, sync still records a successful
 * verification with synced count 0.
 */
export async function syncContactsToList(listId: string): Promise<SyncContactsResult> {
  const config = getAuthConfig();
  if ("error" in config) {
    return { ok: false, error: config.error };
  }

  const { accessToken } = config;

  const listUrl = `${CONSTANT_CONTACT_API_BASE}/contact_lists/${encodeURIComponent(listId)}`;
  const listRes = await fetch(listUrl, {
    cache: "no-store",
    headers: authHeaders(accessToken),
  });
  const listBody = await parseJsonSafe(listRes);
  if (!listRes.ok) {
    const err = listBody as ConstantContactApiErrorBody;
    return {
      ok: false,
      error:
        err?.error_message ??
        (typeof err?.error_key === "string" ? err.error_key : null) ??
        `Constant Contact could not load list (${listRes.status})`,
    };
  }

  const exportPath =
    process.env.CMS_CONTACT_EXPORT_PATH?.trim() || "/api/v1/marketing/contacts-export";

  const cmsPayload = await fetchCmsJson<{
    contacts?: Array<{ email_address?: string; email?: string }>;
    emails?: string[];
  }>(exportPath);

  let emails: string[] = [];
  if (cmsPayload?.emails?.length) {
    emails = cmsPayload.emails.map((e) => e.trim()).filter(Boolean);
  } else if (cmsPayload?.contacts?.length) {
    emails = cmsPayload.contacts
      .map((c) => c.email_address ?? c.email ?? "")
      .map((e) => e.trim())
      .filter(Boolean);
  }

  let synced = 0;
  const last_sync_at = new Date().toISOString();

  for (const address of emails) {
    const body = {
      email_address: { address, permission_to_send: "implicit" },
      create_source: "Account",
      list_memberships: [{ list_id: listId }],
    };
    const postRes = await fetch(`${CONSTANT_CONTACT_API_BASE}/contacts`, {
      method: "POST",
      cache: "no-store",
      headers: authHeaders(accessToken),
      body: JSON.stringify(body),
    });
    if (postRes.ok || postRes.status === 409) {
      synced += 1;
    }
  }

  let message: string | undefined;
  if (emails.length === 0) {
    message =
      cmsPayload === null
        ? "CMS is not configured or the export endpoint failed. Set CMS_API_URL / CMS_API_SECRET_KEY and CMS_CONTACT_EXPORT_PATH (default /api/v1/marketing/contacts-export)."
        : "No email addresses in the CMS export. Expected { emails: string[] } or { contacts: [{ email_address or email }] }.";
  } else if (synced < emails.length) {
    message = `Imported ${synced} of ${emails.length} contact(s); some rows were skipped (duplicate or validation).`;
  }

  return {
    ok: true,
    synced,
    last_sync_at,
    ...(message ? { message } : {}),
  };
}
