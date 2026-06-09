/**
 * Tenant provisioning — create a new firm + its first admin in one shot.
 *
 * Shared by the two onboarding paths:
 *   - Self-serve signup   (POST /api/signup, public)
 *   - Manual add          (POST /api/admin/tenants, super-admin only)
 *
 * Why a single function: both paths must do the exact same multi-step setup
 * (tenant row → auth user → app_users reassignment → tenant_settings), and
 * getting the ORDER and the trigger-race handling right in one place avoids
 * subtle divergence.
 *
 * The auth trigger (handle_new_auth_user) auto-inserts an app_users row under
 * the DEFAULT (Katz Melinger) tenant for every new auth user. So after we
 * create the user we MUST upsert that row to point at the new tenant with the
 * admin role — otherwise the new firm's admin would silently land inside KM.
 *
 * Best-effort cleanup: if anything fails after the auth user is created, we
 * delete the user + tenant so a half-provisioned email doesn't block a retry.
 */

import { getSupabaseAdmin } from "@/lib/supabase-server";

export type ProvisionInput = {
  firmName: string;
  adminEmail: string;
  adminPassword: string;
};

export type ProvisionResult = {
  tenantId: string;
  userId: string;
  slug: string;
};

export class ProvisionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

/** Lowercase, strip accents, non-alnum -> hyphen, collapse + trim hyphens. */
function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * Find a slug not already taken by another tenant. Tries the base, then
 * base-2, base-3, … then a short random suffix as a last resort. `nonce`
 * makes the random fallback deterministic for callers that can't use
 * Math.random (e.g. workflow scripts) — pass an integer derived from context.
 */
async function uniqueSlug(
  base: string,
  isTaken: (slug: string) => Promise<boolean>,
  nonce: number,
): Promise<string> {
  const root = base || "firm";
  if (!(await isTaken(root))) return root;
  for (let i = 2; i <= 50; i++) {
    const candidate = `${root}-${i}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  // Extremely unlikely: 49 collisions. Fall back to a derived suffix.
  return `${root}-${(nonce % 100000).toString(36)}`;
}

/**
 * Provision a brand-new tenant and its first admin user.
 *
 * @param input firm name + admin email/password (password is set inline; the
 *              user can log in immediately).
 * @param nonce optional integer for deterministic slug fallback (defaults to a
 *              value derived from the email so it's stable without Math.random).
 */
export async function provisionTenant(
  input: ProvisionInput,
  nonce?: number,
): Promise<ProvisionResult> {
  const firmName = (input.firmName ?? "").trim();
  const email = (input.adminEmail ?? "").trim().toLowerCase();
  const password = input.adminPassword ?? "";

  if (firmName.length < 2) {
    throw new ProvisionError("Firm name is required.", 400);
  }
  if (!EMAIL_RE.test(email)) {
    throw new ProvisionError("A valid admin email is required.", 400);
  }
  if (password.length < MIN_PASSWORD) {
    throw new ProvisionError(
      `Password must be at least ${MIN_PASSWORD} characters.`,
      400,
    );
  }

  const admin = getSupabaseAdmin();
  const derivedNonce =
    nonce ??
    Array.from(email).reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);

  // 1. Reserve a unique slug + create the tenant row.
  const slug = await uniqueSlug(
    slugify(firmName),
    async (s) => {
      const { data } = await admin
        .from("tenants")
        .select("id")
        .eq("slug", s)
        .maybeSingle();
      return Boolean(data);
    },
    derivedNonce,
  );

  const { data: tenant, error: tenantErr } = await admin
    .from("tenants")
    .insert({ slug, name: firmName, status: "active" })
    .select("id")
    .single();
  if (tenantErr || !tenant) {
    throw new ProvisionError(
      `Failed to create firm: ${tenantErr?.message ?? "unknown error"}`,
      500,
    );
  }
  const tenantId = tenant.id as string;

  // 2. Create the auth user (email pre-confirmed so they can log in now).
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr || !created?.user) {
    // Roll back the tenant so we don't leave an orphan.
    await admin.from("tenants").delete().eq("id", tenantId);
    const msg = userErr?.message ?? "could not create user";
    // Surface the common "already registered" case as a clean 409.
    const status = /already|registered|exists/i.test(msg) ? 409 : 400;
    throw new ProvisionError(
      status === 409 ? "That email is already in use." : `Failed to create admin: ${msg}`,
      status,
    );
  }
  const userId = created.user.id;

  try {
    // 3. Reassign the trigger-created app_users row to the new tenant + admin.
    //    Upsert (not update) in case the trigger hasn't materialized the row.
    const { error: auErr } = await admin
      .from("app_users")
      .upsert(
        {
          user_id: userId,
          email,
          tenant_id: tenantId,
          role: "admin",
          status: "active",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (auErr) throw new Error(auErr.message);

    // 4. Seed a tenant_settings row so getTenantConfig has the firm name.
    const { error: tsErr } = await admin
      .from("tenant_settings")
      .upsert(
        { tenant_id: tenantId, firm_name: firmName },
        { onConflict: "tenant_id" },
      );
    if (tsErr) throw new Error(tsErr.message);
  } catch (e) {
    // Best-effort rollback of the user + tenant on partial failure.
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    await admin.from("tenants").delete().eq("id", tenantId).then(undefined, () => {});
    throw new ProvisionError(
      `Failed to finalize firm setup: ${e instanceof Error ? e.message : "unknown error"}`,
      500,
    );
  }

  return { tenantId, userId, slug };
}
