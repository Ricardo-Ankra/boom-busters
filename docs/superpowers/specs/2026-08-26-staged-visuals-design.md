# Staged visuals: an editable plan before any asset is fetched

Approved by the owner, 2026-08-26. Extends build-spec section 7.4's
visuals-runner and section 11.3's visual board; the five pipeline gates are
untouched.

## Problem

The visuals-runner generates the shot list and immediately fetches and
generates every asset. The owner cannot review or steer the plan before money
and time are spent, and a slot's type is frozen at generation: a brief
suggested as `still` cannot become `stock` or `map`, because briefs are a
discriminated union and the edit action only patches creative fields.

## Design

### 1. Two parks inside the one visuals stage

The runner stops after the shot plan is written. Nothing is fetched, nothing
is spent.

```
voice approved
  -> shot-list generation (per chapter, as today)
  -> save board, visuals_phase := 'plan'
  -> PARK: plan review          (gate summary "Shot plan ready ...")
  -> on visuals/plan.approved: re-read slots, pre-flight keys,
     resolve slots (fan-out, as today, with the skip guard below),
     visuals_phase := 'board'
  -> PARK: board review         (today's gate 4, unchanged)
  -> on gate/visuals.approved: close, stage := assembly
```

The plan park times out like the gate (30 days) and fails the stage with the
same wording. `visuals_phase` on the projects row (`plan` | `board`, null
before the stage) tells the screen and the actions which checkpoint the
project is at; it is explicit state, not a heuristic over slot statuses,
because a per-slot pre-fetch during plan review must not flip the screen.

### 2. Change-aware fetching (the no-waste guard)

Every resolution stores `resolved_brief_hash` = sha256 of the brief JSON it
resolved. Any resolution pass (the runner's fan-out, and re-runs of it) skips
a slot whose status is `resolved` and whose stored hash equals the current
brief's hash. Consequences:

- "Fetch visuals" after a per-slot pre-fetch does not re-buy that slot.
- A stage re-run after a mid-fetch failure only touches what is missing or
  changed. (A full stage restart still regenerates the plan wholesale, as
  today - that is a different button with a different meaning.)
- Editing a brief clears nothing; the changed hash alone makes the next
  fetch pick the slot up.

Per-slot "Fetch this slot" is available in both phases and reuses the
existing `visuals/refetch.requested` -> slot-refetcher path.

### 3. Re-typing a slot, any direction

Every slot card gets a format picker (stock, archival, still, chart, map;
hero stays behind its flag). Conversion happens in a new `slot-retyper`
Inngest function on `visuals/retype.requested {slotId, targetType}`:

- **Mechanical** (stock/archival/still, any direction): the new brief derives
  from the shared fields - `query`/`prompt`/`mustShow` seeded from
  `description`, `rejectionCriteria` empty, still prompts get the brand style
  anchors appended. A pure `convertBrief` function in `packages/schemas`,
  unit-tested.
- **Model-assisted** (to chart or map): one small LLM call drafts the
  structured parts - chart series with the mandatory claim `dataRefs`
  (schema still refuses a chart citing nothing), map locations with
  coordinates. Schema-validated; a result that does not parse fails the
  retype with a message, and the slot keeps its old brief.

After conversion the slot's `type` column and brief update together,
candidates clear, status returns to `unresolved`. In `board` phase the
retyper immediately resolves the new brief (one fetch); in `plan` phase it
stops there.

Brief edits become phase-aware: in `plan` phase an edit just saves (no
fetch); in `board` phase it saves and refetches, as today.

### 4. The plan screen

The visual board renders by phase. Plan phase: slots grouped by chapter,
each card showing covered sentences, description, type picker, the type's
editable fields, timing, and a "Fetch this slot" button. The primary action
is one button carrying its price: "Fetch visuals - N slots - est. $X",
where X counts only slots the guard will actually fetch (generated stills
are the paid kind). It sends `visuals/plan.approved`. The generic
GateActionBar is suppressed during plan phase so there are never two
approve buttons meaning different things. Board phase: today's screen plus
the type picker on each card.

## Data and contract changes

- `projects.visuals_phase` text nullable (`plan`/`board`), reset by stage
  restart.
- `shot_slots.resolved_brief_hash` text nullable.
- Events: `visuals/plan.approved {projectId}`,
  `visuals/retype.requested {projectId, slotId, targetType}`.
- New Inngest function `slot-retyper`; `visuals-runner` gains the plan park;
  `demo-pipeline` sends the plan approval like it sends gate approvals.

## Testing

- Unit: `convertBrief` conversions; retype prompt parse + mock; brief hash.
- Integration: runner parks at plan; resolution skip guard (resolved +
  matching hash is not re-fetched; changed hash is); retyper mechanical and
  model paths; phase transitions.
- Component: plan-phase board (picker, editable fields, estimate button),
  board-phase unchanged plus picker.
- E2E: the pipeline flow gains the "Fetch visuals" click; the seeded
  board-phase project keeps existing specs green (`visuals_phase` seeded as
  `board`); one plan-phase spec covering edit -> retype -> fetch.

## Out of scope (deliberate)

Add/delete slots on the plan (not requested); hero re-typing while the flag
is off; converting a chart's numbers by hand (edits to drafted series happen
through the existing brief editor).
