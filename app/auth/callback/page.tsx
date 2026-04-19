"use client";

import { Suspense, useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";

const BG = "#0f1729";
const CARD = "#1a2540";
const BORDER = "#2a3f5f";
const ACCENT = "#185FA5";

function decodeOAuthParam(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s.replace(/\+/g, " ");
  }
}

function CallbackInner() {
  const searchParams = useSearchParams();
  const code = searchParams.get("code");
  const oauthError = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  const [copied, setCopied] = useState(false);
  const [copyErr, setCopyErr] = useState<string | null>(null);

  const handleCopy = useCallback(async () => {
    if (!code) return;
    setCopyErr(null);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyErr(
        "Could not copy automatically. Select the code and copy manually (Ctrl+C).",
      );
    }
  }, [code]);

  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        MarketOS
      </p>
      <h1 className="mt-1 text-xl font-semibold text-white">OAuth callback</h1>
      <p className="mt-2 text-sm text-slate-400">
        This page captures the redirect from your OAuth provider. Copy the authorization
        code below to finish the token exchange manually.
      </p>

      {oauthError ? (
        <div
          className="mt-8 rounded-xl border p-6"
          style={{ backgroundColor: CARD, borderColor: BORDER }}
          role="alert"
        >
          <p className="font-medium text-rose-300">Authorization failed</p>
          <p className="mt-2 font-mono text-sm text-slate-200">{oauthError}</p>
          {errorDescription ? (
            <p className="mt-2 text-sm text-slate-400">
              {decodeOAuthParam(errorDescription)}
            </p>
          ) : null}
        </div>
      ) : !code ? (
        <div
          className="mt-8 rounded-xl border p-6"
          style={{ backgroundColor: CARD, borderColor: BORDER }}
          role="alert"
        >
          <p className="font-medium text-rose-300">No authorization code found</p>
          <p className="mt-2 text-sm text-slate-400">
            The URL should include <code className="text-slate-300">?code=...</code>{" "}
            after you approve access. Start the authorization flow again from your app.
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          <div
            className="rounded-xl border p-6"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <p className="text-sm font-medium text-slate-400">Authorization code</p>
            <pre
              className="mt-3 max-h-48 overflow-auto rounded-lg border border-[#2a3f5f] bg-[#0f1729] p-4 font-mono text-xs leading-relaxed break-all text-slate-200"
              tabIndex={0}
            >
              {code}
            </pre>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="mt-4 rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: ACCENT }}
            >
              {copied ? "Copied!" : "Copy code"}
            </button>
            {copyErr ? (
              <p className="mt-3 text-sm text-amber-200">{copyErr}</p>
            ) : null}
          </div>

          <div
            className="rounded-xl border p-6 text-sm text-slate-300"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <p className="font-semibold text-white">Next steps</p>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-slate-400">
              <li>Copy the code above.</li>
              <li>
                Exchange it at your provider’s token URL using{" "}
                <code className="text-slate-300">grant_type=authorization_code</code>, plus
                client ID, client secret, redirect URI, and the code.
              </li>
              <li>
                Store access and refresh tokens securely and update your MarketOS
                configuration.
              </li>
            </ol>
          </div>
        </div>
      )}
    </main>
  );
}

export default function AuthCallbackPage() {
  return (
    <div
      className="min-h-full text-white"
      style={{ backgroundColor: BG, fontFamily: "Arial, sans-serif" }}
    >
      <Suspense
        fallback={
          <div className="px-4 py-12 text-center text-sm text-slate-400">Loading…</div>
        }
      >
        <CallbackInner />
      </Suspense>
    </div>
  );
}
