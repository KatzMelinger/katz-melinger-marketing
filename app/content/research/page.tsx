/**
 * /content/research — standalone Research Libraries page.
 *
 * The UI lives in `components/research-libraries.tsx` so it can be shared with
 * the Content Directions dashboard (app/brand-voice/page.tsx), which renders
 * the same component as a tab. This route is kept so existing links — e.g. the
 * pipeline stage nav (components/pipeline-stage-nav.tsx) — continue to work.
 */

import { ResearchLibraries } from "@/components/research-libraries";

export default function ResearchPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <ResearchLibraries />
    </div>
  );
}
