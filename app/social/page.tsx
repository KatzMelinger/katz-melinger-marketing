import Link from "next/link";

import { MarketingNav } from "@/components/marketing-nav";

export const dynamic = "force-dynamic";

export default function SocialPlaceholderPage() {
  return (
    <div
      className="min-h-full text-white"
      style={{ backgroundColor: "#0f1729", fontFamily: "Arial, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-2xl font-semibold text-white">Social</h1>
        <p className="mt-2 text-slate-400">
          Placeholder — scheduled posts and performance will live here. Use{" "}
          <Link href="/content" className="text-[#185FA5] hover:underline">
            Content
          </Link>{" "}
          for AI drafting today.
        </p>
      </main>
    </div>
  );
}
