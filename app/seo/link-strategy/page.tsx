"use client";

/**
 * Link-building strategy.
 *
 * Different from /seo/backlinks (which shows the Semrush incoming-link
 * profile). This page does outbound analysis + AI-generated outreach plan:
 * what categories of sites to pitch, specific targets, email templates,
 * reciprocal link opportunities, content-for-links ideas, and a 3-month
 * action plan. Plus a "verify backlink" tool that checks whether a given
 * URL links to the firm.
 */

import { useState } from "react";
import {
  DashCard,
  DashButton,
  DashInput,
  DashSpinner,
  DashPill,
} from "@/components/dashboard-ui";

type ExternalLink = {
  url: string;
  anchorText: string;
  sourcePage: string;
};

type Profile = {
  sitePages: string[];
  externalLinksOut: ExternalLink[];
  internalLinkCount: number;
  externalLinkCount: number;
  scannedAt: string;
};

type Opportunity = {
  category: string;
  priority: "high" | "medium" | "low";
  description: string;
  specificTargets: string[];
  outreachTemplate: string;
  expectedImpact: string;
  difficulty: "easy" | "moderate" | "hard";
};

type Reciprocal = {
  existingOutboundLink: string;
  suggestion: string;
};

type ContentLink = {
  contentIdea: string;
  targetKeywords: string[];
  linkableFormat: string;
  potentialLinkers: string[];
};

type Strategy = {
  overallAssessment?: string;
  currentStrengths?: string[];
  currentWeaknesses?: string[];
  backlinkOpportunities?: Opportunity[];
  reciprocalLinkIdeas?: Reciprocal[];
  contentForLinks?: ContentLink[];
  quickWins?: string[];
  monthlyPlan?: { month1?: string; month2?: string; month3?: string };
};

type VerifyResult = {
  found: boolean;
  url: string;
  anchorText?: string;
  rel?: string;
  error?: string;
};

function priorityTone(p: string): "red" | "amber" | "blue" {
  if (p === "high") return "red";
  if (p === "medium") return "amber";
  return "blue";
}

function difficultyTone(d: string): "emerald" | "amber" | "red" {
  if (d === "easy") return "emerald";
  if (d === "moderate") return "amber";
  return "red";
}

