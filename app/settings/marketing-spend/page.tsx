import { MarketingSpendClient } from "@/app/settings/marketing-spend/marketing-spend-client";
import { MarketingNav } from "@/components/marketing-nav";

export const dynamic = "force-dynamic";

export default function MarketingSpendPage() {
  return (
    <div
      className="min-h-full text-slate-900"
      style={{ backgroundColor: "#ffffff", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Marketing spend</h1>
          <p className="mt-1 text-sm text-slate-500">
            Enter what you spent per channel each month. This feeds the Attribution funnel so ROI, CPA, and
            spend efficiency stop reading zero. Use the same channel names the funnel shows (e.g. the
            CallRail source) so spend lines up with calls and revenue.
          </p>
        </div>
        <MarketingSpendClient />
      </main>
    </div>
  );
}
