import type { Metadata } from "next";

import { ExecutiveClient } from "@/app/executive/executive-client";
import { MarketingNav } from "@/components/marketing-nav";
import { APP_NAME } from "@/lib/app-config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Executive dashboard | ${APP_NAME}`,
};

export default function ExecutivePage() {
  return (
    <div
      className="min-h-full text-slate-900"
      style={{ backgroundColor: "#ffffff", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Executive dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            One board, end to end: spend → site sessions → calls → intakes → matters → revenue. Pick a date
            range and every figure compares against the equally-long period before it.
          </p>
        </div>
        <ExecutiveClient />
      </main>
    </div>
  );
}