export default function LinkStrategyPage() {
  const [generating, setGenerating] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Verifier
  const [verifyUrl, setVerifyUrl] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/seo/backlinks/strategy", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");
      setProfile(data.profile);
      setStrategy(data.strategy);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setGenerating(false);
    }
  };

  const verify = async () => {
    if (!verifyUrl.trim()) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await fetch("/api/seo/backlinks/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: verifyUrl.trim() }),
      });
      const data = (await res.json()) as VerifyResult;
      setVerifyResult(data);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Link-building strategy</h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Crawls the firm's sitemap to map outbound links, then asks Claude
            for a structured outreach plan: target categories, specific
            organizations to pitch, email templates, reciprocal link ideas,
            content-for-links suggestions, and a 3-month plan.
          </p>
        </div>
        <DashButton onClick={generate} disabled={generating}>
          {generating ? <DashSpinner /> : strategy ? "Regenerate" : "Generate strategy"}
        </DashButton>
      </div>

      {error && (
        <div className="mb-4 border border-red-200 bg-red-50 text-red-800 rounded-md px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {!strategy && !generating && (
        <DashCard className="text-center py-10 space-y-3">
          <div className="text-3xl" aria-hidden>
            🔗
          </div>
          <h3 className="text-lg font-semibold">No strategy generated yet</h3>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            Click "Generate strategy" — Claude reads your outbound link
            profile and produces a 3-month plan with specific outreach
            targets.
          </p>
        </DashCard>
      )}

      {generating && !strategy && (
        <DashCard className="text-center py-12">
          <DashSpinner /> Crawling sitemap and analyzing…
          <p className="text-xs text-slate-500 mt-2">
            ~30-60 seconds for the crawl + ~15 seconds for Claude
          </p>
        </DashCard>
      )}

      {profile && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Stat label="Pages scanned" value={profile.sitePages.length} />
          <Stat label="External links found" value={profile.externalLinksOut.length} />
          <Stat label="Internal hrefs (sample)" value={profile.internalLinkCount} />
          <Stat label="External hrefs (sample)" value={profile.externalLinkCount} />
        </div>
      )}

      {strategy && (
        <div className="space-y-4">
          {strategy.overallAssessment && (
            <DashCard>
              <h3 className="text-sm font-semibold mb-2">Overall assessment</h3>
              <p className="text-sm text-slate-700">{strategy.overallAssessment}</p>
              <div className="grid md:grid-cols-2 gap-4 mt-3">
                {strategy.currentStrengths && (
                  <div>
                    <div className="text-xs font-medium text-emerald-700 mb-1">Strengths</div>
                    <ul className="space-y-1 text-xs text-slate-700 list-disc pl-4">
                      {strategy.currentStrengths.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {strategy.currentWeaknesses && (
                  <div>
                    <div className="text-xs font-medium text-amber-700 mb-1">Weaknesses</div>
                    <ul className="space-y-1 text-xs text-slate-700 list-disc pl-4">
                      {strategy.currentWeaknesses.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </DashCard>
          )}

          {strategy.quickWins && strategy.quickWins.length > 0 && (
            <DashCard>
              <h3 className="text-sm font-semibold mb-2 text-emerald-700">Quick wins (this week)</h3>
              <ul className="space-y-1 text-sm text-slate-700 list-disc pl-5">
                {strategy.quickWins.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </DashCard>
          )}

          {strategy.backlinkOpportunities && strategy.backlinkOpportunities.length > 0 && (
            <DashCard>
              <h3 className="text-sm font-semibold mb-3">Outreach opportunities</h3>
              <div className="space-y-3">
                {strategy.backlinkOpportunities.map((opp, i) => (
                  <div
                    key={i}
                    className="border border-slate-200 rounded-md p-3 bg-slate-50"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold">{opp.category}</span>
                      <div className="flex gap-1.5">
                        <DashPill tone={priorityTone(opp.priority)}>
                          priority: {opp.priority}
                        </DashPill>
                        <DashPill tone={difficultyTone(opp.difficulty)}>
                          {opp.difficulty}
                        </DashPill>
                      </div>
                    </div>
                    <p className="text-xs text-slate-700">{opp.description}</p>
                    {opp.specificTargets && opp.specificTargets.length > 0 && (
                      <div className="mt-2">
                        <div className="text-[11px] font-medium text-slate-700 mb-1">Targets</div>
                        <ul className="space-y-0.5 text-xs text-slate-600 list-disc pl-4">
                          {opp.specificTargets.map((t, j) => (
                            <li key={j}>{t}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {opp.outreachTemplate && (
                      <div className="mt-2">
                        <div className="text-[11px] font-medium text-slate-700 mb-1">
                          Outreach approach
                        </div>
                        <p className="text-xs text-slate-700 italic bg-white border border-slate-200 rounded px-2 py-1">
                          {opp.outreachTemplate}
                        </p>
                      </div>
                    )}
                    {opp.expectedImpact && (
                      <p className="text-[11px] text-slate-500 mt-2">
                        <span className="font-medium">Impact: </span>
                        {opp.expectedImpact}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </DashCard>
          )}

          {strategy.contentForLinks && strategy.contentForLinks.length > 0 && (
            <DashCard>
              <h3 className="text-sm font-semibold mb-2">Content for links</h3>
              <p className="text-xs text-slate-600 mb-3">
                Linkable assets that could organically attract backlinks.
              </p>
              <div className="space-y-2">
                {strategy.contentForLinks.map((c, i) => (
                  <div key={i} className="border border-slate-200 rounded-md p-3">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-medium">{c.contentIdea}</span>
                      <DashPill tone="violet">{c.linkableFormat}</DashPill>
                    </div>
                    {c.targetKeywords.length > 0 && (
                      <div className="text-[11px] text-slate-500 mt-1">
                        Keywords:{" "}
                        {c.targetKeywords.map((k, j) => (
                          <span key={j} className="mr-2">
                            {k}
                          </span>
                        ))}
                      </div>
                    )}
                    {c.potentialLinkers.length > 0 && (
                      <div className="text-[11px] text-slate-500 mt-1">
                        Potential linkers: {c.potentialLinkers.join("; ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </DashCard>
          )}

          {strategy.reciprocalLinkIdeas && strategy.reciprocalLinkIdeas.length > 0 && (
            <DashCard>
              <h3 className="text-sm font-semibold mb-2">Reciprocal link ideas</h3>
              <ul className="space-y-2 text-xs">
                {strategy.reciprocalLinkIdeas.map((r, i) => (
                  <li key={i} className="border-l-2 border-[#185FA5]/30 pl-3">
                    <div className="text-slate-700 font-mono">{r.existingOutboundLink}</div>
                    <div className="text-slate-600 mt-0.5">{r.suggestion}</div>
                  </li>
                ))}
              </ul>
            </DashCard>
          )}

          {strategy.monthlyPlan && (
            <DashCard>
              <h3 className="text-sm font-semibold mb-3">3-month plan</h3>
              <div className="grid md:grid-cols-3 gap-3">
                {(["month1", "month2", "month3"] as const).map((k, i) => {
                  const v = strategy.monthlyPlan?.[k];
                  if (!v) return null;
                  return (
                    <div key={k} className="border border-slate-200 rounded-md p-3 bg-slate-50">
                      <div className="text-xs font-semibold text-[#185FA5] mb-1">Month {i + 1}</div>
                      <p className="text-xs text-slate-700">{v}</p>
                    </div>
                  );
                })}
              </div>
            </DashCard>
          )}
        </div>
      )}

      {/* ---- Verify backlink tool ---- */}
      <div className="mt-8">
        <DashCard>
          <h3 className="text-sm font-semibold mb-2">Verify a backlink</h3>
          <p className="text-xs text-slate-600 mb-3">
            Paste any URL — we'll fetch the page and check whether it links to
            katzmelinger.com (and what anchor text + rel attribute, if any).
            SSRF-protected: only public URLs allowed.
          </p>
          <div className="flex gap-2 flex-wrap">
            <DashInput
              type="url"
              value={verifyUrl}
              onChange={(e) => setVerifyUrl(e.target.value)}
              placeholder="https://example.com/some-article"
              className="flex-1 min-w-64"
            />
            <DashButton onClick={verify} disabled={verifying || !verifyUrl.trim()}>
              {verifying ? <DashSpinner /> : "Verify"}
            </DashButton>
          </div>

          {verifyResult && (
            <div className="mt-3">
              {verifyResult.error && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  {verifyResult.error}
                </div>
              )}
              {!verifyResult.error && verifyResult.found && (
                <div className="border border-emerald-200 bg-emerald-50 text-emerald-800 rounded-md px-3 py-2 text-sm">
                  ✓ Found link to katzmelinger.com
                  {verifyResult.anchorText && (
                    <div className="text-xs mt-1">
                      Anchor: "<span className="font-mono">{verifyResult.anchorText}</span>"
                    </div>
                  )}
                  {verifyResult.rel && (
                    <div className="text-xs">
                      rel: <span className="font-mono">{verifyResult.rel}</span>
                      {verifyResult.rel.includes("nofollow") && (
                        <span className="ml-2 text-amber-700">⚠ nofollow — won't pass SEO authority</span>
                      )}
                    </div>
                  )}
                </div>
              )}
              {!verifyResult.error && !verifyResult.found && (
                <div className="border border-slate-200 bg-slate-50 text-slate-700 rounded-md px-3 py-2 text-sm">
                  ✕ No link to katzmelinger.com found on that page.
                </div>
              )}
            </div>
          )}
        </DashCard>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-white">
      <div className="text-2xl font-bold text-slate-900">{value.toLocaleString()}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}
