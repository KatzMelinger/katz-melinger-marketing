/**
 * Campaigns Ops Hub — paid + owned channels.
 *
 * Groups paid ads (Google / Meta), email marketing (Constant Contact),
 * and broader campaign operations into a single landing page. Sub-area
 * cards link out to the existing detail pages — this is a router, not
 * a deep dashboard.
 */

import type { Metadata } from "next";

import { HubShell, type HubCard, type HubKpi } from "@/components/hub-shell";
import { getRequestOrigin } from "@/lib/request-origin";
import { APP_NAME } from "@/lib/app-config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Campaigns Hub | ${APP_NAME}`,
  description:
    "Paid ads, email marketing, and campaign operations.",
};

async function fetchJsonSafe<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type AdConnectionsPayload = {
  connections?: Array<{ provider?: string; status?: string }>;
  google?: { connected?: boolean };
  meta?: { connected?: boolean };
};

type CcPayload = {
  email_campaigns?: unknown[];
  campaigns?: unknown[];
  contact_count?: number;
};

type CcListsPayload = {
  lists?: Array<{ membership_count?: number }>;
};

export default async function CampaignsHubPage() {
  const base = await getRequestOrigin();

  const [adsConnections, ccCampaigns, ccLists] = await Promise.all([
    fetchJsonSafe<AdConnectionsPayload>(`${base}/api/ads/connections`),
    fetchJsonSafe<CcPayload>(`${base}/api/constant-contact?include=campaigns`),
    fetchJsonSafe<CcListsPayload>(`${base}/api/constant-contact/lists`),
  ]);

  const connectedProviders =
    adsConnections?.connections?.filter((c) => c?.status === "connected").length ?? 0;
  const campaigns = ccCampaigns?.email_campaigns ?? ccCampaigns?.campaigns ?? [];
  const totalContacts =
    ccLists?.lists?.reduce((sum, l) => sum + (l.membership_count ?? 0), 0) ?? null;

  const kpis: HubKpi[] = [
    {
      label: "Ad providers connected",
      value: connectedProviders.toString(),
      hint: "Google Ads, Meta, etc.",
      tone: connectedProviders > 0 ? "blue" : "neutral",
    },
    {
      label: "Email campaigns",
      value: campaigns.length.toString(),
      hint: "From Constant Contact",
      tone: "neutral",
    },
    {
      label: "Email contacts",
      value: totalContacts != null ? totalContacts.toLocaleString() : "—",
      hint: "Total list membership",
      tone: "neutral",
    },
    {
      label: "Lists",
      value: (ccLists?.lists?.length ?? 0).toString(),
      hint: "Constant Contact segments",
      tone: "neutral",
    },
  ];

  const cards: HubCard[] = [
    {
      href: "/ads",
      label: "Paid Ads",
      description:
        "Google Ads, Meta, and other paid acquisition channels — spend, conversions, creative compliance.",
      metric: connectedProviders > 0 ? `${connectedProviders} connected` : "Configure",
    },
    {
      href: "/email",
      label: "Email Marketing",
      description:
        "Email campaign overview, performance, and subscriber segmentation.",
    },
    {
      href: "/constant-contact",
      label: "Constant Contact",
      description:
        "Sync contacts, manage lists, and send campaigns directly from Constant Contact.",
      metric: campaigns.length > 0 ? `${campaigns.length} campaigns` : undefined,
    },
    {
      href: "/forms",
      label: "Lead Capture Forms",
      description:
        "Forms feeding paid + organic landing pages; the entry point for most campaigns.",
    },
    {
      href: "/calls",
      label: "Call Tracking",
      description:
        "CallRail-attributed inbound calls — how paid + organic campaigns convert to phone leads.",
    },
    {
      href: "/attribution",
      label: "Cross-channel Attribution",
      description:
        "Source-by-source breakdown of intakes, matters opened, and settlement value.",
    },
  ];

  return (
    <HubShell
      eyebrow="Campaigns Ops Hub"
      title="Paid + owned channel operations"
      subtitle="Manage paid ads, email marketing, and the lead-capture infrastructure that converts campaign traffic into qualified consultations."
      kpis={kpis}
      cards={cards}
      actions={[
        { href: "/ads", label: "Open Ads dashboard", variant: "outline" },
        { href: "/email", label: "Compose email", variant: "primary" },
      ]}
    />
  );
}
