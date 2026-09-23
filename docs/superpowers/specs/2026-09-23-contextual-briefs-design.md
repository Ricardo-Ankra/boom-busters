# Contextual briefs: people and place first, and a lint that acts

Decision 271. Design approved in conversation 2026-09-23.

## 1. The problem

The owner's report: shot briefs are "too symbolic, or actually showing
something irrelevant to the narration", and the plan lint "recognises all
these issues, but does nothing about it".

The example. Narration: *"Reporting at the time pointed to financial pressure
on the business and disagreements inside the boardroom over where it was
headed."* Brief: *"A high-end, aluminum-chassis rack-mounted AI server unit,
a coiled power cable resting on top of it"*, set "Cloud Computing Data
Center". The owner would have shown Emad Mostaque in the boardroom with the
investors.

Measured on the live Stability AI plan (read-only, 2026-09-23):

| | |
|---|---|
| picture briefs | 62 |
| mention a server, rack or blade | 55 (89%) |
| describe an empty, unpeopled scene | 21 |
| stills naming a person | 7 of 53 (13%) |
| stills naming a set | 26 of 53 |

## 2. Causes

1. **The Director's Book converged on one symbol.** The same server
   appears in the visual thesis ("told through empty server rooms"), the
   anchor object ("a rack-mounted AI server unit"), motif one ("a glowing
   blue server blade in a darkened rack"), three of seven key images (in
   chapter 3 the key image IS the motif), and the era lock. The shot-list
   model reads a book that says the film is servers. The owner's example
   brief is the anchor object verbatim.
