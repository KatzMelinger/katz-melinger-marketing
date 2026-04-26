import Link from "next/link";

import { CallDetailClient } from "@/app/calls/[id]/call-detail-client";
import { MarketingNav } from "@/components/marketing-nav";

export const dynamic = "force-dynamic";

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div
      className="min-h-full text-white"
      style={{ backgroundColor: "#0f1729", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <Link href="/calls" className="text-sm text-slate-400 hover:text-white">
            ← Back to calls
          </Link>
        </div>
        <CallDetailClient callId={id} />
      </main>
    </div>
  );
}
