import { CoachingTabs } from "@/app/coaching/coaching-tabs";
import { MarketingNav } from "@/components/marketing-nav";

export const dynamic = "force-dynamic";

export default async function CoachingPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await props.searchParams;
  const initialTab = typeof sp.tab === "string" ? sp.tab : undefined;

  return (
    <div
      className="min-h-full text-slate-900"
      style={{ backgroundColor: "#ffffff", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <CoachingTabs initialTab={initialTab} />
      </main>
    </div>
  );
}
