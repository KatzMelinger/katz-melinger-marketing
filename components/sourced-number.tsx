/**
 * An SEO number with its source (Oct 6 spec, Task 17): DataForSEO or Search
 * Console with the date it was fetched, or an AI estimate shown grey and
 * labelled "estimate". A number with no known source is treated as an
 * estimate.
 */

type Source = "dataforseo" | "gsc" | "ai_estimate" | string | null | undefined;

const LABEL: Record<string, string> = { dataforseo: "DataForSEO", gsc: "Search Console" };

export function SourcedNumber({
  value,
  source,
  fetchedAt,
  className = "",
}: {
  value: number | null | undefined;
  source: Source;
  fetchedAt?: string | null;
  className?: string;
}) {
  if (value == null) return <span className={`text-slate-400 ${className}`}>—</span>;
  const real = source === "dataforseo" || source === "gsc";
  const date = fetchedAt
    ? new Date(fetchedAt).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })
    : null;
  return real ? (
    <span className={className} title={`${LABEL[source as string]}${date ? `, ${date}` : ""}`}>
      {value.toLocaleString()}
      <span className="ml-1 align-middle text-[9px] uppercase tracking-wide text-slate-400">
        {source === "gsc" ? "GSC" : "DFS"}
        {date ? ` ${date}` : ""}
      </span>
    </span>
  ) : (
    <span className={`text-slate-400 ${className}`} title="AI estimate: not from DataForSEO or Search Console; never used to choose a keyword">
      {value.toLocaleString()}
      <span className="ml-1 align-middle text-[9px] italic">estimate</span>
    </span>
  );
}
