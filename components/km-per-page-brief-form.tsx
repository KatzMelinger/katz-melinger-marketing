"use client";

/**
 * <KMPerPageBriefForm /> — the required Per-Page Content Brief.
 *
 * Used by both /content (as one tab in the existing generator) and
 * /seo/generator (as the standalone surface). Renders every required
 * field from the marketing team's Per-Page Brief doc, validates them
 * client-side, and exposes the brief + a "ready to generate" flag to
 * the parent.
 *
 * The parent owns the Generate button. This component owns the data.
 */

import { useMemo } from "react";

import {
  COLLECTIONS_PILLARS,
  EMPLOYMENT_PILLARS,
  KM_CONTENT_TYPE_LABELS,
  KM_HUB_LINKS,
  KM_PRACTICE_AREA_LABELS,
  KM_SEARCH_INTENT_LABELS,
  pillarsForPracticeArea,
  validateBrief,
  type KMContentType,
  type KMPerPageBrief,
  type KMPracticeArea,
  type KMSearchIntent,
} from "@/lib/km-content-system";

export type KMBriefFormValue = Partial<KMPerPageBrief>;

const META_DESC_LIMIT = 155;

export function emptyBrief(initial?: Partial<KMBriefFormValue>): KMBriefFormValue {
  return {
    contentType: "blog_post",
    practiceArea: "employment",
    primaryKeyword: "",
    searchIntent: "informational",
    pillarId: "",
    urlSlug: "",
    metaTitle: "",
    metaDescription: "",
    h1: "",
    internalPillarLink: "",
    cannibalizationConfirmed: false,
    cannibalizationNotes: "",
    secondaryKeywords: [],
    statutes: [],
    deadlines: [],
    evidenceTypes: [],
    thresholds: [],
    faqQuestions: [],
    specialInstructions: "",
    ...initial,
  };
}

