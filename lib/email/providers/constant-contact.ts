/**
 * Constant Contact email provider — the first concrete EmailProvider.
 *
 * Wraps the existing Constant Contact server helpers + REST calls behind the
 * common interface so /api/email can resolve it through the registry instead of
 * importing Constant Contact directly. Logic ported from the old
 * app/api/email/constant-contact route (campaign + contact + list parsing).
 */

import { getAuthConfig, CONSTANT_CONTACT_API_BASE } from "@/lib/constant-contact-server";
import {
  emptyEmailDashboard,
  type EmailDashboard,
  type EmailList,
  type EmailProvider,
} from "@/lib/email/types";

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const p = Number(value);
    if (Number.isFinite(p)) return p;
  }
  return 0;
}

export const constantContactProvider: EmailProvider = {
  id: "constant-contact",
  label: "Constant Contact",

  isAvailable() {
    return (
      Boolean(process.env.CONSTANT_CONTACT_CLIENT_ID?.trim()) &&
      Boolean(process.env.CONSTANT_CONTACT_CLIENT_SECRET?.trim())
    );
  },

  async isConnected() {
    const auth = await getAuthConfig();
    return !("error" in auth);
  },

  async listLists(): Promise<EmailList[]> {
    const auth = await getAuthConfig();
    if ("error" in auth) return [];
    const res = await fetch(
      `${CONSTANT_CONTACT_API_BASE}/contact_lists?limit=50&include_count=true`,
      { cache: "no-store", headers: { Authorization: `Bearer ${auth.accessToken}` } },
    );
    const json = (await res.json().catch(() => ({}))) as { lists?: unknown[] };
    const raw = Array.isArray(json.lists) ? json.lists : [];
    return raw
      .map((row): EmailList | null => {
        const s = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
        const id = s.list_id ?? s.id;
        const name = s.name;
        if (typeof id !== "string" || typeof name !== "string") return null;
        return { id, name, contacts: num(s.membership_count ?? s.member_count) };
      })
      .filter((x): x is EmailList => x !== null)
      .sort((a, b) => b.contacts - a.contacts);
  },

  async getDashboard(opts): Promise<EmailDashboard> {
    const auth = await getAuthConfig();
    if ("error" in auth) return emptyEmailDashboard(auth.error);

    const listId = opts?.listId && opts.listId !== "all" ? opts.listId : null;
    const headers = { Authorization: `Bearer ${auth.accessToken}` };

    try {
      const [campaignRes, contactRes, listsRes] = await Promise.all([
        fetch(`${CONSTANT_CONTACT_API_BASE}/emails?limit=10`, { cache: "no-store", headers }),
        fetch(
          `${CONSTANT_CONTACT_API_BASE}/contacts${listId ? `?list_ids=${encodeURIComponent(listId)}` : ""}`,
          { cache: "no-store", headers },
        ),
        fetch(`${CONSTANT_CONTACT_API_BASE}/contact_lists?limit=50&include_count=true`, {
          cache: "no-store",
          headers,
        }),
      ]);
      const [campaignJson, contactsJson, listsJson] = await Promise.all([
        campaignRes.json(),
        contactRes.json(),
        listsRes.json().catch(() => ({})),
      ]);

      if (!campaignRes.ok && !contactRes.ok) {
        return emptyEmailDashboard("Constant Contact API request failed. Verify token and scopes.");
      }

      const campaignRaw: unknown[] = Array.isArray(
        (campaignJson as { email_campaigns?: unknown }).email_campaigns,
      )
        ? ((campaignJson as { email_campaigns?: unknown[] }).email_campaigns ?? [])
        : [];
      const campaigns = campaignRaw.slice(0, 8).map((row, i) => {
        const src = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
        const reports =
          src.current_status && typeof src.current_status === "object"
            ? (src.current_status as Record<string, unknown>)
            : {};
        return {
          id: String(src.campaign_id ?? `campaign-${i}`),
          name: String(src.name ?? "Email campaign"),
          subject: String(src.email_subject ?? "No subject"),
          sentAt: String(src.last_sent_date ?? new Date().toISOString()),
          openRate: num(reports.open_rate),
          clickRate: num(reports.click_rate),
          bounceRate: num(reports.bounce_rate),
        };
      });
      const avg = (sel: (c: (typeof campaigns)[number]) => number) =>
        campaigns.length > 0 ? campaigns.reduce((s, c) => s + sel(c), 0) / campaigns.length : 0;

      const contactsRaw = Array.isArray((contactsJson as { contacts?: unknown }).contacts)
        ? ((contactsJson as { contacts?: unknown[] }).contacts ?? [])
        : [];
      const contactCount = contactsRaw.length;

      const listsRaw: unknown[] = Array.isArray((listsJson as { lists?: unknown }).lists)
        ? ((listsJson as { lists?: unknown[] }).lists ?? [])
        : [];
      const availableLists: EmailList[] = listsRaw
        .map((row): EmailList | null => {
          const s = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
          const id = s.list_id ?? s.id;
          const name = s.name;
          if (typeof id !== "string" || typeof name !== "string") return null;
          return { id, name, contacts: num(s.membership_count ?? s.member_count) };
        })
        .filter((x): x is EmailList => x !== null)
        .sort((a, b) => b.contacts - a.contacts);

      const contactLists =
        availableLists.length > 0
          ? availableLists.map((l) => ({ name: l.name, contacts: l.contacts, growthRate: 0 }))
          : [{ name: "Master Newsletter", contacts: contactCount, growthRate: 0 }];

      return {
        connected: true,
        selectedListId: listId,
        availableLists,
        dashboard: {
          avgOpenRate: avg((c) => c.openRate),
          avgClickRate: avg((c) => c.clickRate),
          avgBounceRate: avg((c) => c.bounceRate),
          contacts: contactCount,
          monthlyGrowth: 0,
        },
        campaigns,
        contactLists,
        sequences: [
          {
            id: "welcome-sequence",
            name: "Lead Intake Welcome",
            status: "active",
            enrolledContacts: Math.round(contactCount * 0.42),
          },
          {
            id: "consult-followup",
            name: "Consult Follow-up",
            status: "paused",
            enrolledContacts: Math.round(contactCount * 0.18),
          },
        ],
      };
    } catch {
      return emptyEmailDashboard("Constant Contact API request failed. Verify token and scopes.");
    }
  },
};
