"use client";

/**
 * Set a new password.
 *
 * Reached after /auth/confirm verifies a recovery link and establishes a
 * session. We confirm the session client-side, then let the user choose a new
 * password via supabase.auth.updateUser. No marketing chrome — standalone like
 * /login.
 *
 * Listed in proxy PUBLIC_PATHS so it loads even if the session cookie hasn't
 * propagated yet; the form itself is gated on an actual session.
 */

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

export default function ResetPasswordPage() {
  const [ready, setReady] = useState<"checking" | "ok" | "no-session">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    supabase.auth.getSession().then(({ data }) => {
      setReady(data.session ? "ok" : "no-session");
    });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const supabase = getSupabaseBrowser();
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) {
        setError(updErr.message);
        setSubmitting(false);
        return;
      }
      setDone(true);
      // Hard refresh so server components pick up the refreshed session.
      window.setTimeout(() => {
        window.location.href = "/";
      }, 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update password.");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm border border-slate-200 rounded-xl p-6 bg-white shadow-sm">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-brand">Set a new password</h1>
          <p className="text-sm text-slate-600 mt-1">
            Choose a password to finish signing in.
          </p>
        </div>

        {ready === "checking" && (
          <p className="text-sm text-slate-500">Checking your reset link…</p>
        )}

        {ready === "no-session" && (
          <div className="text-sm text-slate-600 space-y-3">
            <p className="text-red-700">
              This reset link is invalid or has expired.
            </p>
            <p>
              Open the most recent “reset your password” email and click the link
              again, or ask an admin to send a new one.
            </p>
            <a href="/login" className="text-brand hover:underline">
              Back to sign in
            </a>
          </div>
        )}

        {ready === "ok" && !done && (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-700">New password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                className="w-full mt-1 px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">Confirm password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
                className="w-full mt-1 px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
            </div>

            {error && <p className="text-sm text-red-700">{error}</p>}

            <button
              type="submit"
              disabled={submitting || !password || !confirm}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-brand text-white hover:bg-brand/90 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Set password"}
            </button>
          </form>
        )}

        {done && (
          <p className="text-sm text-emerald-700">
            Password updated. Taking you to the dashboard…
          </p>
        )}
      </div>
    </div>
  );
}