2. **The era lock is pasted into every prompt.** The bible says "Append the
   director's book invariants verbatim: the era lock". The era lock is an
   object list ("... unibody aluminum laptops, rack-mounted blade servers
   ..."), so all 53 still prompts ask the image model for servers, whatever
   their subject.
3. **The house look defaults to emptiness.** "Rooms after the people have
   left ... empty trading floors" and "Light carries the mood, never the
   face" work against the cast photographs the producer uploaded.
4. **Abstract sentences go straight to a symbol.** "Only when a sentence
   names nothing photographable (an abstraction ...) reach for the
   director's book: the key image, a location, a motif." Most sentences in
   a money documentary are abstract, so the fallback is the default.
   Nothing says to stage the abstraction through the people and place it
   concerns, which is what the owner did.
5. **A motif floor.** "Each chapter shows at least one of them."
6. **The lint is advisory, and it overcounts.** `motifPattern` matches a
   motif by its head noun, `rack`, and `\brack\b` matches `rack-mounted`
   inside the pasted era lock. "10 of 10 picture briefs" means every still,
   because every still carries the era lock. It cannot tell a server
   subject from a server in the era lock, so it cannot drive a repair as it
   stands.

## 3. Goals and non-goals

Goals:

- A sentence that names a person or a place is shown with that person or in
  that place. An abstract sentence is staged through the people and place it
  concerns.
- Motifs are optional punctuation with a ceiling and no floor.
- The era lock constrains a frame; it never populates one.
- The lint's findings are accurate enough to act on, and they are acted on:
  one automatic repair per chapter, then a button for what survives.
- A banned word never reaches the image model.

Non-goals:

- Re-planning existing films automatically. The owner presses Redraft
  direction then Re-plan (section 9).
- A deterministic lint on the Director's Book itself. The book prompt
  changes; a book-level note is a later decision if the prompt alone does
  not hold.
- Repairing chart, map, headline or graphic slots. Their briefs carry claim
  references validated elsewhere; repair touches picture briefs only.

## 4. Prompt changes

### 4.1 The bible (`direction-craft.md`, re-embedded with `embed:craft`)

- **House look.** "Rooms after the people have left. Documents, hands,
  screens, glass, reflections, corridors, car parks at night, empty trading
  floors." becomes: the people, in the rooms where it happened, re-created
  with a reconstruction's restraint; empty rooms, documents and objects are
  punctuation between them, not the film.
- **Faces.** "Light carries the mood, never the face." becomes: light
  carries the mood; faces are allowed and, where the cast is photographed,
  wanted, lit by the scene's own sources.
- **The sentence decides the frame.** The abstraction fallback is replaced:
  an abstract sentence (pressure, doubt, a disagreement, a judgment) is
  staged through the people and the place it concerns. The owner's example
  is written in as the worked case: "financial pressure and disagreements
  inside the boardroom" is the principals at the boardroom table, not an
  object standing in for them. Only a sentence with no person and no place
  in it reaches for the book, and then for the chapter's location first and
  a motif last.
- **Motifs.** The floor goes. A motif is used only where the sentence has
  room for it, at most once per chapter, never in adjacent slots, never the
  subject unless the sentence is about that object.
- **Three physical facts.** The clause letting a motif stand in for the
  third fact goes; the third fact is always drawn from the sentence.
- **Era lock.** "Append the director's book invariants verbatim: the era
  lock for the moment and the palette line." becomes: append the palette
  line verbatim; the era lock is a constraint, not a list to paste. Every
  period object in the frame comes from it, and the prompt names only the
  objects actually in the frame.
- **Pre-flight.** "Every chapter shows at least one motif" goes. Added: a
  sentence that names a person or a place shows that person or place.

Every phrase a test asserts sits whole on one line of the markdown.

### 4.2 The Director's Book prompt (`prompts/direction.ts`)

- The visual thesis describes how the film looks including its people, and
  never prescribes empty rooms or one object as the film's subject.
- The anchor object is not one of the motifs.
- The three motifs are three different objects, sharing no head noun with
  each other or with the anchor object.
- A chapter's key image leads with the people and place of the chapter's
  turn where the claims name them, is one photographable moment rather than
  a list, and carries at most one motif.
- Era locks constrain what a frame may contain and are never its subject.

### 4.3 The shot-list prompt (`prompts/shotlist.ts`)

The planning rules mirror 4.1: stage abstractions through people and place;
a sentence naming a photographed person or a set's place is shown with that
person or in that set; motifs are optional; the era lock is a constraint.

## 5. Findings: one rule set, two views

`packages/schemas/src/direction.ts` gains a pure `craftFindings` returning
per-slot findings:

```ts
type CraftFindingKind =
  | 'size-run'        // third of three adjacent slots at one size
  | 'motif-repeat'    // a motif's second or later use in a chapter, or adjacent use
  | 'set-run'         // a set named on two adjacent slots
  | 'ignored-person'  // the sentence names a cast member the shot does not show
  | 'ignored-set'     // the sentence is in a held set the shot is not in
  | 'banned-word'
  | 'unknown-set'

interface CraftFinding {
  kind: CraftFindingKind
  slotIndex: number   // index into the slots passed in
  message: string     // what the producer reads, and what the repair call is told
  repair: 'auto' | 'manual' | 'none'
}
```

`repair` separates what the machine may spend on from what only the producer
may. **auto** findings are fixed by the automatic repair (section 7) and by
the button (section 8). **manual** findings are shown, and fixed only when
the producer presses the button. **none** findings are notes.

The line is precision against cost. Automatic repair spends without asking,
so it acts only where the problem is unambiguous and the fix is clearly an
improvement. A finding whose fix would turn a free slot into a paid still, or
put a real person on screen from a text description alone, is real but not
clearly better, so it is the producer's call.

`planWarnings` keeps its signature and its strings, and is re-expressed over
`craftFindings`, so the plan screen and the repair pass cannot disagree about
what is wrong. The existing chapter-level wording ("motif X appears in 6 of 6
picture briefs in chapter 1") is kept for display.

Rules that change:

- **Motif matching ignores era-lock text.** The book's era-lock `rules`
  strings are removed from a brief's text before a motif pattern is tested.
  This fixes the overcount for plans stored before 4.1 as well as after.
- **The motif threshold follows the new ceiling.** A motif used more than
  once in a chapter is a finding on every use after the first; two adjacent
  uses are a finding on the second.
- **`ignored-person` (new).** A still, hero or stock brief whose
  `coversText` contains, as a whole word and ignoring case, the last word of
  a cast member's name, and which does not show that member: for a still or
  hero, `depicts` does not name them (by `nameMatches`); a stock brief can
  never show them. Archival is never flagged, since the producer sources it
  by hand. The repair level depends on what the fix would cost:

  | the member | the slot | repair | what the fix changes |
  |---|---|---|---|
  | photographed | still or hero | auto | adds them to `depicts`; the photograph travels |
  | not photographed | still or hero | manual | a likeness from the identity string alone |
  | any | stock | manual | the slot becomes a generated, paid still |

  Only the first row is unambiguous. There the producer's photograph was
  available and went unused, which is the waste this decision exists to
  stop. In the second, the model has no photograph, and a real face drawn
  from a text description tends to come out as a stranger and to draw
  refusals (decision 253). In the third, the fix is a retype from free to
  paid. Both are real misses, so both are shown, but spending on them is
  the producer's decision.
- **`ignored-set` (new).** A still, hero or stock brief whose `coversText`
  contains a held set's key noun and which is not in that set: for a still
  or hero, `set` names a different set or none; a stock brief can never
  carry a set's plates. The key noun is the set name's last word, unless
  that word is generic (`center`, `centre`, `room`, `office`, `building`,
  `floor`, `space`, `area`), in which case it is the last two words. "the
  boardroom" matches "Venture Capital Boardroom"; "the data center" matches
  "Cloud Computing Data Center"; "at the center of it" does not. **auto** on
  a still or hero, **manual** on stock, for the same reason as the person
  rule's third row.
- **A manual finding's message says what fixing it changes**, so the
  producer weighs it before pressing anything: "Mostaque is named here but
  the shot is stock; fixing makes it a generated still", "Sean Parker is
  named here; fixing puts Sean Parker on screen from a description, with no
  photograph". Messages name people and never refer back to them with a
  pronoun, for the reason the reference declaration does not: a pronoun
  would be a guess about a real person.
- **Repair levels for the rest.** `size-run`, `motif-repeat` and `set-run`
  are **auto** on a still, hero, stock or archival brief. Every kind is
  **none** on a chart, map, headline or graphic brief, whose briefs carry
  claim references validated elsewhere. `banned-word` is always **none**,
  since section 6 removes the word itself, and `unknown-set` stays a note.

Inputs: slots in screen order (brief plus chapter label), banned words,
motifs, era-lock rule strings, the cast as `{ name, photographed }` (every
member, since the person rule reaches unphotographed members too), held set
names. The
brief input is the narrow shape the rules read (type, shotSize, coversText,
description, prompt, query, depicts, set), so it accepts both planned and
stored briefs.

## 6. Banned words are removed, not reported

`packages/providers` gains `stripBannedWords(text, banned = BANNED_PROMPT_WORDS)`
beside the list: each banned word or phrase removed as a whole word, ignoring
case, then orphaned punctuation and doubled spaces tidied (", ," becomes ",",
" ." becomes ".", a leading ", " is dropped).

Applied to a still or hero brief's `prompt` (the `description` is for people
and is left alone):

- in `plannedToRows`, which the plan, the re-plan and the repair all pass
  through, so a stored plan never carries one; and
- in `generateStillCandidates`, as the last line before the image model, so
  a brief stored before this change, or edited in by hand, is cleaned at the
  point it would do harm.

A `banned-word` finding can therefore only appear on a brief stored before
this change and never fetched since; it is reported and never repaired.

## 7. Automatic repair, once per chapter

In `planChapterSlots` (`apps/web/inngest/lib/direction.ts`), after the
chapter is parsed (a `banned-word` finding is always **none**, so it never
reaches the repair call; section 6 removes the word on the way to storage):

1. Compute `craftFindings` over this chapter's slots.
2. If none is **auto**, continue exactly as today. A clean chapter costs
   nothing extra, and a chapter whose only findings are **manual** is left
   for the producer: the automatic pass never spends on them.
3. Otherwise make ONE repair call covering the **auto** findings only: the
   chapter's own shot-list request
   (identical system prompt and cacheable prefix, so the claim list and the
   book are a cache hit) plus one further user message listing each
   slot with an **auto** finding by index, with its current brief and those findings, and
   asking for `{"slots": [...]}` holding exactly one replacement per listed
   index, in that order, each keeping its `paragraphIndex` and `seconds`.
   Its answer budget is sized to the number of replacements, with the
   existing floor.
4. Each replacement is parsed with `PlannedSlotSchema`. A replacement that
   fails to parse, or whose brief type differs from the original's, is
   dropped and the original kept. Keeping the type is what makes the
   automatic pass safe to run unasked: a motif repeat on a stock slot must
   not come back as a still, because that turns a free slot into a paid one,
   which is the producer's call (section 8, where a stock brief may become a
   still and nothing else may change type). `paragraphIndex` and `seconds` are forced back to the
   original's whatever the model returned, so repair can never move the
   timeline.
