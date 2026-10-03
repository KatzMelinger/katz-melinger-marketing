import { Forbidden } from "@/components/forbidden";
import { MarketingNav } from "@/components/marketing-nav";
import { getCurrentUser } from "@/lib/supabase-route";

export const dynamic = "force-dynamic";

/** Intake & Sales shows individual staff performance, so it is admin-only. */
export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return <Forbidden feature="Intake & Sales" />;
  return (
    <div
      className="min-h-full text-slate-900"
      style={{ backgroundColor: "#ffffff", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
