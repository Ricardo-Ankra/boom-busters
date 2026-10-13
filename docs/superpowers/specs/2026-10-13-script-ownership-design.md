# The script remembers what it told (decision 296)

Status: design agreed in conversation 2026-10-13 (owner: "write the plan, we
don't need the Sonnet comparison"); this document travels with the plan.

## 1. The problem

The Stability AI script of 8 October (version 3, Opus 5.5, the first script
drafted under decision 216's craft rules) repeats itself and jumps about.
Measured across every production script, the share of six-word runs that
already appeared in an earlier chapter went from 0.00 to 0.12 per cent
(Carillion, Stability v1 and v2; Haiku 4.5 and Sonnet 5, before decision 216)
to 1.19 per cent in v3, with three mid-chapter recaps and nine sentences
saying that nothing was proven. Nothing was ever drafted with Gemini.

The causes, in the pipeline rather than the model:

1. **Each chapter is drafted blind to the script so far.** `buildChapterRequest`
   gives the drafter the claim list, the chapter titles and the previous
   chapter's last two sentences. It cannot know that the CompVis paper or The
   Information's figures were already explained, so it explains them again.
2. **"Continue from there" invites an echo.** The last two sentences are
   offered as the place to resume, and the drafter restates them before
   moving on (chapter 3 ends "Coatue had co-led the 101 million dollar
   round"; chapter 4 opens "Coatue Management had co-led that round").
3. **The outline schedules the double telling.** The craft rule "open at the
   point of highest consequence, then rewind" says nothing about what happens
   when the chronology catches up with the cold open, so the planner wrote
   "return to March 2024 with its meaning restored" and listed every March
   fact again. Version 2 did the same with a chapter called "The
   Resignation, In Full".
4. **No fact has a home.** The outline has beats but no claim assignment;
   every chapter sees all 45 claims and reaches for the strong ones. The
   prompt's "anything the chapter needs must be in these fields" produced
   1,300 to 1,800 character beats that are fact lists, and Opus follows them.
5. **Legal caveats are narrated.** The planner copied the dossier's "pitch
   corrections" into every beat and the drafter read them out as sentences.
   The inline hedges are right; the nine disclaimer sentences are not.
6. **The recap ban only covers chapter endings.** "So that's the position"
   and "So this is where things stood" are mid-chapter.

The research behind the design (long-form YouTube practice, nonfiction story
craft, and the long-story-generation literature) agrees on three things: a
written loop table that says where every open question opens and closes; one
home per fact, with the writer shown what the reader already knows; and a
payoff that echoes rather than restates.

## 2. What changes

### 2.1 The outline becomes a plan

`OutlineSchema` gains hint fields in the mould of decision 216's tension
fields (clamped and folded, never a refused outline):

- root `storylines`: two to four named threads (the money, the credit, the
  courts), at most six, each at most 200 characters;
- per chapter `storyline`: which thread this chapter advances;
- per chapter `claims`: the 1-based numbers of the claims this chapter
  narrates in full. Every claim belongs to one chapter. The parser keeps the
  first owner and drops a later duplicate, and drops a number the claim list
  does not have, each as a `dropped` repair (decision 293);
- per chapter `reveals`: the fact an earlier chapter withheld that this
  chapter reveals, if any;
- per chapter `constraints`: wording limits (what stays attributed, what is
  never stated as fact, which figures are unsourced). They shape the words
  and are never narrated.

`beat` shrinks to purpose: the prompt asks for one to three sentences, and
the parser trims a beat over `OUTLINE_BEAT_MAX` (600 characters) at a
sentence, reported as a `trimmed` repair. The outline's repairs reach Script
Studio's strip beside the Shorts marking's.

The outline prompt is rewritten around the plan: the cold open is a glimpse
with most detail withheld and owns none of the claims of the moment it
glimpses; the chapter where chronology returns to it owns them, opens with
one line of callback and narrates only its own claims (the parser gives a
claim the opening and a later chapter both list to the later one); a chapter
advances one storyline and may touch the others in a few words, and a
storyline left untouched for two chapters returns in the next; constraints
are a field, not a beat. The drafter's brief also names the claims the
outline placed nowhere, free to any chapter once.

### 2.2 Drafting sees the story so far

`buildChapterRequest` takes `previousChapters` (title and full text of every
chapter drafted so far) in place of `previousTail`. The seam instruction
becomes: the listener has just heard all of this; the first sentence moves
the story forward; never restate or paraphrase the ending, never re-introduce
anyone or re-explain anything in it.

An ownership brief, built from the outline's `claims`, tells the drafter
which claim numbers it narrates in full, which were already told (refer back
in a few words, no figure, date or attribution repeated) and which belong to
later chapters (do not narrate). An outline without `claims` (pre-296) sends
no brief.

The tension contract gains two lines: reveal here, for the first time, what
an earlier chapter withheld; and the wording limits, never narrated.

### 2.3 The house style and the craft file

House style: no summing-up anywhere (mid-chapter included); legal care is
inline ("alleged", "reportedly", "according to"), never a sentence that says
nothing was proven or that this is an interpretation, except the film's one
such sentence where a chapter's constraints ask for it.

`script-craft.md` gains: the cold open as a glimpse and its return as one
line of callback; "One home per fact"; "Callbacks, not recaps" (a callback
points back in a few words and adds meaning, a recap re-narrates; never open
on the previous ending); a withheld fact is revealed in exactly one chapter;
the chapter at 40 to 60 per cent of the runtime turns hardest. Re-embedded
into `script-craft.ts`, held byte-identical by the existing test.

### 2.4 A repetition check on the whole script

A deterministic pass, no model call: `findRepeats(chapters)` in
`packages/schemas/src/repetition.ts`. A sentence in chapter k whose words
(narration tags stripped, lower-cased, punctuation removed) contain a run of
six words that appeared in an earlier chapter gets one gutter warning of the
new kind `repeats-earlier`, its message naming the earlier chapter and
quoting the sentence it repeats. Same-chapter repeats are the prompt's
business, not the check's. The runner computes the repeats from the drafted
chapters and stores them with each chapter's self-check warnings, so a
repeat parks the gate like any other warning and the human sees it in the
existing gutter. No UI change: the gutter renders any kind.

In mock-provider mode every chapter's narration is the same stand-in text,
so chapters two onward carry repeat warnings; the gate already parks in mock
mode on the mock self-check's warning, so nothing about the e2e flow changes.

### 2.5 What does not change

Shorts marking, the teaser, the Director's Book and the regenerate pass read
the outline leniently and ignore the new fields. The claim list, the
self-check prompt, the budget and the step layout of the runner stay as they
are. No migration: the outline is a JSON column and the warning kind is a
string in a JSON column.

## 3. Out of scope

Verifying the Getty UK judgment; a second model comparison; any change to
the dossier prompt (the pitch corrections stay in the dossier, the outline
now has a field to put them in).