5. Findings are recomputed. What survives is what the plan screen shows.
6. Never a second round. A plan that is still wrong after one repair is the
   owner's to judge.

Failure is never fatal to the chapter. A `BudgetExceededError`, a
malformed answer or any other repair error keeps the unrepaired plan, which
is a valid plan; the chapter's own `BudgetExceededError` from the first call
behaves exactly as today. Mock mode skips the repair call: `callLlm` has no
mock path for the shot list, the mock plan (one stock slot per paragraph,
alternating sizes, no motif) produces no **auto** finding, and the web
tests exercise the repair with a stubbed model call instead.

## 8. The "Fix these" button

The plan screen's warnings panel shows **Fix these N slots · ≈$X** when any
stored slot has an **auto** or **manual** finding, N being the number of
distinct such slots. The button acts on both levels: pressing it is the
producer's consent to the spending the automatic pass would not do alone.

When any of those slots is a stock slot whose fix makes it a generated
still, the button says so beside the estimate ("3 become generated stills"),
because that changes the fetch bill as well as the planning call. The plan
screen's existing Fetch estimate already prices every still, so it rises on
its own once the fix lands. It sends `visuals/replan.requested` with a new op,
`repair`, handled by the visuals-replanner under the same contract as
`direction` and `shots`: only at the plan checkpoint, the parked runner
untouched, failure reported as a side-job message.

