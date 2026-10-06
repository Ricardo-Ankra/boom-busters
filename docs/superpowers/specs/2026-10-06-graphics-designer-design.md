# Graphics with a designer of their own (decision 289, stage 1 of 2)

Status: design approved in conversation 2026-10-06, section by section; this
document is for the owner's review before an implementation plan is written.

## 1. The problem

The owner, 2026-10-01: "in terms of generating and coding the motion graphics
and essentially creating what is seen, I want that to be routed and handled by
a specific model. Same way we have a routing for stills. because it is an
important element and I feel we are not getting the best out of it yet."
Asked on 2026-10-06 what disappoints in a graphic today, the owner answered
all three: the content (which figures, what it says), the layout (templated,
weak hierarchy) and the motion (static, samey).

### 1.1 How graphics are made today

- The shot list writes every graphic in the same call that plans every other
  slot of the chapter (`packages/providers/src/prompts/shotlist.ts`, task
  `shotlist`, Haiku 4.5 by default). The graphic rules are about 1,900
  characters (the shape block at L219 to 232 and the rule bullet at L356 to
  364) inside a 783-line prompt, and the scene shares the chapter's output
  budget with every other slot.
- The scene vocabulary (`packages/schemas/src/graphics.ts`): up to six
  elements (`text`, `figure`, `logo`, `shape`, `bars`) on a 12 by 12 grid, the
  brand's colour token names and type roles, one entrance each (`fade`,
  `rise`, `wipe`, `count`) at an offset `atMs`, and an optional emphasis
  (`pulse`, `underline`).
- The motion is fixed in code (`packages/compositions/src/lib/graphic.ts`):
  every entrance eases over 600 ms with the same smoothstep, unauthored
  entrances stagger 180 ms apart, the card drifts to a 1.2% zoom across the
  slot, and nothing ever leaves the frame.
- The board's preview (`slot-previews.tsx`, `GraphicPreview`) is an SVG of the
  resting frame. Motion is seen only on the Preview screen or in a render.
- "Draft a different brief" on a graphic reuses the retype prompt
  (`prompts/retype.ts`), which carries a second copy of the graphic rules.
- The schema says the layout clamps `atMs` inside the slot; no code does.

### 1.2 The decision

