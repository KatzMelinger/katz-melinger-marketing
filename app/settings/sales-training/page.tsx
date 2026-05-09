import { SalesTrainingClient } from "@/app/settings/sales-training/sales-training-client";
import { MarketingNav } from "@/components/marketing-nav";

export const dynamic = "force-dynamic";

export default function SalesTrainingPage() {
  return (
    <div
      className="min-h-full text-slate-900"
      style={{ backgroundColor: "#ffffff", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Sales coach</h1>
          <p className="mt-1 text-sm text-slate-500">
            The materials and rubric the AI uses to score every call. Defaults come from the firm&apos;s SOPs (5.1.x and 5.2.x). Edit a rubric dimension below and the change applies to every future scoring run.
          </p>
        </div>
        <SalesTrainingClient />
      </main>
    </div>
  );
}
