# Short shots and the stretch re-plan (design)

Date: 2026-10-26. Decisions continue PROGRESS.md from the next free number
at merge (316 was the last on master when this was written).

## 1. What the Theranos board showed

At 1:01 the board has a news headline card (CNBC, "Holmes ... persuaded
sophisticated investors to raise $945 million") that runs for 2 seconds,
followed at 1:03 by an 8 second stock shot of San Francisco skyscrapers.

The card's `coversText` is "Other tallies went higher. In 2021, CNBC
reported that Holmes persuaded investors to put up 945 million." The stock
shot's `coversText` is "In 2021, CNBC reported that Holmes persuaded
investors to put up 945 million." Both shots claim the CNBC sentence.
`anchoredTimes` (apps/web/inngest/lib/shot-list.ts) moves each shot to the
first word of its quote and holds it until the next shot's first word, so
the card owns only "Other tallies went higher" and the skyscrapers sit on
the line the card was made for.

The planner did not ask for a short shot. The prompt already says 4 to 15
seconds. It gave two shots the same sentence, and nothing checks for that:
the craft checks (`craftFindings`, packages/schemas/src/direction.ts) look at
briefs only, never at times. The only floors are silent clamps
(`MIN_SLOT_MS` 2 s at planning, `MIN_SHOT_MS` 1 s in the compiler).

The existing fix, "Re-plan shot list", only works on the plan screen and
replaces every shot in the film. This board was past plan approval, with
picks made and an article address set by hand.

The owner's words: "the 2s shot should be evaluated that we shouldn't have
shots too short when planning the shots. Or we can select the shots that
we'd like to almost re-plan. So it's localised replanning rather than full
shot replanning." The selection must be adjacent shots, and the re-plan
starts fresh.

## 2. Goals, non-goals, anti-goals

Goals:

- The planner stops producing shots that are too short to read, and stops
  giving one sentence to two shots.
- When a bad stretch still gets through, the owner fixes it in one action
  from the shots themselves, on the plan screen or the board, without
  touching anything outside the stretch.

Non-goals:

- Dragging shot boundaries by hand. The planner decides the new split.
- Merging two shots without the planner (keeping one shot's brief and
  stretching it). A stretch re-plan of two shots that comes back as one shot
  is the merge.
- Keeping work done on the old shots. The re-plan starts fresh.
- Re-planning after the visuals stage is approved (preview, render, shorts).

Anti-goals (would be a failure even if it works):

- A stretch re-plan changes, re-fetches or re-times any shot outside the
  selection.
- A re-plan recreates the problem it was asked to fix (a new short shot or
  a doubled sentence) without saying so.
- A failed or stopped re-plan leaves the stretch empty or half replaced.

## 3. Decisions

### 3.1 Two timing checks

Both run on anchored times, the same times the board shows and the render
cuts.

1. **Too short.** A shot is flagged when its anchored duration is under the
   minimum for its type:

   | Type (board label) | Minimum |
   |---|---|
   | `headline` (news headline), `social` (Post on X) | 5 s |
   | `chart`, `map` | 4 s |
   | `stock`, `archival` (real footage), `still` (AI image), `graphic` | 3 s |

   A shot that is short only because its paragraph is short (the whole
   paragraph is under the minimum and the shot is its only shot) is not
   flagged: there is nothing to fix.

2. **Same sentence twice.** Two shots are flagged when their `coversText`
   quotes overlap in the narration: some word is inside both quotes. Both
   shots carry the note.

The messages read like the existing craft notes, for example "this news
headline is on screen for 2 s; it needs at least 5 s" and "this shot
quotes 'In 2021, CNBC reported...' which the next shot also covers".

The planning prompt gains the minimums and the rule that every sentence is
quoted by exactly one shot. The 4 to 15 second rule stays.

**Timing notes are their own list, not craft notes** (builder's call, see
section 7). The Fix button and its count are built from `craftFindings`,
and Fix only rewrites briefs; `parseShotRepair` refuses an answer that
changes `coversText`, so Fix could never clear a timing note. Timing notes
therefore get their own count on the plan card and the gate summary ("2
timing notes"), Fix ignores them, and each timing note carries a "Re-plan
this stretch" button that selects the shots 3.2 would pick and opens the
re-plan bar (3.3) with them selected.

### 3.2 Automatic repair at planning

When a freshly planned chapter has a timing finding, the planner gets one
automatic repair attempt, the same budget of attempts the brief repair has
(decision 271). The existing brief repair cannot do it: `parseShotRepair`
refuses an answer that changes `coversText`, and fixing timing means moving
sentences between shots. So the timing repair is a stretch re-plan (3.3)
run automatically over the flagged shot and the neighbour it collides with,
with a system note naming the finding. Whatever is still flagged afterwards
stays flagged and shows as a note. A failed repair keeps the plan as
planned, as the brief repair does.

Which shots each finding re-plans (builder's call, see section 7):

- Same sentence twice: the two shots whose quotes overlap.
- Too short: the flagged shot and the next shot in the same paragraph; when
  it is the paragraph's last shot, the shot before it.
- Findings whose shot runs touch or overlap are merged into one stretch,
  still inside one chapter. Each resulting stretch is re-planned once, in
  one pass after the chapter is planned. "One attempt" means one pass per
  chapter, never a loop: whatever the pass leaves flagged stays flagged.

### 3.3 The stretch re-plan

**Where.** On the plan screen and on the board, for as long as the visuals
stage is open (`visualsPhase` is `plan` or `board`).

**Selecting.** Every shot card gets a visible "Select" toggle (button
first, spec 11.1). Selected cards are highlighted. A selection is valid
when it is one or more shots, adjacent, inside one chapter. The board
refuses anything else in words ("Re-plan works on neighbouring shots in
one chapter"). While a selection exists, a bar shows "Re-plan these N
shots", an optional note box ("What should change?", placeholder like
"keep the headline card up through the CNBC line") and Clear selection.

**What the planner gets.** The stretch is the narration from the first
word of the first selected shot's quote to the word before the next
unselected shot's first word (or the end of the chapter). The planner gets:

- the stretch text, with its paragraph boundaries and measured seconds;
- the briefs of the shot just before and just after the stretch, read only,
  so the new shots fit their neighbours;
- the same context as chapter planning: Director's Book, claims in prompt
  order, photographed cast, sets, logos, direction craft;
- the timing minimums and the one-sentence-one-shot rule;
- the owner's note, if any.

It returns slots in the existing planned-slot shape. It decides how many
and which types.

**What the answer must satisfy** (builder's call on the reading, see
section 7). Every `coversText` lies inside the stretch; the first new quote
starts at the stretch's first word; the quotes run in narration order and
no two overlap. Time between quotes is covered by anchoring, as in chapter
planning, so the quotes need not cover every word. The check runs after
`plannedToRows`, on the slots that survive conversion: a slot dropped there
(headline cap, a chart or headline citing a claim it may not) counts as a
broken answer, because a missing first slot would let the shot before the
stretch hold on into it. A broken answer is asked once more with the reason
(the ladder of decision 292), then the re-plan stops. Charts follow the
existing claim rules.
Craft findings get the automatic brief repair, and every graphic gets its
own designer call, as in chapter planning.

**Writing it.** In one transaction: delete the old shots of the stretch,
insert the new ones with times from `plannedToRows` and anchoring, and
renumber `index` in the chapter so the unique key holds. Nothing outside the
stretch changes. A shot elsewhere that borrows from a deleted shot ("Use an
existing shot", `reuseOfSlotId`) loses the link through the foreign key;
before sending, the confirm line names those shots ("The shot at 2:30 uses
this shot's image and will lose it").

**After writing.** New shots behave like shots of a fresh plan in that
phase. On the plan screen they wait for plan approval like every other
shot. On the board each new shot is fetched straight away through the same
resolution path as Regenerate (`resolveSlotBrief`).

**Busy state and failure.** The action stamps a job on every selected shot
before sending the event (decision 286), so the cards say "Re-planning" and
their buttons are off. A stretch overlapping a shot with a job in flight is
refused. So is any stretch re-plan while the stage is running (the fetch
after plan approval is still phase `plan`) or while a project-level
Re-plan shot list, Redraft or Fix is in flight; those project-level buttons
are in turn refused while a stretch re-plan runs. Two re-plans of separate stretches may run at once, so this cannot
share the visuals-replanner's per-project singleton (which cancels the
duplicate); it gets its own key or its own function. Budget gate, stop or
failure: the old shots stay exactly as they were and the failure shows as
words on the board (decision 234 pattern).

**Cost.** One planner call for the stretch, plus a designer call per new
graphic and the fetches on the board. No confirm step for cost; the button
shows an estimate the way "Re-plan shot list" does.

### 3.4 Timing notes on the board

Craft notes show only on the plan screen today (`planning && notes.length`
in `SlotCard`). The two timing notes also show on board cards, next to the
Select toggle, because the board is where the times are visible and where
the owner will spot most of these.

## 4. Left to the builder

- Whether the stretch re-plan is a new op on visuals-replanner or its own
  function, and the event shape, provided 3.3's concurrency rule holds.
- How overlap in 3.1 is computed from the word timings (anchoring already
  locates each quote's first word; it may need the last word too).
- The exact prompt wording, the estimate figure and the mock-provider
  answer for the new request.
- Whether the automatic timing repair (3.2) runs inside `planChapterWith`
  or as a follow-up step, as long as the live harness and the app plan
  under the same rules.

## 5. Mock providers

`mockShotList` gives every shot on a paragraph the same `coversText` (the
paragraph's first 120 characters), so under 3.1 every mock plan would be
flagged and set off 3.2 on every chapter. The mock is rewritten so each
shot quotes its own sentence and no shot falls under its minimum, with the
seed fixtures given enough sentences per paragraph that the chart, map,
headline and graphic shots the e2e suite relies on still appear. The checks
are not exempted in mock mode. A separate mock answer for the stretch
request covers the stretch in two shots, so the e2e test sees a change.

## 6. Out of scope

- Re-planning a stretch that crosses chapters.
- Manual boundary moves and planner-free merges.
- Any change once visuals are approved.

## 7. Calls made without the owner

Settled while writing this, after a builder's read of the draft. The owner
can overturn any of them before planning starts.

1. Timing notes are their own list; Fix ignores them; each note has a
   "Re-plan this stretch" button (3.1).
2. Which shots the automatic repair re-plans, merging of touching
   findings, and one pass per chapter (3.2).
3. The loose coverage rule, and a slot dropped in conversion counts as a
   broken answer (3.3).
4. Stretch re-plans are refused during the stage run and alongside
   project-level re-plan jobs, and the reverse (3.3).
5. The mock is rewritten rather than the checks skipped in mock mode (5).
6. A selection may be a single shot; the owner said adjacent shots, and
   one shot is the smallest adjacent run (3.3).
7. Stretches stay inside one chapter (3.3).

## 8. Tests

- Unit: both timing findings on anchored times, including the
  one-shot-short-paragraph exemption and the Theranos pair from section 1
  as a fixture.
- Unit: stretch boundaries from a selection; answer validation (outside the
  stretch, gaps, overlaps); index renumbering.
- Function: a stretch re-plan replaces only the selected rows; a budget
  stop and a refused answer leave them unchanged; two stretches in one
  chapter run without cancelling each other.
- Component: selection rules (adjacent, one chapter), the bar and note box,
  the busy cards, timing notes on board cards.
- e2e (mock providers): select two shots on the board, re-plan, see one or
  more new shots in their place and the neighbours unchanged.
