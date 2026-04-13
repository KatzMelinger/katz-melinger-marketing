import { MarketingNav } from "@/components/marketing-nav";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <div
      className="min-h-full text-white"
      style={{ backgroundColor: "#0f1729", fontFamily: "Arial, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-2xl font-semibold text-white">Settings</h1>
        <p className="mt-2 text-slate-400">
          Environment variables for this app:{" "}
          <code className="text-slate-300">CMS_API_URL</code>,{" "}
          <code className="text-slate-300">API_SECRET_KEY</code>, CallRail, Supabase,
          GA4, Google service account JSON, Anthropic, etc.
        </p>
      </main>
    </div>
  );
}
