import { SeoAddCompetitorForm } from "@/components/seo-add-competitor-form";
import { SeoShell } from "@/components/seo-shell";

export default function AddCompetitorPage() {
  return (
    <SeoShell
      title="Add Competitor Domain"
      subtitle="Track specific law firm domains for keyword and backlink intelligence."
    >
      <SeoAddCompetitorForm />
    </SeoShell>
  );
}

