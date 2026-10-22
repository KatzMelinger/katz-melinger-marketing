/**
 * Operating guide (Oct 20 spec, Task A18): one page for Diana. The daily
 * loop from Ready for Diana to the live page, what to do when a job alert
 * arrives, and the five-draft pilot that comes before scaling.
 */
import Link from "next/link";
import { PipelineStageNav } from "@/components/pipeline-stage-nav";

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">{n}</span>
      <div>
        <div className="font-semibold text-slate-900">{title}</div>
        <div className="mt-0.5 text-sm text-slate-700">{children}</div>
      </div>
    </li>
  );
}

const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link href={href} className="text-brand hover:underline">
    {children}
  </Link>
);

export default function OperatingGuidePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <PipelineStageNav />
      <h1 className="text-xl font-semibold text-slate-900">Operating guide</h1>
      <p className="mt-1 text-sm text-slate-600">
        One page: how a draft goes from Ready for Diana to a checked live page, and what to do when something alerts.
      </p>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-900">Every day</h2>
        <ol className="mt-3 space-y-4">
          <Step n={1} title="Open Ready for Diana">
            On the <A href="/content-production">Production Board</A>, the Ready for Diana column holds drafts whose checklist passes:
            frame, keyword, sources, attorney clearance, fee rule, links and style. A draft elsewhere lists the items it still
            fails; most clear themselves when Improve to Ready runs.
          </Step>
          <Step n={2} title="Read it">
            Open the draft. The Improvement summary says what the system changed and why; the Sources panel shows each legal claim
            with its source and quote. Click any score to see where its points went. Scores are information, not gates.
          </Step>
          <Step n={3} title="Approve, or send back with a note">
            Approve when it reads right. If not, edit the text directly (your correction is saved as a regression case so the
            system learns it) or press Send back to draft with a note. A legal question goes to the attorney automatically; you do
            not need to forward it.
          </Step>
          <Step n={4} title="Publish">
            In the drawer&apos;s WordPress panel, press Publish. It goes to WordPress as a draft first: open the preview link, then
            press Go live. Rollback restores the previous version in one click. Only people listed as Publishers in{" "}
            <A href="/brand-voice">Brand settings</A> (and Admins) can publish.
          </Step>
          <Step n={5} title="Check the live page result">
            Within ten minutes of going live the system fetches the page and checks the label, Reviewed by byline, CTA,
            disclaimer, schema, canonical tag, indexing and every link. The result shows in the WordPress panel; a failure emails
            you and Kenneth. Fix it in the draft and publish again, or roll back.
          </Step>
        </ol>
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-900">When something needs you</h2>
        <ul className="mt-3 space-y-3 text-sm text-slate-700">
          <li>
            <span className="font-semibold text-slate-900">A job alert email.</span> Open <A href="/system/health">System Health</A>.
            Find the job: its last success, last error and next run. A failed job is retried once automatically; if the retry
            also failed, the error says why (most often an expired connection, fixed in Integrations). A job that keeps failing
            goes to Kenneth.
          </li>
          <li>
            <span className="font-semibold text-slate-900">An AI budget email.</span> Automatic Improve to Ready runs pause until
            next month or until Kenneth raises the monthly budget in Brand settings. Pressing Improve to Ready by hand still works.
          </li>
          <li>
            <span className="font-semibold text-slate-900">An attorney has not answered.</span> Reminders go out after 2 business
            days and the question shows to Kenneth as overdue after 4. See <A href="/content/attorney-questions">Attorney questions</A>.
          </li>
          <li>
            <span className="font-semibold text-slate-900">A page underperforms or a law changes.</span> Underperforming pages and
            knowledge base changes open refresh items on their own: see the <A href="/content/refresh">Refresh Queue</A> and{" "}
            <A href="/content/results">Results</A>. The monthly report on which checks predict results arrives on the 1st; no
            threshold changes until you approve.
          </li>
          <li>
            <span className="font-semibold text-slate-900">Missed calls.</span> The Needs callback list arrives by email at 8:00 AM
            with a PDF. Mark each caller on the <A href="/calls">Calls</A> page so they drop off tomorrow&apos;s list.
          </li>
        </ul>
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-900">The pilot, before scaling</h2>
        <p className="mt-2 text-sm text-slate-700">
          Run five drafts end to end, from Opportunity to live page: two employment, one commercial collections, one judgment
          enforcement and one Spanish. For each, note the time to Ready, the number of human items, any error you still find and
          the live page check result. Every error you find becomes a regression case before the next build. Scale to the full
          content calendar only when the pilot shows no error the system could have caught.
        </p>
      </section>
    </div>
  );
}
