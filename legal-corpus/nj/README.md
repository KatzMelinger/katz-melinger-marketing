# New Jersey statute corpus

Statutory text held locally because New Jersey publishes none a machine can read.

Every route was tested on 2026-08-31 and rejected:

| source | result |
|---|---|
| `njoag.gov` (Division on Civil Rights, NJLAD) | **403** — Incapsula blocks Node entirely |
| `nj.gov/csc` EEO laws | 200, but **zero** statutory text — it lists law names |
| `njleg.state.nj.us` → `lis.njleg.state.nj.us` | session-based NXT portal; answers `<Not initialized yet>` and a search form |
| `law.justia.com`, `casetext` | 403 to automated clients |
| `nj.gov/labor` wage-and-hour laws | **works** — full text of the Wage and Hour Law and N.J.A.C. 12:56 |

So the wage-and-hour page is fetched live (`lib/legal-retrieval.ts`), and
everything else — NJLAD `10:5-1 et seq.`, CEPA `34:19-1 et seq.` — lives here.

## This directory ships empty, deliberately

No statutory text was written from memory, and none may be. The legal layer
verifies a claim by finding a verbatim quote in the authority's own words; text
that was recalled rather than copied would make every downstream verification a
confident fiction, indistinguishable from the real thing to anyone reading the
output.

Until a section is ingested, citations to it route to an attorney — which is
what happens today. An empty corpus changes nothing; a populated one only helps.

## Adding a section

Export the section text from a source the firm lawfully has (Westlaw, Lexis,
Practical Law) into a plain-text file, then:

```bash
node scripts/run.mjs scripts/ingest-nj-statute.ts --citation "N.J.S.A. 10:5-12" --heading "Unlawful employment practices" --source "Westlaw, N.J.S.A. 10:5-12 (current through L.2026, c.41)" --as-of 2026-08-31 --by "Kenneth Katz" --file ./10-5-12.txt
```

Paste it **verbatim**. Do not tidy, renumber, or summarise: `lib/legal-verify.ts`
requires quotes to match character for character, so an edited paste makes true
claims fail — and the natural response to that is to loosen the guard, which
removes the one control against fabricated contradictions.

`node scripts/run.mjs scripts/ingest-nj-statute.ts --list` shows what is held.

## What is held

| section | | |
|---|---|---|
| **34:19-3** | CEPA — retaliatory action prohibited | held |
| **34:19-2** | CEPA — definitions | held |
| **34:11B-3** | NJFLA — definitions (text effective 17 Jul 2026) | held |
| **10:5-12** | NJLAD — unlawful employment practices | **still needed** |
| **10:5-5** | NJLAD — definitions | **still needed** |
| 34:11-4.2 | wage payment frequency | optional — the DOL page may cover it |

The two NJLAD sections matter most of what is left: most NJ discrimination
disputes turn on whether someone is an "employer" or "employee" under 10:5-5,
so without it those claims route to a person even once 10:5-12 is loaded.

## Westlaw exports: what to send, and what not to

The three sections held here came from Westlaw N.J.S.A. exports, which arrive as
RTF with a `.doc` extension. Two things to know.

**Send the SECTION, not the chapter.** A "Westlaw Advantage — N full text items
for Chapter X" export is the *New Jersey Practice Series*, a Thomson Reuters
treatise written by their editorial staff. It is copyrighted, and it is not
authority — verifying a claim against a practice guide's summary of cases would
have the system quote a secondary source as if it were the statute. Those files
were reviewed and deliberately not ingested.

**Westlaw's editorial apparatus is stripped on ingest** — the KeyCite flag,
breadcrumbs, the "Currentness" marker, footnote tables, and the Thomson Reuters
copyright line. That notice asserts rights in *their* additions while
disclaiming the government text, so keeping their apparatus would be storing
their work. Credits (`L.1986, c. 105, § 2, eff. Sept. 5, 1986`) are kept: session
law history is public and is what tells a reviewer how current the text is.

The statutory text itself is stored character for character.

## Keeping it current

`asOf` is recorded per section and shown to reviewers. When a statute is
amended, re-run the ingest with the new text and a new `asOf` — re-ingesting
replaces the file. Amendments are infrequent and announced, which is exactly why
a stored copy is safer here than a live fetch that cannot be made at all.
