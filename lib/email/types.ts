/**
 * Email-distribution provider abstraction (Workstream B1).
 *
 * Email marketing was hardwired to Constant Contact. Law firms use all sorts of
 * platforms (Constant Contact, Mailchimp, SendGrid/Twilio, HubSpot…), so we hide
 * each behind a common `EmailProvider` interface — the same registry pattern as
 * lib/crm/* and lib/aeo-providers.ts. A provider self-reports availability from
 * its env config; the active one per tenant is chosen in lib/email/registry.ts
 * (tenant_settings.email_provider → EMAIL_PROVIDER env pin → first available).
 *
 * Adding a provider = drop a file in lib/email/providers/ and register it. No
 * caller changes — /api/email resolves through the registry.
 */

export type EmailProviderId =
  | "constant-contact"
  | "mailchimp"
  | "sendgrid"
  | "hubspot";

export type EmailList = { id: string; name: string; contacts: number };

export type EmailCampaign = {
  id: string;
  name: string;
  subject: string;
  sentAt: string;
  openRate: number;
  clickRate: number;
  bounceRate: number;
};

export type EmailSequence = {
  id: string;
  name: string;
  status: "active" | "paused";
  enrolledContacts: number;
};

/** Normalized dashboard payload the /email page renders, provider-agnostic. */
export type EmailDashboard = {
  connected: boolean;
  error?: string;
  selectedListId: string | null;
  availableLists: EmailList[];
  dashboard: {
    avgOpenRate: number;
    avgClickRate: number;
    avgBounceRate: number;
    contacts: number;
    monthlyGrowth: number;
  };
  campaigns: EmailCampaign[];
  contactLists: { name: string; contacts: number; growthRate: number }[];
  sequences: EmailSequence[];
};

export interface EmailProvider {
  id: EmailProviderId;
  label: string;
  /** True when this provider has the env config it needs (OAuth client / API key). */
  isAvailable(): boolean;
  /** True when a usable token/credential is actually stored for this tenant. */
  isConnected(tenantId?: string): Promise<boolean>;
  /** The lists/audiences a campaign can target. */
  listLists(tenantId?: string): Promise<EmailList[]>;
  /** Aggregated campaign metrics + lists for the dashboard. */
  getDashboard(opts?: { listId?: string | null; tenantId?: string }): Promise<EmailDashboard>;
}

export class EmailNotImplementedError extends Error {
  constructor(provider: EmailProviderId, method: string) {
    super(`Email provider "${provider}" does not implement ${method} yet.`);
    this.name = "EmailNotImplementedError";
  }
}

/** Empty dashboard a route can return when nothing is connected/implemented. */
export function emptyEmailDashboard(error?: string): EmailDashboard {
  return {
    connected: false,
    error,
    selectedListId: null,
    availableLists: [],
    dashboard: { avgOpenRate: 0, avgClickRate: 0, avgBounceRate: 0, contacts: 0, monthlyGrowth: 0 },
    campaigns: [],
    contactLists: [],
    sequences: [],
  };
}
