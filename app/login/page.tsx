"use client";

/**
 * Email + password login.
 *
 * No marketing chrome (no sidebar) — this is a standalone page so users can
 * sign in before they see anything else.
 */

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  const [resetSent, setResetSent] = useState(false);

  // If somehow we land here while already authenticated, bounce to next.
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace(next);
    });
  }, [next, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowser();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(signInError.message);
        setSubmitting(false);
        return;
      }
      // Hard refresh so server components see the new session cookie.
      window.location.href = next;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
      setSubmitting(false);
    }
  };

  const requestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowser();
      // resetPasswordForEmail succeeds whether or not the account exists (no
      // user enumeration), so we always show the same confirmation.
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
      );
      if (resetErr) {
        setError(resetErr.message);
        setSubmitting(false);
        return;
      }
      setResetSent(true);
      setSubmitting(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send reset email.");
      setSubmitting(false);
    }
  };

  const switchMode = (m: "signin" | "forgot") => {
    setMode(m);
    setError(null);
    setResetSent(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm border border-slate-200 rounded-xl p-6 bg-white shadow-sm">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-[#185FA5]">KatzMelinger Marketing</h1>
          <p className="text-sm text-slate-600 mt-1">
            {mode === "signin" ? "Sign in to continue." : "Reset your password."}
          </p>
        </div>

        {mode === "signin" ? (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-700">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                className="w-full mt-1 px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30 focus:border-[#185FA5]"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-700">Password</label>
                <button
                  type="button"
                  onClick={() => switchMode("forgot")}
                  className="text-xs text-[#185FA5] hover:underline"
                >
                  Forgot password?
                </button>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="w-full mt-1 px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30 focus:border-[#185FA5]"
              />
            </div>

            {error && <p className="text-sm text-red-700">{error}</p>}

            <button
              type="submit"
              disabled={submitting || !email || !password}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-[#185FA5] text-white hover:bg-[#1f6fb8] disabled:opacity-50"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : resetSent ? (
          <div className="text-sm text-slate-600 space-y-3">
            <p className="text-emerald-700">
              If an account exists for that email, we’ve sent a link to reset
              your password. Check your inbox.
            </p>
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="text-[#185FA5] hover:underline"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={requestReset} className="space-y-3">
            <p className="text-xs text-slate-500">
              Enter your email and we’ll send you a link to set a new password.
            </p>
            <div>
              <label className="text-xs font-medium text-slate-700">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                className="w-full mt-1 px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30 focus:border-[#185FA5]"
              />
            </div>

            {error && <p className="text-sm text-red-700">{error}</p>}

            <button
              type="submit"
              disabled={submitting || !email}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-[#185FA5] text-white hover:bg-[#1f6fb8] disabled:opacity-50"
            >
              {submitting ? "Sending…" : "Send reset link"}
            </button>
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="w-full text-xs text-slate-500 hover:text-[#185FA5] hover:underline"
            >
              Back to sign in
            </button>
          </form>
        )}

        {mode === "signin" && (
          <p className="text-xs text-slate-500 mt-6">
            New firm? <a href="/signup" className="text-[#185FA5] hover:underline">Create a firm account</a>. Otherwise, don't have an account? Ask an admin to invite you.
          </p>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div />}>
      <LoginForm />
    </Suspense>
  );
}
