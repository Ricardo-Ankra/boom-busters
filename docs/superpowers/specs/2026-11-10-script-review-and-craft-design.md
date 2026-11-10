# Script review and craft, chosen per channel

Date: 2026-11-10. Status: plan 1 shipped as decision 458; plans 2 to 8 open. Follows the dossier
research profiles design (2026-11-09) and takes the same principle: **the code
is the playbook, the bible is the channel.**

## 1. Why

The owner's words (2026-11-10): the script reviewer "checks claims in the
script etc. But this is not really needed for other channels, and I think also
trying to be too politically correct actually reduces the engagement of the
video." The ask: audit the reviewer, and the parts of the writer that feed it,
and abstract both so they work for any channel at the quality of the best
YouTube documentary writing.

Two things turned out to be true on reading the code and the production rows.
The reviewer is not a script reviewer: it is a per-sentence sourcing and
defamation check, and it is the only thing that decides whether a script goes
to voice without a human. And the "political correctness" is mostly a defect:
the legal axis is stamped on every claim, including plain facts, so the writer
hedges facts and the reviewer punishes the ones it did not.

## 2. Production state (read 2026-11-10, read only, with permission)

Nine script versions over four projects, all Boom & Busters. Scripts of 1,750
to 2,150 words against a 15-minute target.

| Script | Status | Words | Est. min | Warnings | Unsourced | Missing alleged | Owner edits |
|---|---|---|---|---|---|---|---|
| Nate v1 | approved | 1,823 | 12 | 79 | 71 | 4 | 5 |
| Stability v1 | approved | 2,038 | 14 | 50 | 0 | 50 | 0 |
| Stability v2 | approved | 2,019 | 13 | 44 | 0 | 43 | 5 |
| Stability v3 | approved | 2,043 | 14 | 28 | 25 | 2 | 15 |
| Stability v4 | approved | 2,149 | 14 | 35 | 32 | 0 | 15 |
| Theranos v1 | self_checked | 1,842 | 12 | 71 | 70 | 0 | 0 |
| Theranos v2 | self_checked | 1,844 | 12 | 99 | 95 | 3 | 0 |
| Theranos v3 | approved | 1,948 | 13 | 68 | 55 | 7 | 8 |
| WeWork v1 | self_checked | 1,758 | 12 | 78 | 58 | 13 | 0 |

What the rows show:

