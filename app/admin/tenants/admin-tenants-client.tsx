"use client";

/**
 * Super-admin tenant console UI. Lists every firm, lets the operator create a
 * firm + first admin manually, and suspend/reactivate firms. All data comes
 * from /api/admin/tenants (gated server-side by requireSuperAdmin).
 */

import { useCallback, useEffect, useState } from "react";

type TenantRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  primary_domain: string | null;
  created_at: string;
  user_count: number;
  admin_count: number;
};

export function AdminTenantsClient() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-firm form state.
  const [firmName, setFirmName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/tenants");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Failed to load tenants");
      setTenants(data.tenants ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tenants");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createFirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateErr(null);
    setCreateMsg(null);
    if (password.length < 8) {
      setCreateErr("Password must be at least 8 characters.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firmName: firmName.trim(), email: email.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Create failed");
      setCreateMsg(`Created "${firmName.trim()}" (slug: ${data.slug}).`);
      setFirmName("");
      setEmail("");
      setPassword("");
      await load();
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const toggleStatus = async (t: TenantRow) => {
    const next = t.status === "suspended" ? "active" : "suspended";
    if (next === "suspended" && !confirm(`Suspend "${t.name}"?`)) return;
    try {
      const res = await fetch(`/api/admin/tenants/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Update failed");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-[#185FA5]">Firms</h1>
        <p className="text-sm text-slate-600 mt-1">
          Every firm on the platform. Create firms manually or let them self-serve at{" "}
          <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">/signup</code>.
        </p>
      </div>

      {/* Add firm */}
      <div className="border border-slate-200 rounded-xl p-5 bg-white">
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Add a firm</h2>
        <form onSubmit={createFirm} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div className="sm:col-span-1">
            <label className="text-xs font-medium text-slate-700">Firm name</label>
            <input
              type="text"
              value={firmName}
              onChange={(e) => setFirmName(e.target.value)}
              required
              className="w-full mt-1 px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900"
            />
          </div>
          <div className="sm:col-span-1">
            <label className="text-xs font-medium text-slate-700">Admin email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full mt-1 px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900"
            />
          </div>
          <div className="sm:col-span-1">
            <label className="text-xs font-medium text-slate-700">Temp password</label>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full mt-1 px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900"
            />
          </div>
          <div className="sm:col-span-1">
            <button
              type="submit"
              disabled={creating || !firmName || !email || !password}
              className="w-full px-3 py-2 rounded-md text-sm font-medium bg-[#185FA5] text-white hover:bg-[#1f6fb8] disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create firm"}
            </button>
          </div>
        </form>
        {createMsg && <p className="text-sm text-green-700 mt-3">{createMsg}</p>}
        {createErr && <p className="text-sm text-red-700 mt-3">{createErr}</p>}
        <p className="text-[11px] text-slate-500 mt-3">
          The admin can sign in immediately with these credentials and change the password later.
        </p>
      </div>

      {/* Tenant list */}
      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
        {loading ? (
          <p className="text-sm text-slate-500 p-5">Loading…</p>
        ) : error ? (
          <p className="text-sm text-red-700 p-5">{error}</p>
        ) : tenants.length === 0 ? (
          <p className="text-sm text-slate-500 p-5">No firms yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <th className="text-left font-medium px-4 py-2">Firm</th>
                <th className="text-left font-medium px-4 py-2">Slug</th>
                <th className="text-left font-medium px-4 py-2">Status</th>
                <th className="text-right font-medium px-4 py-2">Users</th>
                <th className="text-right font-medium px-4 py-2">Admins</th>
                <th className="text-left font-medium px-4 py-2">Created</th>
                <th className="text-right font-medium px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-slate-900">{t.name}</td>
                  <td className="px-4 py-2 text-slate-500">{t.slug}</td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        t.status === "suspended"
                          ? "text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800"
                          : "text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800"
                      }
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-slate-700">{t.user_count}</td>
                  <td className="px-4 py-2 text-right text-slate-700">{t.admin_count}</td>
                  <td className="px-4 py-2 text-slate-500">
                    {t.created_at ? new Date(t.created_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => toggleStatus(t)}
                      className="text-xs font-medium text-[#185FA5] hover:underline"
                    >
                      {t.status === "suspended" ? "Reactivate" : "Suspend"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