export function KMPerPageBriefForm({
  value,
  onChange,
  showContentTypePicker = true,
}: {
  value: KMBriefFormValue;
  onChange: (next: KMBriefFormValue) => void;
  showContentTypePicker?: boolean;
}) {
  const errors = useMemo(() => validateBrief(value), [value]);
  const pillarPool = pillarsForPracticeArea(value.practiceArea ?? "employment");

  const patch = (p: Partial<KMBriefFormValue>) => onChange({ ...value, ...p });

  // When practice area changes, clear pillar selection (mismatched pillar
  // would otherwise fail server validation).
  const setPracticeArea = (pa: KMPracticeArea) => {
    patch({ practiceArea: pa, pillarId: "" });
  };

  const metaDescLen = (value.metaDescription ?? "").length;
  const metaDescOver = metaDescLen > META_DESC_LIMIT;

  // Auto-fill internal pillar link from the selected pillar
  const onPillarChange = (id: string) => {
    const pillar = pillarPool.find((p) => p.id === id);
    patch({
      pillarId: id,
      internalPillarLink: pillar ? pillar.url : value.internalPillarLink ?? "",
    });
  };

  return (
    <div className="space-y-5">
      {showContentTypePicker && (
        <FieldRow label="Content type *" hint="Determines structure and voice.">
          <div className="flex flex-wrap gap-2">
            {(["practice_page", "blog_post", "case_result"] as KMContentType[]).map((ct) => (
              <Pill
                key={ct}
                active={value.contentType === ct}
                onClick={() => patch({ contentType: ct })}
              >
                {KM_CONTENT_TYPE_LABELS[ct]}
              </Pill>
            ))}
          </div>
        </FieldRow>
      )}

      <FieldRow label="Practice area *" hint="Employment = employees only. Collections = creditors only.">
        <div className="flex flex-wrap gap-2">
          {(["employment", "collections"] as KMPracticeArea[]).map((pa) => (
            <Pill
              key={pa}
              active={value.practiceArea === pa}
              onClick={() => setPracticeArea(pa)}
            >
              {KM_PRACTICE_AREA_LABELS[pa]}
            </Pill>
          ))}
        </div>
      </FieldRow>

      <FieldRow label="Primary keyword *" hint="One keyword only.">
        <input
          className={inputClass()}
          placeholder="e.g. unpaid overtime new york"
          value={value.primaryKeyword ?? ""}
          onChange={(e) => patch({ primaryKeyword: e.target.value })}
        />
      </FieldRow>

      <FieldRow label="Pillar mapping *" hint="Which existing pillar does this map up to?">
        <select
          className={inputClass()}
          value={value.pillarId ?? ""}
          onChange={(e) => onPillarChange(e.target.value)}
        >
          <option value="">— Select a pillar —</option>
          {pillarPool.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} ({p.url})
            </option>
          ))}
        </select>
      </FieldRow>

      <FieldRow label="Search intent *">
        <div className="flex flex-wrap gap-2">
          {(["informational", "commercial", "proof"] as KMSearchIntent[]).map((si) => (
            <Pill
              key={si}
              active={value.searchIntent === si}
              onClick={() => patch({ searchIntent: si })}
            >
              {KM_SEARCH_INTENT_LABELS[si]}
            </Pill>
          ))}
        </div>
      </FieldRow>

      <FieldRow label="URL slug *" hint="e.g. /wage-theft-overtime/manhattan-restaurants/">
        <input
          className={inputClass()}
          placeholder="/path/to/page/"
          value={value.urlSlug ?? ""}
          onChange={(e) => patch({ urlSlug: e.target.value })}
        />
      </FieldRow>

      <FieldRow label="H1 *">
        <input
          className={inputClass()}
          placeholder="e.g. Unpaid Overtime in New York"
          value={value.h1 ?? ""}
          onChange={(e) => patch({ h1: e.target.value })}
        />
      </FieldRow>

      <FieldRow label="Meta title *">
        <input
          className={inputClass()}
          placeholder="50–60 characters recommended"
          value={value.metaTitle ?? ""}
          onChange={(e) => patch({ metaTitle: e.target.value })}
        />
        <div className="text-[10px] opacity-50 text-right">
          {(value.metaTitle ?? "").length} chars
        </div>
      </FieldRow>

      <FieldRow label="Meta description *" hint="155 character limit. Counter live.">
        <textarea
          rows={2}
          className={inputClass(metaDescOver ? "border-red-500" : "")}
          placeholder="What is this page about? Why click?"
          value={value.metaDescription ?? ""}
          onChange={(e) => patch({ metaDescription: e.target.value })}
        />
        <div
          className={`text-[10px] text-right ${
            metaDescOver
              ? "text-red-600 font-medium"
              : metaDescLen > 140
                ? "text-amber-600"
                : "opacity-50"
          }`}
        >
          {metaDescLen}/{META_DESC_LIMIT}
          {metaDescOver && " — over limit"}
        </div>
      </FieldRow>

      <FieldRow
        label="Internal pillar link *"
        hint="Auto-filled from pillar above. Override if needed."
      >
        <input
          className={inputClass()}
          placeholder="/path/to/pillar/"
          value={value.internalPillarLink ?? ""}
          onChange={(e) => patch({ internalPillarLink: e.target.value })}
        />
        <div className="text-[10px] opacity-50">
          Hub link (auto): {KM_HUB_LINKS[value.practiceArea ?? "employment"]}
        </div>
      </FieldRow>

      <FieldRow
        label="Cannibalization check *"
        hint="Confirm this page does not duplicate an existing pillar or post."
      >
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={value.cannibalizationConfirmed ?? false}
            onChange={(e) => patch({ cannibalizationConfirmed: e.target.checked })}
          />
          <span>
            I searched the site and confirmed this page does not duplicate any
            existing pillar page, blog post, or supporting page.
          </span>
        </label>
        <textarea
          rows={2}
          className={inputClass()}
          placeholder="Optional notes — e.g. pages reviewed and how this differs."
          value={value.cannibalizationNotes ?? ""}
          onChange={(e) => patch({ cannibalizationNotes: e.target.value })}
        />
      </FieldRow>

      <details className="border border-black/10 dark:border-white/10 rounded-md p-3">
        <summary className="cursor-pointer text-sm font-medium opacity-80">
          Optional brief fields (secondary keywords, statutes, deadlines, FAQs…)
        </summary>
        <div className="mt-3 space-y-3">
          <ListField
            label="Secondary keywords"
            hint="3–6 recommended. One per line."
            value={value.secondaryKeywords ?? []}
            onChange={(v) => patch({ secondaryKeywords: v })}
            placeholder={"overtime claim ny\nwage and hour lawyer\nfair labor standards act"}
          />
          <ListField
            label="Statutes to reference"
            value={value.statutes ?? []}
            onChange={(v) => patch({ statutes: v })}
            placeholder={"FLSA\nNYLL §195\nNJWHL"}
          />
          <ListField
            label="Key deadlines"
            value={value.deadlines ?? []}
            onChange={(v) => patch({ deadlines: v })}
            placeholder={"FLSA: 2 years (3 if willful)\nNYLL: 6 years"}
          />
          <ListField
            label="Evidence types to highlight"
            value={value.evidenceTypes ?? []}
            onChange={(v) => patch({ evidenceTypes: v })}
            placeholder={"Pay stubs\nTimecards\nText messages with supervisor"}
          />
          <ListField
            label="Employer / debtor thresholds"
            value={value.thresholds ?? []}
            onChange={(v) => patch({ thresholds: v })}
            placeholder={"NYCHRL: 4+ employees\nTitle VII: 15+ employees"}
          />
          <ListField
            label="FAQ questions to include"
            hint="Optional. AI will generate if blank."
            value={value.faqQuestions ?? []}
            onChange={(v) => patch({ faqQuestions: v })}
            placeholder={"How long do I have to file a wage claim?\nCan my employer fire me for asking about overtime?"}
          />
          <FieldRow label="Special instructions">
            <textarea
              rows={3}
              className={inputClass()}
              placeholder="Specific angle, competitors to differentiate from, firm-specific detail to include…"
              value={value.specialInstructions ?? ""}
              onChange={(e) => patch({ specialInstructions: e.target.value })}
            />
          </FieldRow>
        </div>
      </details>

      {errors.length > 0 && (
        <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 p-3 rounded-md">
          <div className="font-medium mb-1">Brief incomplete — Generate is disabled until:</div>
          <ul className="list-disc pl-5 space-y-0.5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------- helpers --------------------------------------------------------

function inputClass(extra = ""): string {
  return `w-full bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${extra}`;
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium opacity-80">{label}</label>
      {hint && <p className="text-[11px] opacity-60">{hint}</p>}
      {children}
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
        active
          ? "border-foreground bg-foreground/10 text-foreground"
          : "border-black/15 dark:border-white/15 opacity-70 hover:opacity-100"
      }`}
    >
      {children}
    </button>
  );
}

function ListField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const text = value.join("\n");
  return (
    <FieldRow label={label} hint={hint}>
      <textarea
        rows={4}
        className={inputClass()}
        placeholder={placeholder}
        value={text}
        onChange={(e) =>
          onChange(
            e.target.value
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
      />
    </FieldRow>
  );
}

export { validateBrief };