1. **No script has ever auto-approved.** Every version carried 28 to 99
   warnings, so every gate parked. The owner approved Nate with 79 warnings
   outstanding and Stability v4 with 35. At one warning per 20 to 30 words the
   gutter is noise, and "zero warnings means every sentence traced to a claim"
   (the runner's comment) has never happened.
2. **The unsourced check fires on connective tissue.** Nate's 71 include "It
   vanished.", "No typing." and "Every online shopper knew the friction."
   None is a checkable fact. It also fires on scene detail that the dossier's
   scenes pass grounded but the claim list does not carry ("Son checked his
   watch").
3. **The legal axis is stamped on plain facts.** Of 191 claims across the four
   dossiers, 153 (80%) have legal status `none` (no accusation involved); 30
   are `alleged`, 8 `ruled` (all Theranos). Every `none` claim is printed
   "NOT adjudicated" in the claim list. Stability v1's 50 missing-alleged
   warnings are all on `none` claims ("Stability AI released Stable Diffusion
   to the public" flagged as "marked NOT adjudicated"). Nate's dossier has no
   `alleged` or `ruled` claim at all and still drew four missing-alleged
   warnings and a reviewer message about "an allegation by prosecutors".
4. **The caveat lives in sentences and in the outline, more than in hedge
   words.** Attribution and caveat phrases run 0.7 to 2.0 per hundred words.
   The flatness is in stand-alone caveat sentences ("Those figures come from
   press reporting. They aren't filed accounts.", "No lawsuit over those
   unpaid bills has been documented as filed, let alone decided.") and in the
   outline's `constraints` field, which the prompt tells to carry "what must
   stay attributed and to whom": WeWork's chapter 1 constraints say "Attribute
   the March 2017 $300 million investment to a source reported by Reuters",
   and Stability v4's constraints say "reported" or "reportedly" fourteen
   times. The chapter contract then narrates those attributions.
5. **The owner's 53 edits are a voice signal nobody reads.** About thirty
   remove a narration tag or downgrade `[long pause]` to `[pause]`. Five
   delete a caveat sentence ("The year is commonly reported as 2019", "On this
   channel's reading of the charging documents", a Forbes attribution line).
   Three spell a figure out ("101" to "one hundred and one"). Two delete a
   tease line ("Runway is a name that comes back.") or a padding paragraph.
   The bible's `voiceDos` and `voiceDonts` are empty.
6. **Scripts run short and chapters end alike.** Chapter word counts land 8 to
   18% under the outline's targets; every version estimates 12 to 14 minutes
   against 15. Five of WeWork's seven chapters end on the same "but beneath
   the X, trouble" tease.
7. **The writer changed under the owner's feet.** Nate, Theranos and WeWork
   were written and checked on `gemini-3.8-flash` ($0.20 a script);
   Stability on Opus 5.5 and Sonnet 5 with Sonnet 5.5 and Haiku checking
   ($1.60). Stability v4 reads a class better than WeWork v1. The craft loop
   below is only as good as the route `scripting` names.
8. The mock self-check always returns one warning, so e2e never exercises
   auto-approve.

## 3. Audit

### 3.1 Channel-agnostic, and stays

- Chapters drafted in order against a numbered claim list, each seeing the
  script so far (decision 296); the ownership brief; the tension or calm
  contract from the outline; the repairs ladder; the budget gate; the
  30-day review gate; Script Studio's gutter, regenerate and edit trail;
  the deterministic repeats check (`schemas/src/repetition.ts`).

### 3.2 Boom & Busters, fixed in code

| Layer | Fixed in code | Effect |
|---|---|---|
| Claim list | ADJUDICATED / NOT adjudicated on every claim (`prompts/script.ts:76`) | Plain facts read as allegations; the science standing label is appended but no prompt reads it |
| Reviewer prompt | "documentary narration", three warning kinds built around courts (`prompts/script.ts:742`) | Only sourcing and legal hedging are checked; the bible's hedging rules never reach the reviewer |
| Outline | `constraints`: "what must stay attributed and to whom" | Attribution asked for on ordinary facts, per chapter |
| Fix button | note hard-coded to alleged, reportedly, according to (`script-studio.tsx:86`) | Wrong words for a science channel |
| Gate | any warning parks; zero auto-approves (`script-runner.ts:497`) | Never auto-approves in practice |
| House style | no audience, no language | A non-English channel writes in English; the writer does not know who watches |
| Drafter | sees claims, beat, script so far; never the dossier | Scenes, what people wanted and quotes reach the writer only through a one-to-three sentence beat |

### 3.3 Checked by nobody

The craft file (`script-craft.md`, `script-craft-calm.md`) asks for stakes
before context, a planted question per chapter, withhold and reveal once,
escalation, a turn at every chapter end, no recap, no rhetorical question, no
summing-up, varied sentence length, a handful of tags, a close of answer, echo
and open thread. No pass checks any of it. The house style's banned words,
the rhetorical-question ban, the three-same-length rule and the
tag-as-its-own-paragraph rule are deterministic and unchecked; the visuals
stage already checks its banned prompt words in code.

Claim refs (`claim_refs`) are written by every self-check and read by nothing.

## 4. Goals, non-goals, anti-goals

**Goals**

1. A reviewer whose blocking findings are yes-or-no and rare: a sentence
   stating a checkable fact no claim or scene supports; wrongdoing stated as
   fact against a named party when the claim is only alleged; a profile's
   blocking standing status narrated as settled; a six-word repeat.
2. The legal axis scoped to accusations. A `none` claim carries no legal
   marker and is never hedged for legal reasons.
3. A craft pass against the intent's craft file, with one bounded repair
   round, whose findings advise and never park the gate.
4. Free code checks for the deterministic rules.
5. The writer given the dossier's scenes, the audience and the language, and
   told to hit its length.
6. Numbers, not hopes: hedge density, tag density, words against target,
   warnings by severity, printed on the gate line and by a scoring script.

**Later plans (same design)**

7. Whole-script contract check and hook alternatives.
8. An optional outline checkpoint per format.
9. The edits distil: owner edits proposed back as voice dos and don'ts.
10. Retention linked to the outline's beats.
11. A script back-test with a fixed sample set.
12. A third craft playbook (explainer), chosen per format.

**Non-goals**

- A channel writing its own reviewer prompt or craft file.
- Changing the dossier, the voice stage, or Script Studio's editor.
- Per-channel model routes.

**Anti-goals**

- A reviewer that can be switched off for grounding or liability.
- A model raising a claim's standing or legal status in the script.
- A craft pass that parks the gate.
- Paid calls in development or tests without the owner asking.
- Unlike the dossier design, Boom & Busters' prompts **do** change here, on
  purpose: the lift fixtures (`prompts/lift/__fixtures__`, deterministic
  snapshots of composed prompt text, no model call) are regenerated, and the
  change is listed in PROGRESS.

## 5. Architecture

### 5.1 Three layers

1. **Invariants**, every channel, no switch: grounding (a checkable fact
   rests on a claim or a grounded scene), liability (wrongdoing against a
   named party is hedged unless ruled), the repeats check, the budget gate,
   the review gate, and the rule that blocking findings are yes-or-no.
2. **Playbooks**, code, chosen by the bible: the research profile adds its
   standing axis to the reviewer (section 7); the format's intent picks the
   craft file the craft pass judges by (section 8).
3. **Channel values**, the bible: hedging rules (now scoped, section 6.2),
   voice dos and don'ts, audience, language, extra script rules, example
   slots. The reviewer reads the hedging rules; the fix button's words come
   from them.

### 5.2 Severity

Every warning kind has a default severity in code: `blocking` or `advisory`.
`GutterWarning` gains an optional `severity` field, written by the pass that
knows better than the kind's default (the standing pass, whose severity is
the profile's) and absent on every row stored before this design.
`severityOf(warning)` returns the stored one or the kind's default, so a
row written before this design reads as blocking, which is what it was. A
`countBlocking(chapters)` beside `countWarnings` is what the gate, the
Needs-you card and the gate line count; nothing needs the profile at read
time. The gate counts blocking warnings only. Zero blocking auto-approves
whatever the advisory count. The gate line and the Needs-you
card say both: `Script ready · 7 chapters · ~14 min · 0 blocking · 9 advisory
· hedges 0.8/100w`.

| Kind | Severity | Source |
|---|---|---|
| `unsourced-claim` | blocking | grounding pass |
| `missing-alleged` | blocking | liability pass (scoped, 6.3) |
| `overstated-standing` | per profile status | standing pass (7) |
| `repeats-earlier` | blocking | code (unchanged) |
| `unsupported-attribution` | blocking | liability pass: intent or action attributed to a named person beyond the claims |
| `craft` | advisory | craft pass (8) |
| `style` | advisory | code checks (9) |
| `off-target-length` | advisory | code check (9) |

Script Studio's gutter shows both, blocking in the warning colour and
advisory muted, each with its kind and message as today. The fix button on
`missing-alleged` builds its note from the bible's hedging rules; a `craft`
finding gets "Rewrite this passage…" with the finding as the note, through
the existing regenerate path.

## 6. The claim list and the liability rule

### 6.1 Markers

The claim list prints a legal marker only when there is a legal status to
print: `— ALLEGED, not ruled` for `alleged`, `— RULED` for `ruled`, nothing
for `none`. `ScriptClaim.adjudicated` becomes `legal: 'ruled' | 'alleged' |
'none'`; the runner maps it from `claim.legalStatus`. UNVERIFIED, the
standing label, NEWS ARTICLE and X POST stay as they are.

### 6.2 The hedging rules, scoped

The channel's hedging rules are the owner's data, not code, so the design
proposes text and the owner pastes it into the Bible tab. For Boom & Busters:

```
The hard rules:
- Assert nothing the claim list and the dossier's scenes do not support.
  Never invent figures, dates, quotes, names or actions by a real person.
- A claim marked ALLEGED is an accusation no court or regulator has ruled on.
  Where the narration states what that accusation says, carry the hedge
  inline: "alleged", "prosecutors say", "according to the complaint". A
  claim marked RULED is stated as the court or regulator found it. A claim
  with no marker is a fact of the record: state it plainly, with no hedge
  and no attribution unless the attribution is itself the point.
- Never a sentence of its own saying that nothing was proven, that no court
  has found, that the figures are unaudited, or that this is one reading.
  The one exception is the film's single such sentence, where a chapter's
  constraints ask for it.
```

The seed bible in `schemas/src/channels.ts` (`FIRST_CHANNEL_BIBLE`) and the
mock psychology bible take the same shape, each in its own words. The
`script-hedge-kind` and `script-legal-care` example slots keep their names.

### 6.3 The outline's constraints

The `constraints` instruction becomes: "the wording limits for this chapter:
which ALLEGED claims it narrates and the hedge each must carry; which figures
are UNVERIFIED and must not appear; the film's single plain caveat sentence,
if this is the chapter that carries it. Nothing else: a claim with no legal
marker needs no attribution and no caveat." The dossier's corrections still
go here.

## 7. The reviewer

One `editing`-task call per chapter, as today, with a rewritten prompt and
answer. It carries the bible's hedging rules and the profile's standing rules.

**Grounding.** A sentence is unsourced when it states a checkable specific
(a figure, a date, a name, a quote, an event, an action by a named real
person) that neither the claim list nor the scene list supports. A
transition, a characterisation, an image, the channel's reading, or a
generalisation nobody could check is never unsourced. The prompt gives three
examples of each side (taken from section 2: "It vanished." is not a claim;
"Son checked his watch" is).

**Scenes.** The dossier's grounded scenes reach the reviewer and the drafter
as a numbered scene list beside the claim list, each scene's text as the
dossier renders it. The builder chooses the source (the stored dossier's
structured scenes, if the dossier row carries them, else the Scenes section
of the markdown) and keeps one function for both prompts so they agree. A
sentence may rest on a claim or a scene.

**Liability.** `missing-alleged` fires only when the sentence states as fact
what an ALLEGED claim accuses a named person or organisation of. A sentence
resting on an unmarked or RULED claim never triggers it.
`unsupported-attribution` is unchanged in meaning and now stated beside it as
the second liability rule.

**Standing.** When the profile has an evidence axis, the prompt adds: a claim
marked with one of the profile's labels is narrated as that label says; a
sentence that narrates a `CONTESTED` or `ONE STUDY` claim as settled gets
`overstated-standing` with the label in the message. The profile says which
statuses block: `science` marks `contested` blocking and `single_study`
advisory, in a `review` block on the research profile:

```ts
review: { standing: { blocking: ['contested'], advisory: ['single_study'] } } | null
```

`investigation` has `review: null` and its prompt carries no standing rule.
`review` is a field of `ResearchProfile` in `schemas/src/research-profiles.ts`.
A frozen bible stored before profiles reads as `investigation`
(`researchProfileOf`), so it gets no standing rule. A claim with a null or
unknown evidence status has no `standing` label (`evidenceLabel` returns
null) and the rule never applies to it; the prompt says so in one line.

**Answer.** `{"warnings": [{"kind", "sentence", "message"}]}`. Claim refs are
gone from the answer and the schema; `claim_refs` stays as a table, unwritten,
and spec section 7.2's "writes claim_refs" is amended. The mock self-check
keeps returning one blocking warning on the first sentence.

## 8. The craft pass and its repair round

After each chapter is drafted and before its reviewer call:

1. **Craft pass**, on the `scripting` route with thinking room
   (`outputBudget(answer, CRAFT_THINKING_TOKENS)`, the critic's precedent,
   decision 450). Input: the house style and the intent's craft file as the
   drafter saw them, the chapter's contract and ownership brief, the script so
   far, and the chapter. It is told it is the script editor, not the writer.
   It reports where the chapter breaks the craft it was written under:
   opening by restating; ending on resolution, a moral, a summary, or a
   formulaic tease; a recap in the middle; a rhetorical question; a planted
   question answered in the same chapter; a withheld fact leaked; a
   stand-alone caveat sentence; metronomic sentences; tags that gasp at
   everything; a figure, name or attribution the listener has already heard
   repeated in full. Each finding quotes a sentence and says what to do
   instead. At most eight findings; the model is told to report only what it
   would make the writer fix.
2. **Repair round**, once: if the pass found anything, the chapter is
   redrafted with `buildChapterRequest` plus one more user message carrying
   the draft and the findings ("Revise this draft. Fix these and change
   nothing else."). The craft pass runs again on the revision. Findings that
   survive are stored as `craft` warnings (advisory). The repairs are recorded
   on the script's notice strip as the outline's repairs are (decision 296),
   one line per fixed finding, so the owner sees what the loop changed.
3. The reviewer call then runs on the final text.

**Steps and the revised text.** The loop is new steps after each chapter's
draft step: `craft-check-N`, `craft-revise-N`, `craft-recheck-N`. The revise
step updates the chapter row's `contentMd` and `estRuntimeSec` and returns
the revised text; the runner's `written` entry for the chapter takes the
step's returned text, so the self-check and Shorts steps read the revision
through step memoisation as they read the draft today, and nothing re-reads
chapters from the database. A run parked before the deploy replays its old
steps and meets the new step names only for chapters it has not reached.

**Anchors.** A craft finding quotes a sentence; one the model paraphrased
anchors nowhere and is kept, shown as Script Studio already shows a warning
whose sentence is gone ("no longer in the chapter"), never dropped.

The repair round and the second pass are skipped when the first pass finds
nothing. Both are budget-gated through the same ladder as the chapter draft;
a budget stop parks the stage as a chapter's does. A craft pass that fails
to parse is a stop for that chapter's loop, not for the stage: the chapter
keeps its first draft and a notice says the loop stopped.

The stage's cost estimate counts, per chapter, one craft call and, at most,
one redraft and one further craft call.

## 9. Code checks

A `scriptLint(chapters, outline, targetWords)` in `packages/schemas` beside
the repeats check, deterministic and free, run in the self-check step after
the model's warnings and stored with them. `targetWords` is the number the
outline request already computes from the project's runtime, the format's
words per minute and the fixed lines (`buildOutlineRequest`); that
calculation moves to an exported `scriptTargetWords(targetRuntimeMin,
format)` both callers use.

- `style`: a sentence ending in a question mark (the ban on rhetorical
  questions); a banned word from the house style's list (the list moves to a
  constant both the prompt and the check read); three consecutive sentences
  of over eight words within two words of each other; a paragraph that is
  only a tag; more than one tag per 120 words of a chapter; `[long pause]`
  more than once in a chapter; a number of three or more digits written in
  digits that is not a four-digit year (the owner spells these out).
- `off-target-length`: a chapter under 90% or over 120% of its outline
  target, and the whole script under 90% of the format's target words.

The chapter prompt's length line becomes "Write between N and N×1.1 words.
Under N is too short." The house style gains: "A handful of tags per
chapter, at most one every 120 words, and [long pause] at most once."

## 10. The writer

- **Scenes**: section 7's scene list joins the claim list in the chapter
  request's cacheable prefix. The house style says: "The scenes are the
  dossier's: use them for what people did, wanted and said. The claims are
  the facts. A detail in neither is not yours to write."
- **Audience and language**: the house style opens "You write narration for
  {audience}, for a documentary channel about …". When the bible's language
  is set and is not English, the house style adds "Write in {language}" with
  the code expanded to its name, and the numbers rule's example slot is the
  channel's own.
- **Attribution**: the house style's hedging block is the bible's (6.2); the
  constraints instruction is 6.3. Nothing else in the writer's prompts
  changes.

## 11. Measurement

`pnpm script:score [--project <id>]` prints, per script version: words and words against target; estimated minutes; warnings
by kind and severity; hedge and attribution phrases per hundred words; tags
per hundred words; chapters ending on a question or on the same final
clause shape; owner edits by kind. It reads the local database by default and
production only under `--prod`, read-only, when the owner asks. The gate line
carries the hedge density. These numbers go into PROGRESS when the design
ships, measured on the four production dossiers re-scripted locally in mock
mode for the shape and, when the owner asks, once live.

## 12. Plans

1. **The reviewer and the gate**: markers (6.1), the seed and mock bibles'
   hedging text (6.2), the constraints instruction (6.3), the rewritten
   reviewer with scenes, scoped liability and standing (7), severity and the
   gate (5.2), the gutter and fix button, code checks (9), claim refs
   dropped, the scoring script (11), lift fixtures regenerated, the e2e gate
   path for zero blocking.
2. **The writer and the craft loop**: scenes, audience and language in the
   writer (10), the craft pass and repair round (8), the length rules, cost
   estimates.
3. Whole-script contract check; hook alternatives judged pairwise.
4. Outline checkpoint per format.
5. Edits distil into proposed voice dos and don'ts.
6. Retention over the outline's beats.
7. Script back-test with a fixed sample.
8. Explainer playbook per format.

## 13. Owner actions

1. Paste the scoped hedging rules (6.2) into Boom & Busters' bible in the
   Bible tab after plan 1 deploys; projects already past the dossier gate
   keep their frozen bible. No migration or data step writes the stored
   bible: until the paste, the old rules make the writer hedge more than it
   needs to, but the reviewer's liability rule is in code and scoped, so no
   warning comes of it.
2. Check the `scripting` route in Settings: the craft loop judges on it, and
   the last three scripts were written on `gemini-3.8-flash`.
3. `PUT /api/inngest` after each deploy (the runner's steps change). No
   migration in plans 1 or 2.
4. Optional, paid: a live scoring run on one project.

## 14. Left to the builder

- The exact prompt wording, within the rules above, and the few-shot
  examples for the grounding line.
- Where the scene list is read from and how it is numbered, as long as the
  drafter and the reviewer share one function.
- The craft pass's answer shape and its repair ladder, in decision 292's
  mould.
- Step names for the new runner steps, chosen so a run parked before the
  deploy replays its old steps untouched and reads the bible inside each
  new step.
- The scoring script's exact output.

## 15. Risks

- The craft pass on a weak route finds nothing or finds noise. The findings
  cap and the "only what you would make the writer fix" rule bound the
  noise; the route is the owner's to set.
- Scenes in the prefix lengthen every chapter call. They are cached across
  the script's chapters, as the claim list is.
- A scoped grounding rule lets an invented abstraction pass. Accepted: the
  cost of flagging "It vanished." seventy times a script is a gate that never
  opens.
- A run parked at the script gate before the deploy replays old step
  results; new fields are computed inside steps (memory: parked runs replay
  old step results).
- Regenerated lift fixtures hide an unintended prompt change. The PROGRESS
  entry lists every changed line of the investigation prompts.