Level 2 of the three offered (its own model, plus richer motion), delivered
in two stages, each deployed: stage 1 (this document) gives graphics their
own step, route, prompt and an in-board player; stage 2 (its own short spec,
written after the owner has watched stage 1's graphics) adds the motion
vocabulary. Level 3 (the model writes Remotion code) is left for later.

Owner's rulings in the conversation:

- The graphics step owns everything inside a graphic (which cited figures and
  words appear, the layout, the motion) but not whether a beat is a graphic:
  the shot list still decides that, and the board's retype is the fix for a
  wrong form.
- The board plays the real composition with the Remotion Player rather than
  an animated SVG, so motion is built once and shown by one renderer.
- One call per graphic slot (not a polish pass over the shot list's draft,
  not one call per chapter), on a new route, "Motion graphics" in Settings → Models
  (task key `graphics`), defaulting to Opus 5.5.

## 2. Shape and flow

### 2.1 What the shot list writes

A planned graphic carries the common brief fields (`coversText`,
`description`, `motion`, `transition`, `shotSize`) plus:

- `intent`: one or two sentences on what the graphic must get across ("Nvidia's
  2024 revenue dwarfs Intel's; the gap is the story"), 1 to 300 characters.
- `intentRefs`: the claim numbers the beat rests on, 0 to 6 of them.

It writes no scene. An `intentRefs` number outside the claim list drops the
slot with its reason, as a chart's out-of-range `dataRefs` do today
(`plannedBriefRejection`). The graphic shape block and rule bullet leave the
shot-list prompt; one short bullet replaces them, saying when a beat is a
graphic and that the intent says what to show, not how.

### 2.2 What is stored

`GraphicBriefSchema` gains `intent?: string` and `intentClaimIds?: Ulid[]`
(the stored form of `intentRefs`), and `scene` becomes optional:

- A designed graphic has a scene (and, from now on, an intent).
- A graphic the step could not design has an intent and no scene, plus
  `designIssue: string` naming why.
- A graphic stored before this ships has a scene and no intent, and parses
  and renders unchanged. Where an intent is needed (Redesign graphic), its
  `description` stands in, and the claims its scene cites stand in for
  `intentClaimIds`.

A graphic with no scene resolves to a placeholder (`visual-assets.ts`, the
graphic branch), so Fetch, the plan gate and assembly treat it as any other
unfinished slot. The timeline and broker never see a sceneless graphic:
assembly already skips a placeholder.

### 2.3 The graphics step

Inside `visuals-runner`, after `shot-list-${index}` returns a chapter's rows
and before the next chapter is planned, each graphic row gets its own step,
`graphic-${index}-${n}`. One step per graphic, so an Inngest retry repeats one
graphic, never the chapter. The step:

1. Builds the request (section 3) and calls the `graphics` route through
   `callLlm`, so the cost guard, the ledger and the provider fallback apply.
2. Parses the answer as a `PlannedGraphicScene` and checks it (2.4).
3. On a parse failure or a failed check, asks once more with the reason
   appended. A reply cut off for length is retried once at double the output
   budget, the rule `plan-chapter.ts` already applies.
4. Returns the row with its resolved scene, or with no scene and its
   `designIssue`.

A `BudgetExceededError` is returned as a gate, as the shot-list step does, and
the run stops on `markStageFailed` with the over-budget message. Nothing new
is read outside a step (decision 279): the step loads what it needs from the
setup it is handed, and a run parked before the deploy, which resumes at the
fetch, never reaches it.

The plan's summary line counts undesigned graphics: "· 2 graphics not
designed".

### 2.4 The checks

The existing ones, unchanged, through `resolvePlannedBrief`'s graphic branch:
claim numbers in range, every figure's and bar's digits present in the cited
claim, one logo per entity, logos matched against the library (a missing mark
is a placeholder asking for an upload, not a rejection).

One new check, the clamp the schema promises: an entrance must start no later
than the slot's length minus the entrance's duration (600 ms in stage 1); the
portrait reflow moves cells, not times, so one reading covers both. The step tells the model the slot's
length, and a late entrance is a rejection with a reason, so the retry can
fix it. This lives in the app's checks, not the render, so stage 1 needs no
Remotion upload.

The model sees the film's whole numbered claim list with the intent's claims
marked, so it may cite a better claim than the shot list named; whatever it
cites is checked the same way.

## 3. The graphics call

### 3.1 The route

`graphics` joins `LLM_TASKS` (`packages/schemas/src/settings.ts`), with a key
in `ModelRoutingSchema`, a default of `{ provider: 'anthropic', model:
'claude-opus-5-5' }` in `DEFAULT_SETTINGS`, and the label "Motion graphics" in
the Models tab's `TASK_LABELS`. `normaliseSettings` fills the default into
stored settings that lack it. The row gets live model lists and prices like
every other (decision 288). On Gemini it is not a light-thinking task.

### 3.2 The prompt

A new `packages/providers/src/prompts/graphics.ts`, `buildGraphicRequest`.

The cacheable prefix, the same for every graphic of a film:

- Design rules written for graphics alone: one idea per graphic, one dominant
  element and a clear reading order, room to breathe, the bottom two rows
  clear for captions, colour for meaning (collapse, recovery, highlight) not
  decoration, when a figure should count, when a logo earns its place, when
  two figures read better as bars, timing entrances to the words that name
  them.
- The vocabulary: every element kind, field by field, with what it is for, and
  three worked example scenes (a single hero figure, a comparison, a
  relationship between named marks).
- The brand's colour token names and type roles.
- The film's numbered claim list.
- The titles in the logo library.

The per-slot part:

- The chapter's title.
- The narration the slot covers, with the sentence before and after.
- The slot's length in seconds.
- The words spoken within the slot with their offsets from the slot's start,
  from the take's word timings (`voice_takes.timings`); where a take has none,
  offsets estimated from the slot's length.
- The intent and its claim numbers.
- For a redesign: the current scene, and the owner's steer when one was given.

The answer is the scene as JSON, nothing else. The call has room to reason
before answering (the provider's thinking, where the model supports it).

### 3.3 Mock mode

`mockGraphicScene` builds a deterministic scene from the cited claims' digits,
as the mock shot list's graphic does today (`shotlist.ts` L681 to 740, which
moves here). Tests and e2e run in mock-provider mode without spending.

## 4. The board

The graphic card keeps its resting-frame thumbnail, claim chips, Add logo and
Edit brief, and gains:

- An intent line under the thumbnail, "Intent: ...", with its claim chips.
  Edit brief can change the intent; Redesign graphic then designs from it.
- A Play button that swaps the thumbnail for the Remotion Player running the
  real `GraphicCard` at the slot's length. Play, Pause and Replay are labelled
  buttons (spec section 11.1). A Portrait button plays the 9:16 reflow that
  Shorts use. The player is loaded on the first press (a dynamic import), and
  one graphic plays at a time: Play on another card stops the first. Logos
  come from the same URLs the board already shows them with.
- Redesign graphic, in place of "Draft a different brief" on graphic cards: the
  same small form with an optional "What should change?" box. It sends the
  existing `visuals/rebrief.requested` event, and `slot-rebriefer` routes a
  graphic to the graphics call (with the current scene and the steer) instead
  of the retype prompt. The card shows "Redesigning..." through the existing
  retype state; a refusal or failed check says why and leaves the previous
  scene in place.
- A graphic with no scene shows "Not designed: <reason>" with Redesign graphic
  beside it.
- Retyping a slot to Graphic (`slot-retyper`) asks the retype prompt for an
  intent, then runs the graphics call, so a retyped graphic is designed the
  same way. The second copy of the graphic rules leaves `prompts/retype.ts`.

The board's thumbnail and the player can disagree only on the resting frame,
which is the existing two-renderer gap (the SVG preview and the HTML render
share one layout module); motion is shown by the render's own component.
The player ships with the Vercel deploy while video renders use the uploaded
Remotion bundle, so a composition change must ship with `deploy:remotion`
for the two to match. Stage 1 changes no composition.

## 5. Stage 2 in outline

Its own short spec, after the owner has watched stage 1's graphics. Planned
scope, all as optional scene fields so a stage 1 scene plays exactly as it
does today:

- Exits: an element leaves at a set time (fade, drop, wipe out).
- Easing and duration per entrance: smooth, snap or a slight overshoot, about
  0.2 to 1.5 seconds instead of the fixed 0.6.
- Staged builds: a graphic tells its beat in steps, elements making way for
  the next.
- Camera: a push in on one element, or a move from one region to another, in
  place of the fixed drift.
- Keyframed emphasis: a pulse, underline or colour shift at a set time.

Built once, in `packages/compositions` (the layout module and `GraphicCard`);
the board's player shows it with no second implementation. It ships with
`deploy:remotion` and `deploy:stacks boom-busters-broker`, since the broker
bundles the timeline schema (decision 282).

## 6. Tests

Landing with the code they test (spec section 13):

- Schemas: an intent-only graphic brief parses; a stored scene with no intent
  still parses; `designIssue` only without a scene; the late-entrance rule; the `graphics` route has a default.
- Shot-list prompt: asks for `intent` and `intentRefs`, carries no graphic
  vocabulary; its parser maps `intentRefs` to claim ids.
- Graphics prompt: the prefix is identical across two slots of one film; the
  per-slot part holds the word offsets, the slot length, the intent's claims,
  and on a redesign the current scene and the steer; estimated offsets when a
  take has no timings.
- The step: one step per graphic; a failed check retried once with its reason;
  a second failure stored as "not designed" with the reason; a cut-off reply
  retried at double budget; over budget stops the run; the summary counts
  undesigned graphics.
- Redesign and retype reach the graphics call; a failed redesign keeps the old
  scene.
- Settings: the Models tab shows the Motion graphics row; a stored settings
  row without the key gets the default.
- Board: the intent line; Play loads the player; Portrait; one plays at a
  time; the Redesign form; "Not designed".
- e2e (mock providers): plan a film, see a designed graphic, play it, redesign
  it with a steer.

The full suite runs before the merge, not only the packages touched: the
graphic brief is read by the schemas, providers, timeline, web and db suites.

## 7. Rollout

A push to `master` (Vercel deploys itself), then `PUT /api/inngest`. No
migration (briefs are JSON), no `deploy:remotion`, no broker redeploy: no
composition or timeline schema changes in stage 1. Saved settings pick up the
Motion graphics route's default on read. PROGRESS records decision 289; the number is
checked against `origin/master` at the merge.

To see it: open a project's visual board, press Redesign graphic on a few
graphics and play them; or re-plan a film to see the shot list and the
graphics step together.

## 8. Out of scope

- The graphics step turning a beat down or retyping it (owner's ruling, 1.2).
- Any change to the render, the timeline schema or the broker (stage 2).
- Level 3: model-written Remotion code.
- Consistency checks across a chapter's graphics beyond the shared rules.
