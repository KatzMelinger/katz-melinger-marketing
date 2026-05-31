import { CoachingClient } from "@/app/coaching/coaching-client";
import { MarketingNav } from "@/components/marketing-nav";

export const dynamic = "force-dynamic";

export default function CoachingPage() {
  return (
    <div
      className="min-h-full text-slate-900"
      style={{ backgroundColor: "#ffffff", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Agent coaching</h1>
          <p className="mt-1 text-sm text-slate-500">
            Per-rep rollups from AI-scored calls — average score, trend, and the rubric dimensions each
            person most consistently loses points on. Use this to target 1:1 coaching.
          </p>
        </div>
        <CoachingClient />
      </main>
    </div>
  );
}
