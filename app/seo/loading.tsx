export default function SeoLoading() {
  return (
    <div
      className="min-h-screen text-white"
      style={{ backgroundColor: "#0f1729", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="h-6 w-64 animate-pulse rounded bg-white/10" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-[#1a2540]" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl bg-[#1a2540]" />
      </main>
    </div>
  );
}
