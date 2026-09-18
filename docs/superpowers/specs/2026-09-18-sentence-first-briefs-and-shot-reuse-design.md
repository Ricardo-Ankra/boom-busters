# Briefs follow the sentence, and a shot can be reused

Approved by the owner, 2026-09-18, in two parts: design 1 (decision 260) and
design 2 (decision 261, mechanism A of three). Extends build-spec section
7.4's visuals-runner, section 11.3's visual board, and the Director's Book of
decision 252. The five pipeline gates are untouched.

## Problem

Two observations from reviewing a real shot list.

**Motifs are wallpaper.** The Director's Book names three recurring motifs
for a film. On the board, the same empty chair, server racks and LCD screens
appear in still after still, including under narration that names something
else entirely. The shot that would have served the sentence (the place, the
document, the event the narrator just described) is not planned; the motif
is. The owner's words: "sticking too strongly with the motifs and elements
... what would have been better is to have looked at the narration text and
created a shot that actually captures what the narrator just said."

**Nothing can be reused.** Every slot fetches or generates its own picture.
Some shots would serve twice, spread across the film, and a still costs money
each time it is generated. There is no way to say "show that one again here".

## Diagnosis

The motif problem is in the fixed House Visual Bible, not in the per-film
book. `direction-craft.md` requires, under "What a still prompt must
contain", three physical facts in every prompt, the third being "one motif
from the director's book". Every AI still is therefore required to carry a
motif. The chapter rule two paragraphs earlier ("each chapter shows at least
one of them") is a floor with no ceiling, and the per-still rule makes the
floor irrelevant. Three things compound it: no rule ties the picture to the
sentence (`coversText` must quote the narration exactly, but nothing says the
frame must show it); the book prompt asks for "exactly three recurring visual
motifs" with no guidance on choosing them, so the model restates the house
look (screens, empty rooms) rather than finding this story's own objects; and
the bible's redirect fallback names "the empty chair" as its first example.

Reuse has no data path. A slot's `candidates` jsonb holds one `chosen`
candidate and assembly reads that per slot, so two slots pointing at one
asset already renders correctly. What does not exist is any way to point.
Chapters are planned by separate calls that cannot see each other, so a model
cannot spot cross-chapter repeats at plan time; the owner can.

## Design 1: the sentence decides the frame (decision 260)

**Principle.** A frame shows what its sentence says. The Director's Book
supplies era, palette, people and a small set of recurring details; it never
supplies the subject. Motifs keep a floor (each chapter shows at least one)
and gain a ceiling (each motif at most once per chapter, never in adjacent
slots, never as the subject of a frame unless the sentence is about it).

Five changes. No migration, no new model call.

1. **The bible** (`packages/providers/src/prompts/direction-craft.md`,
   re-embedded into `direction-craft.ts`; the byte-identity test of decision
   216 keeps the two equal).
   - "Shot grammar for a film made of stills" opens with a new rule, the
     sentence decides the frame: read `coversText` first and show what it
     names (the place, the object, the event, the document, the person doing
     what the sentence says they did). A viewer with the sound off should be
     able to guess the sentence from the frame. Only when a sentence names
     nothing photographable (an abstraction, a judgment, a number without a
     scene) does the planner reach for the book: the chapter's key image, a
     location, a motif.
   - The motif line becomes the floor and the ceiling above.
   - Under "What a still prompt must contain", the third physical fact
     becomes "one detail drawn from the sentence itself (the named object,
     document, place or time of day)". A motif may stand in for it at most
     once per chapter.
   - The pre-flight list gains "no motif appears more than once per chapter,
     and every frame shows what its sentence says".
   - The redirect fallback's examples no longer lead with "the empty chair".
2. **The shot-list prompt** (`shotlist.ts`, planning rules): the same rule in
   operational words, placed first in the planning rules because the first
   third of a prompt gets the most attention, with the ceiling in numbers:
   each motif at most once across the chapter, never in consecutive slots,
   never as the subject unless the sentence is about it; a still whose
   sentence gives a concrete subject needs no motif at all. The rebrief and
   redirect prompts embed the bible and inherit the rule.
3. **The book prompt** (`direction.ts`, rules for the book): how to choose
   motifs. They are this story's own, drawn from the claims (the product, the
   named building's lobby, a specific document type, a specific vehicle),
   able to sit in the background of a frame whose subject is something else.
   Never the house look's own furniture (empty chairs, screens, glass,
   corridors), which every film already has; a motif that could belong to any
   corporate collapse is chosen again.
4. **Chapter wording** in `renderDirectorsBook`: "Chapter 2: environment
   shots" becomes "Chapter 2: leans towards environment shots", so a dominant
   family is not read as the only family.
