/**
 * CRM / intake-system provider abstraction.
 *
 * Law firms run wildly different systems of record — Clio, Litify, Lawmatics,
 * MyCase, Filevine, Salesforce, or (here) a bespoke internal CMS. The marketing
 * app must read intakes / matters / revenue from whichever one a tenant uses,
 * so we hide each behind a common `CrmProvider` interface (same shape as the
 * AEO multi-provider layer in lib/aeo-providers.ts).
 *
 * A provider self-reports availability from its own env config; unconfigured
 * providers are skipped at runtime and shown greyed-out in the UI. Adding a new
 * CRM = drop a file in lib/crm/providers/ and register it — no caller changes.
 *
 * Two tiers of capability:
 *   - bySource:      aggregate funnel counts per marketing source (enough for
 *                    the attribution funnel that exists today).
 *   - intakeRecords: individual intake rows with a phone/email — the keystone
 *                    that unlocks per-lead matching (call → intake → matter)
 *                    in Phase 2. Many CRMs expose this; some only expose rollups.
 */

export type CrmProviderId =
  | "katz-cms"
  | "clio"
  | "lawmatics"
  | "litify"
  | "mycase"
  | "filevine"
  | "salesforce";

export type DateWindow = {
  since?: string | null; // ISO or YYYY-MM-DD
  until?: string | null;
};

export type SourceCount = { source: string; count: number };

export type SourceRevenue = { source: string; settlements: number; revenue: number };

/** One intake/lead record from the CRM, normalized across providers. */
export type IntakeRecord = {
  id: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  areaOfLaw: string | null;
  createdAt: string | null;
  status: string | null;
  /** Estimated/realized matter value when the CRM exposes it. */
  matterValue: number | null;
};

export type CrmCapabilities = {
  bySource: boolean;
  intakeRecords: boolean;
};

export interface CrmProvider {
  id: CrmProviderId;
  label: string;
  /** True when this provider has the env config it needs to make calls. */
  isAvailable(): boolean;
  capabilities: CrmCapabilities;

  getIntakesBySource(window?: DateWindow): Promise<SourceCount[]>;
  getMattersBySource(window?: DateWindow): Promise<SourceCount[]>;
  getRevenueBySource(window?: DateWindow): Promise<SourceRevenue[]>;

  /** Present only when capabilities.intakeRecords is true. */
  getIntakeRecords?(window?: DateWindow): Promise<IntakeRecord[]>;
}

export class CrmNotImplementedError extends Error {
  constructor(provider: CrmProviderId, method: string) {
    super(`CRM provider "${provider}" does not implement ${method} yet.`);
    this.name = "CrmNotImplementedError";
  }
}