The `repair` op loads the plan inputs the `shots` op already loads, reads
the stored slots, computes findings per chapter, runs the section 7 repair
call once per chapter that has any **auto** or **manual** finding (the only
difference from section 7 is that manual findings are included, and a
replacement may change a stock brief into a still), and writes each accepted
replacement
with `updateSlotBrief`, which drops the slot back to `unresolved` and clears
any refusal, so a slot pre-fetched during plan review is re-fetched for its
new brief rather than keeping candidates bought for the old one. Slots with
no finding are never touched. The estimate is one
shot-list call per affected chapter, priced like the re-plan estimate.

## 9. Existing films

Nothing re-plans on its own. For the Stability AI film the owner presses
**Redraft direction** (a new book under 4.2), then **Re-plan** (every
chapter under 4.1 and 4.3, each auto-repaired under section 7). Nothing is
generated until Fetch.

## 10. Cost

- Auto-repair: at most one extra shot-list call per chapter with an
  **auto** finding, prompt prefix cached. Worst case a seven-chapter film
  adds seven calls; a clean plan adds none.
- The button: the same, per affected chapter, spent only when pressed. A
  manual fix that turns a stock slot into a still also adds that still's
  generation to the Fetch bill; the button names how many before it is
  pressed.
- Automatic repair never changes a slot's type, so it can never add a paid
  still to the fetch.
- Banned-word stripping: free.

## 11. Testing

- **schemas:** `craftFindings` ignores a motif noun inside era-lock text;
  flags every motif use after the first and an adjacent repeat; grades
  `ignored-person` by the section 5 table (auto for a photographed member on
  a still, manual for an unphotographed member on a still, manual for anyone
  on stock), never flags archival, and stays silent when `depicts` names the
  member with a role suffix; grades `ignored-set` auto on a still and manual
  on stock, with the generic-word fallback and the "at the center of it"
  negative; grades chart slots none; manual messages say what the fix
  changes and name people without a pronoun; `planWarnings` strings
  unchanged for a plan with no era lock.
- **providers:** `stripBannedWords` on single words, phrases, case,
  punctuation and word boundaries ("unprofessional" survives); the repair
  request reuses the chapter's system prompt and prefix and lists each
  finding; the bible stays byte-identical to its markdown; the shot-list and
  book prompts carry the new rules.
- **web:** `planChapterSlots` makes no repair call for a clean chapter or
  one whose only findings are manual, and exactly one for a chapter with an
  auto finding, which lists the auto findings and none of the manual ones;
  the replanner's `repair` op includes manual findings and may turn a stock
  slot into a still; the button counts both levels and names how many slots
  become generated stills; splices replacements while
  forcing `paragraphIndex` and `seconds`; keeps the original for an
  unparseable replacement; keeps the unrepaired plan when the repair call
  exceeds the budget; stores no banned word; the replanner's `repair` op
  touches only flagged slots and refuses outside the plan phase; the button
  shows its count and sends the op; `generateStillCandidates` strips a
  banned word from a stored prompt.
- **e2e:** the full suite stays green in mock mode.