5. **A plan warning** in `planWarnings` (schemas), which the runner, the
   replanner and the plan screen already call. The function gains the book's
   motifs and chapter boundaries. For each motif it takes the head noun (the
   last word, a trailing "s" stripped, so "server racks" matches "rack" and
   "racks") and matches it as a whole word, case-insensitively, in still
   prompts and stock and archival descriptions and queries. It warns when a
   motif appears in more than one brief of a chapter ("motif 'server racks'
   appears in 7 of 11 briefs in chapter 3") or in two adjacent slots. A note
   on the plan screen, never a rejection: the match is a heuristic, and the
   house rule since decision 252 is that craft misses are notes for the owner.
   The head-noun rule is what keeps the mock book's "empty chairs" from firing
   on the mock stock brief's "empty desks".

**Existing projects.** The owner edits the motifs on the Direction card and
re-plans; new books get the guidance from their first draft.

## Design 2: reuse a shot (decision 261)

**Who decides.** The owner, on the board, in either phase. A model cannot see
across chapters at plan time and "sparingly, when it fits" is a taste
judgment. Model-proposed pairs are a possible later decision on the same
link.

**Mechanism.** A link column, copied on resolve (approach A). A live link
(every reader follows the column) was rejected because it touches five
readers and turns a re-planned source into a hole the gate must understand;
a copy with no column was rejected because before Fetch there is nothing to
copy, so the saving before Fetch, which is the stated reason, is lost.

### 1. Data

- Migration 0025: `shot_slots.reuse_of_slot_id text` nullable, references
  `shot_slots.id`, on delete set null.
- `SlotCandidateSchema` gains `reusedFrom?: { slotId: Ulid, depicts?:
  string[] }`, stamped on the copied candidate.
- `slotNeedsResolution` returns false for a linked slot, whatever its hash
  says: a linked slot never owes Fetch work.

### 2. Rules

- Only stock, still and archival slots may reuse or be reused. Charts, maps
  and headlines are data, not pictures; hero is feature-flagged off.
- A slot may not reuse itself. There are no chains: linking to a slot that is
  itself a dependant re-points to the original, so the chip always names the
  shot that was paid for.
- Same project only.
- Every rule is checked in the server action. Hidden buttons are for the
  screen; the guard is for stale screens.

### 3. Writes (`packages/db/src/visuals.ts`)

- `linkSlotReuse(db, slotId, sourceId, candidateId?)`: records the link. When
  the named source candidate exists, it is copied now: `candidates` becomes
  the one copy with `chosen: true`, `reusedFrom: { slotId: sourceId, depicts
  }` (the source brief's `depicts`, when a still), the source's `assetId`
  carried; `status: 'resolved'`; `chosenAssetId` the source's;
  `resolvedBriefHash` the hash of the TARGET's own brief. Before Fetch nothing
  exists to copy, so the link is recorded alone and the slot stays
  `unresolved` with no candidates.
- `copyReusedShots(db, projectId)`: for every linked slot, copies its
  source's chosen candidate as above; a source with no chosen candidate
  leaves its dependant `placeholder` with empty candidates. Idempotent: a
  dependant already holding a copy from the same source is left alone.
- `unlinkSlotReuse(db, slotId)`: clears the link, the candidates, the chosen
  asset and the hash, and sets `unresolved`, so Fetch owes the slot work
  again.
- `updateSlotBrief` keeps a linked slot's status: the words changed, the
  picture did not. Today it drops every slot to `unresolved`; it becomes a
  `CASE WHEN reuse_of_slot_id IS NULL THEN 'unresolved' ELSE status END`.

### 4. Runner

- `load-plan` already excludes linked slots because it filters on
  `slotNeedsResolution`; no still is generated for them, and the key check
  sees only real work.
- One new step, `copy-reused-shots`, calling `copyReusedShots`, between the
  failure-tolerance check and `enter-board-phase`. No new Inngest function,
  so the singleton registry is unchanged.
- Re-plan replaces the rows, and the links go with them.

### 5. Actions (`visuals-actions.ts`)

- `reuseSlotShotAction(projectId, slotId, sourceSlotId, candidateId?)` and
  `unlinkSlotReuseAction(projectId, slotId)`, owner-only, id-checked, with
  the rules of section 2. Success toasts are phase-aware: "Linked. Fetch
  visuals will copy the shot when it lands" in plan phase; "Now showing the
  shot from 3:10" on the board.
- `refetchSlotAction`, the rebrief and retype actions, `redirect` and the
  upload actions refuse on a linked slot: "This slot reuses the shot at
  3:10. Choose its own shot first."

### 6. Board (`visuals-review.ts`, `visual-board.tsx`)

- `SlotView` gains `reuse: { sourceSlotId, chapterIndex, startMs,
  sourceStatus } | null` and `reusedBy: number`.
- A new button on stock, still and archival cards, **Use an existing shot**,
  opens a panel under the card: the film's other eligible slots grouped by
  chapter, each row showing the covered sentence, "ch 2 · 3:10", the gap to
  this slot ("3 min 20 s earlier"), and one **Use this** button per candidate
  the app holds bytes for: the chosen one first, then the paid-for still
  variant nobody chose, then uploads. Before Fetch a row has no pictures and
  carries one button, **Use whatever this slot chooses**. On the board, a
  slot with no candidate the app holds is not offered at all: no copy step
  runs in board phase, so a link to it could never be filled. A gap under 60
  seconds shows a note, never a block. When the target already has fetched
  candidates the panel says they will be replaced.
- A linked card shows the copied picture with a chip **Reused from ch 2 ·
  3:10**, keeps Edit brief (which no longer re-fetches for it), hides
  Regenerate, Fetch this slot, Draft a different brief, Redirect and Upload,
  and offers **Choose its own shot**. A dependant whose source has no shot
  reads "reuses the shot at 3:10, which has none yet". A source card carries
  the line "also used at 7:42".
- The Fetch button's slot count and price already exclude linked slots
  through `needsFetch`.
- The panel is built from the model the board already loads; no new query.
  Candidates render with the card's own thumbnail component.

### 7. Spacing warning

The review model adds "the same shot plays at 3:10 and 3:40" to the plan and
board notes when two slots share a candidate (by `reusedFrom` or by
`assetId`) within 60 seconds. The picker's note is at link time; this one
persists.

### 8. Downstream, unchanged

- Assembly reads the copied candidate's storage key and asset id as it reads
  any other.
- Ingestion dedupes bytes by content hash, so a shared stock clip is stored
  once (the second download is accepted waste).
- `syntheticLikenesses` also reads a chosen candidate's `reusedFrom.depicts`
  when its provider is a generator, so a likeness reused into a stock slot
  still sets the altered-content label.
- Shorts and the teaser inherit through the master timeline.

### 9. Edge cases

- A source that ends as a placeholder makes its dependants placeholders; the
  card says why by reading its link.
- A source re-chosen later does not change a dependant already copied. That
  is how every other slot behaves, and the chip says where the picture came
  from. "Refresh from source" is out of scope.
- A source removed by re-plan leaves the dependant with a valid copy; the
  column is nulled and the chip reads from `reusedFrom`.

## Data and contract changes

- Migration 0025: `shot_slots.reuse_of_slot_id`.
- `SlotCandidateSchema.reusedFrom?`.
- `planWarnings(slots, bannedWords, motifs)` with per-slot chapter ids.
- `renderDirectorsBook` chapter line wording.
- `DIRECTION_CRAFT` re-embedded.
- Build spec sections 7.4 and 11.3 amended in place with dated notes;
  PROGRESS.md gets decisions 260 and 261.

## Testing

- `direction-craft.test.ts`: the sentence rule and the motif ceiling are
  present; the third physical fact no longer names a motif.
- `shotlist.test.ts` and `direction.test.ts` (providers): the new planning
  rule and the motif-choosing rule are in the requests.
- `direction.test.ts` (schemas): `planWarnings` warns on a motif in two
  briefs of one chapter and on adjacent slots, is silent on once per chapter
  and with no book, and "empty chairs" does not fire on "empty desks";
  `renderDirectorsBook` reads "leans towards".
- Schemas: `slotNeedsResolution` is false for a linked slot; `reusedFrom`
  parses and is optional.
- DB integration: link with and without a candidate, `copyReusedShots`
  copies and leaves placeholders, unlink re-opens the slot, a brief edit
  keeps a linked slot's status.
- Runner: linked slots skip the fan-out and receive the copy; a failed source
  yields a placeholder.
- Actions: chain re-point, type refusal, cross-project refusal, the refusals
  on a linked slot.
- Review model: `reuse`, `reusedBy`, and the spacing warning.
- Component: the picker's rows and buttons; the linked card's chip and hidden
  buttons.
- E2E, asserting on the card itself and never on board-wide counts: the
  board spec reuses the stock slot's chosen candidate into the placeholder
  slot and reads the chip; the plan spec links the still to the stock slot
  and the Fetch button drops from 2 slots to 1.

## Out of scope (deliberate)

- Model-proposed reuse pairs.
- "Refresh from source" on a dependant.
- A channel-wide shot library across projects.
- Enforcing the motif ceiling by dropping or rewriting slots: the match is a
  heuristic, so it stays a note.
