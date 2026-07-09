/**
 * Schema.org template definitions for the schema generator.
 *
 * Each template lists the inputs the marketer fills in plus a structured
 * description of what the resulting JSON-LD should look like. The generator
 * route hands that description (and the firm context) to Claude with
 * tool-use, then writes the final JSON-LD into the AutoPilot queue as a
 * fix_type='schema_jsonld' row that the WP plugin injects into <head>.
 *
 * Why curated templates instead of "generate any schema": (a) the law firm
 * only needs a handful of types in practice, (b) curated forms let us
 * validate inputs upfront, and (c) the resulting JSON-LD is much more
 * consistent across pages.
 */

export type FieldKind =
  | "text"
  | "textarea"
  | "url"
  | "list"
  | "qa_pairs"
  | "breadcrumbs";

export type TemplateField = {
  key: string;
  label: string;
  hint?: string;
  kind: FieldKind;
  required?: boolean;
  placeholder?: string;
};

export type SchemaTemplate = {
  id: string;
  label: string;
  schemaType: string; // e.g. "LegalService", "FAQPage"
  description: string;
  fields: TemplateField[];
};

export const SCHEMA_TEMPLATES: SchemaTemplate[] = [
  {
    id: "legal_service",
    label: "Legal service (firm-level)",
    schemaType: "LegalService",
    description:
      "Site-wide schema describing the firm itself. Best applied to the home page and /about. Helps Google + AI overviews surface accurate firm facts.",
    fields: [
      {
        key: "pageUrl",
        label: "Page URL",
        kind: "url",
        required: true,
        hint: "Usually the home page or /about.",
      },
      {
        key: "servicesOffered",
        label: "Services offered",
        kind: "list",
        hint: "One service per line. e.g. 'Employment discrimination claims'.",
      },
      {
        key: "areasServed",
        label: "Areas served",
        kind: "list",
        hint: "Cities, counties, or states. One per line.",
      },
      {
        key: "openingHours",
        label: "Opening hours",
        kind: "text",
        placeholder: "Mo-Fr 09:00-17:00",
        hint: "Schema.org opening-hours format.",
      },
    ],
  },
  {
    id: "faq_page",
    label: "FAQ page",
    schemaType: "FAQPage",
    description:
      "Q&A schema for any page with frequently asked questions. Google sometimes shows these as rich snippets, and AI overviews quote them verbatim.",
    fields: [
      {
        key: "pageUrl",
        label: "Page URL",
        kind: "url",
        required: true,
      },
      {
        key: "qa",
        label: "Questions and answers",
        kind: "qa_pairs",
        required: true,
        hint: "5-15 Q&A pairs work best. The first 3 carry the most weight.",
      },
    ],
  },
  {
    id: "attorney",
    label: "Attorney (bio page)",
    schemaType: "Attorney",
    description:
      "Person schema for an attorney bio page. Surfaces the lawyer in 'lawyers in NYC' style queries when paired with the LegalService schema.",
    fields: [
      {
        key: "pageUrl",
        label: "Bio page URL",
        kind: "url",
        required: true,
      },
      {
        key: "name",
        label: "Full name",
        kind: "text",
        required: true,
      },
      {
        key: "jobTitle",
        label: "Title",
        kind: "text",
        placeholder: "Partner, Associate, Counsel",
      },
      {
        key: "bio",
        label: "Short bio (1-2 paragraphs)",
        kind: "textarea",
      },
      {
        key: "alumniOf",
        label: "Law school + undergrad",
        kind: "list",
        hint: "One school per line.",
      },
      {
        key: "barAdmissions",
        label: "Bar admissions",
        kind: "list",
        placeholder: "New York\nNew Jersey",
      },
    ],
  },
  // NOTE: BlogPosting/Article and BreadcrumbList templates were intentionally
  // removed. katzmelinger.com runs Yoast SEO (free), which already emits the
  // base @graph — WebPage, Article, Organization, WebSite, BreadcrumbList, and
  // author — automatically on every page. Yoast is the single owner of those
  // types; Huracán only adds what Yoast does NOT: FAQPage, Attorney bios, and
  // the firm-level LegalService. Re-adding Article/BreadcrumbList here would
  // duplicate Yoast's schema and trip Google's "duplicate structured data"
  // validation. See the Content Pipeline spec, Fix 3 (single owner).
];

export function findTemplate(id: string): SchemaTemplate | null {
  return SCHEMA_TEMPLATES.find((t) => t.id === id) ?? null;
}
