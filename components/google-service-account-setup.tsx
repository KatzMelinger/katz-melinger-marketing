const CARD = "#1a2540";
const BORDER = "#2a3f5f";

export function GoogleServiceAccountSetup({
  contextLabel,
}: {
  contextLabel: string;
}) {
  return (
    <section
      className="rounded-xl border p-6"
      style={{ backgroundColor: CARD, borderColor: BORDER }}
    >
      <h2 className="text-xl font-semibold text-white">
        Google Service Account Setup Required
      </h2>
      <p className="mt-2 text-sm text-slate-300">
        {contextLabel} is blocked until a replacement service account key is
        added.
      </p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-200">
        <li>Go to Google Cloud Console -&gt; IAM -&gt; Service Accounts.</li>
        <li>
          Create a new service account with Google Analytics and Search Console
          permissions.
        </li>
        <li>
          Download the JSON key and add it as{" "}
          <code className="rounded bg-slate-900/60 px-1.5 py-0.5 text-xs">
            GOOGLE_SERVICE_ACCOUNT_JSON
          </code>
          .
        </li>
        <li>Enable Google Analytics Reporting API and Search Console API.</li>
      </ol>
      <p className="mt-4 text-sm text-slate-400">
        After saving the environment variable, reload this page to pull live
        data.
      </p>
    </section>
  );
}
