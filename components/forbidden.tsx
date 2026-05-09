/**
 * Inline "you don't have access" panel rendered by admin-only route layouts
 * when a non-admin user lands on an admin page.
 */

import Link from "next/link";

export function Forbidden({ feature }: { feature: string }) {
  return (
    <div className="px-4 py-12 sm:px-6 lg:px-8 max-w-2xl mx-auto">
      <div className="border border-amber-200 bg-amber-50 rounded-xl p-8 text-center">
        <div className="text-3xl mb-2" aria-hidden>
          🔒
        </div>
        <h1 className="text-xl font-semibold text-amber-900">Admins only</h1>
        <p className="text-sm text-amber-800 mt-2">
          {feature} is restricted to admin users. If you need access, ask an
          admin to upgrade your role from{" "}
          <span className="font-mono">/admin/users</span>.
        </p>
        <div className="mt-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium border border-amber-300 text-amber-900 hover:bg-amber-100"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
