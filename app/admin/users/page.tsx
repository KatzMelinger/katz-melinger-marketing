"use client";

/**
 * Admin user management.
 *
 * Lists every app_user, lets admins invite new ones (Supabase sends an
 * invitation email), promote/demote, disable/enable, and remove. Visible
 * only to users with role='admin' — non-admins get a 403 from the API and
 * the sidebar hides this link entirely.
 */

import { useEffect, useState } from "react";

type AppUser = {
  user_id: string;
  email: string;
  role: "user" | "admin";
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"user" | "admin">("user");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load users");
        return;
      }
      setUsers(data.users ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setInviteError(null);
    setInviteSuccess(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInviteError(data.error || "Invite failed");
        return;
      }
      setInviteSuccess(`Invitation sent to ${inviteEmail}.`);
      setInviteEmail("");
      setInviteRole("user");
      refresh();
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Invite failed");
    } finally {
      setInviting(false);
    }
  };

  const setRole = async (u: AppUser, role: "user" | "admin") => {
    await fetch(`/api/admin/users/${u.user_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    refresh();
  };

  const setStatus = async (u: AppUser, status: "active" | "disabled") => {
    await fetch(`/api/admin/users/${u.user_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    refresh();
  };

  const remove = async (u: AppUser) => {
    if (!confirm(`Delete user ${u.email}? This cannot be undone.`)) return;
    await fetch(`/api/admin/users/${u.user_id}`, { method: "DELETE" });
    refresh();
  };

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Users & permissions</h1>
        <p className="text-sm text-slate-600 mt-1 max-w-2xl">
          Invite teammates and manage their access. Admins can change settings,
          add users, and manage integrations. Users can use every dashboard
          feature but can't change settings or invite others.
        </p>
      </div>

      <div className="border border-slate-200 rounded-lg p-4 bg-white mb-6">
        <h2 className="text-sm font-semibold mb-3">Invite a teammate</h2>
        <form onSubmit={invite} className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-64">
            <label className="text-xs font-medium text-slate-700">Email</label>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teammate@katzmelinger.com"
              required
              className="w-full mt-1 px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30 focus:border-[#185FA5]"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700">Role</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as "user" | "admin")}
              className="mt-1 px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30 focus:border-[#185FA5]"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={inviting || !inviteEmail.trim()}
            className="px-3 py-2 rounded-md text-sm font-medium bg-[#185FA5] text-white hover:bg-[#1f6fb8] disabled:opacity-50"
          >
            {inviting ? "Sending…" : "Send invite"}
          </button>
        </form>
        {inviteError && <p className="text-sm text-red-700 mt-2">{inviteError}</p>}
        {inviteSuccess && <p className="text-sm text-emerald-700 mt-2">{inviteSuccess}</p>}
      </div>

      {error && (
        <div className="border border-red-200 rounded-md p-3 text-sm text-red-700 bg-red-50 mb-4">
          {error}
        </div>
      )}

      <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500 bg-slate-50">
            <tr>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Added</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  No users yet. Invite one above.
                </td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.user_id}>
                <td className="px-4 py-2 font-medium">{u.email}</td>
                <td className="px-4 py-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                      u.role === "admin"
                        ? "bg-violet-50 text-violet-700 border-violet-200"
                        : "bg-slate-50 text-slate-600 border-slate-200"
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                      u.status === "active"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}
                  >
                    {u.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-slate-500">
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-2 text-right space-x-2">
                  {u.role === "user" ? (
                    <button
                      onClick={() => setRole(u, "admin")}
                      className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-[#185FA5] hover:text-[#185FA5]"
                    >
                      Make admin
                    </button>
                  ) : (
                    <button
                      onClick={() => setRole(u, "user")}
                      className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-amber-500 hover:text-amber-700"
                    >
                      Demote
                    </button>
                  )}
                  {u.status === "active" ? (
                    <button
                      onClick={() => setStatus(u, "disabled")}
                      className="text-xs px-2 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-50"
                    >
                      Disable
                    </button>
                  ) : (
                    <button
                      onClick={() => setStatus(u, "active")}
                      className="text-xs px-2 py-1 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                    >
                      Enable
                    </button>
                  )}
                  <button
                    onClick={() => remove(u)}
                    className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
