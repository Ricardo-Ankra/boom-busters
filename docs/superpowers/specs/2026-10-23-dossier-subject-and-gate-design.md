# Dossier subject, gate and current status (design addendum)

Date: 2026-10-23. Amends the design of 2026-10-22
(`2026-10-22-dossier-grounded-research-design.md`). Decisions continue
PROGRESS.md from 311.

## 1. What the first production dossier showed

The Theranos project (title "Theranos on the Record: Why the Jury Convicted
Elizabeth Holmes for Defrauding Investors but Not Patients") was researched
from the Wikipedia article "2022 in the United States". The resolver
searched Wikipedia with the case title, found no company among the top
hits, and kept the first hit. The corpus became 46 news stories from that
page's reference list plus one BBC report on the January 2022 verdict. Every
claim was grounded in those documents, so the dossier approved itself and
the script was written. The dossier ends with "no sentencing date had yet
been confirmed", which is what the one relevant document said.

The owner's words: "the script generates automatically once the dossier
finishes so that also needs to stop. It must wait for us to be able to
revise and check and refine the Dossier." And: "we want to back up what
we're saying with facts, but we want the commentary to be engaging and
intriguing, not stuffed with legal jargon and diving too deep into the
court cases. It's the whole story."

## 2. Decisions

1. **The gate always opens.** No auto-approval. The script starts only on
   the owner's Approve. Unverified claims still block Approve.
2. **A case has a subject, separate from its title.** `subject` is the
   company's common name; `people` are the main people. "Suggest cases"
   returns both as their own fields, with a rule that the title is a
   working title naming the company and the turn in plain words, with no
   verdicts or questions (the hook is the angle's job). The case form has
   Subject and People boxes. A case saved before this change has no
   subject; the runner names one from the title and angle with one cheap
   model call and stores it on the case before gathering.
3. **The gather resolves from the subject.** Wikipedia is searched with the
   subject; the first hit that is a company is the entity; when none of the
   top five is a company the entity is marked unresolved, no Wikipedia
   references are taken, and the gate says "Subject not found on Wikipedia:
   check the case's Subject". Each person is searched too; the first human
   hit's article references join the reporting tier (20 per person), because
   a founder's article carries the aftermath (sentence, appeal, prison) that
   the company's article often does not.
4. **The owner's own sources come first.** `sourceLinks` on the case (links
   the owner pastes: long reads, a podcast, an interview, a chapter) enter
   the corpus at tier one, ranked above everything else in that tier.
5. **The story runs to today.** The brief gains `currentStatus`, dated from
   the newest document, rendered as "## Where it stands now"; null when the
   documents say nothing after the turn. Court and regulator pages are read
   newest first. Reporting is read half nearest the turning point and half
   newest, interleaved.
6. **A verdict reported by a major outlet is a ruling.** `ruled` is kept
   from a reporting document when the claim's text or quote carries a
   verdict word (convicted, found guilty, pleaded guilty, sentenced,
   acquitted, fined, banned, ordered to pay, ruled); otherwise it folds to
   alleged as before. The dossier document shows no legal labels; the field
   exists only for the script's "alleged" guard.
7. **Request changes at any time.** The note box is offered whenever a
   dossier exists and no dossier run is active, including after approval.
   The reviser re-researches with the note, re-opens the dossier gate, and
   the script is marked as written from an older dossier, as a re-run marks
   it today.
8. **The review screen names the subject first.** "Subject: Theranos
   (company), Elizabeth Holmes (person)" above the corpus line, with a
   "Research again" button that re-runs the dossier stage, and a link to
   edit the case.
9. **The back-test sees subjects and currency.** Each case carries
   `subject`, `people`, `expectedTitle` (the Wikipedia article the gather
   must land on) and `recentOutcome`. Theranos is entered under its
   headline title with subject "Theranos" and person "Elizabeth Holmes".
   Gates: every case's resolved title equals its expected title; a
   `recentOutcome` case has a `currentStatus` dated within 540 days of the
   run. Both are mechanical.

## 3. Out of scope

The corpus shares, the scenes and cast prompts, quote grounding, the legal
field's three values, and the metadata stage's published title.

## 4. Shipping

Migration 0035 (`cases.subject`, `cases.people`, `cases.source_links`).
A Vercel deploy and `PUT /api/inngest`. The Theranos project is re-run from
its project page after the deploy; the back-test's Theranos case is the live
check before that.
