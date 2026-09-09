Subject: Re: Website Content + Social Media audit — status and fixes

Diana,

Went through your audit line by line against the actual code. Here's where things
stand — fixed today, answered, and what still needs a scoping conversation.

FIXED TODAY

1.3 — Content Studio standalone save: confirmed this was not intentionally fixed
in May — the save function was silently swallowing failures (it never checked
whether the save actually succeeded). Fixed: a failed save now shows an error
message instead of pretending it worked.

Em dashes: the "no em dashes" rule only existed as prompt text, which the model
doesn't reliably follow — that's exactly how one got through on the litigation
draft. Fixed with a hard filter that runs after generation and strips them
regardless of what the model outputs, across every content generator in the app.

2.1 — Content Calendar: entries with a linked draft are now clickable and open
the editor to revise copy, as you asked. Posts with no linked draft (manual/
announcement posts) still aren't editable from the calendar — there's no draft
record behind them yet in the current setup, so that's a separate follow-up if
you need it.

1.1 — SEO metadata: found the actual cause, which was narrower than it looked.
The 5-step brief wizard already auto-drafts meta title/description and carries
your pillar selection through — that path was fine. The gap was every other way
content gets created (the automated agent, batch generation, social/email) —
those never generated metadata at all. Fixed: that path now generates meta
title, meta description, and URL slug alongside the article, and auto-assigns
a pillar from the topic the same way the wizard does. If it can't confidently
match a pillar, it leaves it blank for you to review rather than guessing.

1.7 — Brand voice on sensitive topics: confirmed the gap — brand voice was
applied uniformly regardless of topic. Fixed: harassment, retaliation,
discrimination, and wrongful-termination topics now get a tone override that
forces calm, human language before any legal reference, in the hook and every
section opener, with a supportive (not transactional) CTA.

ANSWERED (no build needed yet)

1.2 — Readability is a single Flesch score (0-100), shown for reference only —
it does not block Approve. It does not break down into the five checks
(sentence/paragraph length, passive voice, etc.) from the original spec, and
there's no passive-voice auto-fix. Let me know if you still want the full
breakdown built now that you know what today's number actually is.

1.6 — Overlap check and Cannibalization are two separate systems. Overlap
checks a draft against your live site only ("link, don't redefine"), manual
button-click only. Cannibalization checks your ranked keywords for pages
competing against each other, also manual. Neither compares a draft against
other drafts still sitting in the pipeline — that's a different, existing tool
that's more relevant to your backlog cleanup ask (1.4).

NEEDS A SCOPING CONVERSATION, NOT JUST A FIX

1.5 — Redraft/Optimize: this is a bigger lift than "connect the wires." There's
no Redraft button and no six-stage flow built anywhere yet — it's flagged in
the code as an intentional placeholder. Building the full spec you described
is realistically a multi-week project, not a quick connection. Want to get on
a call to scope this before I start?

2.2 — Social generator: you're right that social and blog content share the
same generation system today, though it does apply different length guidance
per platform (just not strictly enforced). One thing worth running down first:
there's no carousel-building code anywhere in the app right now, so I want to
figure out where that 8-slide carousel actually came from before committing to
the full rebuild — it may change the scope.

1.4 — Backlog cleanup: not asking you to do anything here, just flagging that
we already have duplicate-detection tooling that should make this mostly
automatic rather than a fully manual pass — I'll use it before touching
anything else in the backlog.

Let me know on 1.2 and priority between 1.5 and 2.2, and I'll get moving on
the next one.

Kenneth
