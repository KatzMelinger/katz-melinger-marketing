import { MarketingNav } from "@/components/marketing-nav";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <div
      className="min-h-full text-slate-900"
      style={{ backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-2 text-slate-500">
          Environment variables for this app:{" "}
          <code className="text-slate-600">CMS_API_URL</code>,{" "}
          <code className="text-slate-600">API_SECRET_KEY</code>, CallRail, Supabase,
          GA4, Google service account JSON, Anthropic, etc.
        </p>
      </main>
    </div>
  );
}
