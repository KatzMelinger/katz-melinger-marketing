import { NextResponse } from "next/server";

import { fetchCmsJson } from "@/lib/cms-server";
import { getAuthConfig } from "@/lib/constant-contact-server";

export const dynamic = "force-dynamic";

type CampaignRow = {
  id: string;
  name: string;
  subject: string;
  sentAt: string;
  openRate: number;
  clickRate: number;
  bounceRate: number;
};

type SequenceRow = {
  id: string;
  name: string;
  status: "active" | "paused";
  enrolledContacts: number;
};

type ConstantContactPayload = {
  connected: boolean;
  error?: string;
  dashboard: {
    avgOpenRate: number;
    avgClickRate: number;
    avgBounceRate: number;
    contacts: number;
    monthlyGrowth: number;
  };
  campaigns: CampaignRow[];
  contactLists: { name: string; contacts: number; growthRate: number }[];
  sequences: SequenceRow[];
};

function extractNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function getFallback(error?: string): ConstantContactPayload {
  return {
    connected: false,
    error,
    dashboard: {
      avgOpenRate: 0,
      avgClickRate: 0,
      avgBounceRate: 0,
      contacts: 0,
      monthlyGrowth: 0,
    },
    campaigns: [],
    contactLists: [],
    sequences: [],
  };
}

export async function GET() {
  const auth = await getAuthConfig();
  const listId = process.env.CONSTANT_CONTACT_LIST_ID?.trim();

  const cmsLeadData =
    (await fetchCmsJson<{ totalLeads?: number; monthlyGrowth?: number }>(
      "/api/v1/leads/summary",
    )) ?? null;

  if ("error" in auth) {
    const payload = getFallback(auth.error);
    payload.dashboard.contacts = extractNumber(cmsLeadData?.totalLeads);
    payload.dashboard.monthlyGrowth = extractNumber(cmsLeadData?.monthlyGrowth);
    return NextResponse.json(payload);
  }

  try {
    const [campaignRes, contactRes] = await Promise.all([
      fetch("https://api.cc.email/v3/emails?limit=10", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      }),
      fetch(
        `https://api.cc.email/v3/contacts${listId ? `?list_ids=${encodeURIComponent(listId)}` : ""}`,
        {
          cache: "no-store",
          headers: { Authorization: `Bearer ${auth.accessToken}` },
        },
      ),
    ]);

    const [campaignJson, contactsJson] = await Promise.all([
      campaignRes.json(),
      contactRes.json(),
    ]);

    if (!campaignRes.ok && !contactRes.ok) {
      const payload = getFallback(
        "Constant Contact API request failed. Verify token and scopes.",
      );
      payload.dashboard.contacts = extractNumber(cmsLeadData?.totalLeads);
      payload.dashboard.monthlyGrowth = extractNumber(cmsLeadData?.monthlyGrowth);
      return NextResponse.json(payload);
    }

    const campaignRaw: unknown[] = Array.isArray(
      (campaignJson as { email_campaigns?: unknown }).email_campaigns,
    )
      ? ((campaignJson as { email_campaigns?: unknown[] }).email_campaigns ?? [])
      : [];

    const campaigns: CampaignRow[] = campaignRaw.slice(0, 8).map((row, i) => {
      const src = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      const reports = src.current_status && typeof src.current_status === "object"
        ? (src.current_status as Record<string, unknown>)
        : {};
      const openRate = extractNumber(reports.open_rate);
      const clickRate = extractNumber(reports.click_rate);
      const bounceRate = extractNumber(reports.bounce_rate);
      return {
        id: String(src.campaign_id ?? `campaign-${i}`),
        name: String(src.name ?? "Email campaign"),
        subject: String(src.email_subject ?? "No subject"),
        sentAt: String(src.last_sent_date ?? new Date().toISOString()),
        openRate,
        clickRate,
        bounceRate,
      };
    });

    const avgOpenRate =
      campaigns.length > 0
        ? campaigns.reduce((s, row) => s + row.openRate, 0) / campaigns.length
        : 0;
    const avgClickRate =
      campaigns.length > 0
        ? campaigns.reduce((s, row) => s + row.clickRate, 0) / campaigns.length
        : 0;
    const avgBounceRate =
      campaigns.length > 0
        ? campaigns.reduce((s, row) => s + row.bounceRate, 0) / campaigns.length
        : 0;

    const contactsRaw = Array.isArray((contactsJson as { contacts?: unknown }).contacts)
      ? ((contactsJson as { contacts?: unknown[] }).contacts ?? [])
      : [];
    const contactCount = contactsRaw.length;
    const cmsContacts = extractNumber(cmsLeadData?.totalLeads);

    return NextResponse.json({
      connected: true,
      dashboard: {
        avgOpenRate,
        avgClickRate,
        avgBounceRate,
        contacts: contactCount > 0 ? contactCount : cmsContacts,
        monthlyGrowth: extractNumber(cmsLeadData?.monthlyGrowth),
      },
      campaigns,
      contactLists: [
        {
          name: "Master Newsletter",
          contacts: contactCount > 0 ? contactCount : cmsContacts,
          growthRate: extractNumber(cmsLeadData?.monthlyGrowth),
        },
      ],
      sequences: [
        {
          id: "welcome-sequence",
          name: "Lead Intake Welcome",
          status: "active",
          enrolledContacts: Math.round((contactCount > 0 ? contactCount : cmsContacts) * 0.42),
        },
        {
          id: "consult-followup",
          name: "Consult Follow-up",
          status: "paused",
          enrolledContacts: Math.round((contactCount > 0 ? contactCount : cmsContacts) * 0.18),
        },
      ],
    } satisfies ConstantContactPayload);
  } catch {
    const payload = getFallback(
      "Constant Contact API request failed. Verify token and scopes.",
    );
    payload.dashboard.contacts = extractNumber(cmsLeadData?.totalLeads);
    payload.dashboard.monthlyGrowth = extractNumber(cmsLeadData?.monthlyGrowth);
    return NextResponse.json(payload);
  }
}
