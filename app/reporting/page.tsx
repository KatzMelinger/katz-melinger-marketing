import type { Metadata } from "next";

import { ReportingClient } from "@/app/reporting/reporting-client";
import { MarketingNav } from "@/components/marketing-nav";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reporting | Katz Melinger Marketing",
};

export default function ReportingPage() {
  return (
    <div
      className="min-h-full text-slate-900"
      style={{ backgroundColor: "#ffffff", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Reporting</h1>
          <p className="mt-1 text-sm text-slate-500">
            Board-ready marketing reports. Switch between the <strong>weekly</strong> operating pulse and
            the <strong>monthly</strong> strategic review — every figure compares against the equally-long
            period before it. Print or save to PDF to circulate.
          </p>
        </div>
        <ReportingClient />
      </main>
    </div>
  );
}
