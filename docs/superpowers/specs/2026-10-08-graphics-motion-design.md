# Graphics that move with the narration (decision 290, stage 2 of 289)

Status: design approved in conversation 2026-10-08, section by section; this
document is for the owner's review before an implementation plan is written.

## 1. The problem

Decision 289 gave graphics a designer of their own (stage 1) and left the
motion vocabulary for a second stage, to be specified once the owner had
watched stage 1's graphics (stage 1 spec, section 5). Asked on 2026-10-08
what watching them showed, the owner named one thing: dead air in long slots.

### 1.1 What the live runs show

The live loop's runs on the Stability AI film (`live-graphic-runs/`, five
graphics, slots of 6.9 s, 12.1 s, 22.3 s, 12.2 s and 10.8 s) show it plainly.
In the 22.3 s slot ("That bet only got bolder. By spring of 2023, reports
surfaced that Stability AI was back in the market, this time seeking a
valuation as high as 4 billion dollars. Four times the number from six
months earlier.") the title fades in at 2.3 s, the bars wipe in at 10.9 s,
and then nothing moves for 11 s while the narrator says "Four times the
number from six months earlier." Both bars grow at the same instant, though
the narration names $1bn and $4bn seconds apart.

Stage 1's vocabulary can only add things: every element enters once and
stays, both bars of a `bars` element grow together, an emphasis fires just
after its entrance, and the only camera is a fixed 1.2% drift across the
slot (`graphicDrift`). Once the last element has entered, a long graphic has
nothing left to do.

### 1.2 The decision

Owner's rulings in the conversation, 2026-10-08:

- Stage 2 carries staged builds (with exits, since a step must make way for
  the next, and bars that grow one item at a time), camera moves and timed
  emphasis. Easing and duration per entrance, in the stage 1 outline, are
  left out: they do least for dead air.
- At most six elements on screen at any moment (today's ceiling), and up to
  ten across the slot.
- When bars arrive one at a time, the scale rescales as each arrives: the
  first bar fills the width alone and shrinks as a larger one grows in.
- The timing lives on each element (stage 1's `enter` already does), plus a
  camera track on the scene. Not a list of explicit steps, and not one cue
  list separate from the elements.
- The board's thumbnail shows the final frame, with one small frame per step
  beneath it when the graphic has steps.

What did not change from stage 1: the shot list still decides that a beat is
a graphic and writes its intent; the designer (the `graphics` route) owns
everything inside it; motion is built once in `packages/compositions` and the
board's player shows it with no second implementation; nothing in this stage
is edited by hand. Redesign graphic with a steer stays the way to change one.

## 2. The vocabulary

Every new field is optional. A scene stored under stage 1 parses and plays
exactly as it does today, frame for frame.

All times are milliseconds from the slot's start, as `enter.atMs` is.

### 2.1 On any element

- `exit?: { kind: 'fade' | 'drop' | 'wipe', atMs }`. Every exit takes a fixed
  500 ms (`GRAPHIC_EXIT_MS`). `drop` falls and fades, the reverse of `rise`;
  `wipe` clips the element away from left to right.
- `emphasis` keeps its stage 1 word form, `'pulse' | 'underline'`, which
  still fires just after the entrance (the pulse 600 ms after it starts, the
  underline's sweep 500 ms after). It also takes a timed form,
  `{ kind: 'pulse' | 'underline' | 'color', atMs, to? }`:
  - `pulse` (360 ms) and `underline` (a 600 ms sweep) as today, at `atMs`.
  - `color` shifts the element to the colour token named in `to` over
    400 ms (`GRAPHIC_COLOR_SHIFT_MS`) and keeps it. `to` is required on
    `color` and refused on the others. It applies to text, figures, shapes
    and the lit bars of a `bars` element, and is refused on a logo: logos are
    never recoloured.
  - The timed `underline` is refused on anything but text and a figure, the
    only elements that draw it. The word form is not newly restricted, so
    no stored scene starts failing.
  - One emphasis per element.

### 2.2 On a bar item

- `atMs?`: when this bar grows in, with its label and its value. An item
  without one grows with its element's entrance, as every item does today.
  Each bar grows over 700 ms (`GRAPHIC_BAR_GROW_MS`, moved into the schemas
  from `GraphicCard`'s `BAR_GROW_MS` so the checks can read it).

### 2.3 On the scene

- `camera?`: up to four keys, `{ atMs, focus: <element id> | 'all', zoom }`,
  zoom 1 to 1.6. Before the first key the camera frames the whole
  composition at zoom 1. Each key starts a 1.5 s eased move
  (`GRAPHIC_CAMERA_MOVE_MS`) from wherever the camera is to its framing, and
  the camera holds there until the next key. `'all'` frames the whole
  composition, centred on the safe area. Zoom 1 with an element in focus is
  a hold, since the camera cannot pan at zoom 1 (section 4.3).
- The stage 1 drift keeps running underneath the camera, so the frame is
  never dead still. A scene with no camera drifts exactly as it does today.

### 2.4 Limits

- Up to ten elements in a scene (`MAX_GRAPHIC_ELEMENTS` goes from 6 to 10).
- No more than six on screen at any moment (`GRAPHIC_MAX_ON_SCREEN`).
- An element is on screen from the start of its entrance to the start of its
  exit (or the slot's end), using the start times the card itself uses
  (`graphicEnterTimes`). Counting to the exit's start, not its end, lets one
  element take another's place in a cross-fade.

## 3. The checks

One function in `packages/schemas/src/graphics.ts`, `sceneTimingIssue(scene,
durationMs)`, replaces `lateEntranceIssue` and returns the first rule broken,
worded for the designer's retry as stage 1's refusals are. `sceneIssue`
(`apps/web/lib/graphic-design-core.ts`) calls it where it calls
`lateEntranceIssue` today.

1. An entrance starts by the slot's length less 600 ms (unchanged).
2. An exit starts once its element's entrance and any emphasis have
   finished, and ends by the slot's end.
3. A timed emphasis falls while its element is fully on screen: it starts
   after the entrance has finished and ends before the exit starts (or by
   the slot's end).
4. A bar item grows at or after its element's entrance and has finished
   growing before its element's exit starts (or by the slot's end). At least
   one item grows at the entrance itself (no `atMs`, or the entrance's own
   time), so a bars element never enters empty.
5. Camera keys run in time order, at least 1.5 s apart, and each move ends by
   the slot's end. An element in focus has entered by the key's time and
   stays on screen for as long as the camera rests on it: until the next key
   starts, or the slot's end.
6. No moment shows more than six elements.
7. The final frame is never empty: at least one element that is not a shape
   has no exit.

Rule 6 needs no slot length, so it also lives in the schema's `sceneRules`,
where the timeline and the broker enforce it, with two more rules that need
none: a camera key's focus names an element of the scene, and the timed
emphasis rules of section 2.1.

## 4. Layout and render

Built once, in `packages/compositions/src/lib/graphic.ts` (pure,
unit-tested) and `GraphicCard.tsx`. The board's player runs the same card.

### 4.1 Overlaps in 16:9

`separateOverlaps` becomes time-aware: two elements that are not shapes
collide only when their on-screen intervals (section 2.4) overlap. A step 2
figure can then take a step 1 figure's cell instead of being pushed down
the grid. In a stage 1 scene every element stays to the end, every pair
overlaps in time, and the result is identical to today.

### 4.2 The portrait reflow in 9:16

Today every flowing element (one with no `portraitCell`) reserves a band of
rows of its own; with ten elements across a slot that would shrink every one
of them. Instead, elements that are never on screen together share a band:
flowing elements are taken in reading order, and each joins the first band
none of whose occupants it ever meets on screen, or opens a new band below
the last. A band's height is the largest its occupants want, under the same
one-row-per-band reservation that keeps the stack on the grid, and the stack
is centred as today when nothing is pinned. In a stage 1 scene no two
elements can share a band, so the stack is unchanged. An element with its
own `portraitCell` keeps it.

### 4.3 The camera

`graphicCamera(scene, boxes, frame, timeMs)` returns a scale and a
translation for the wrapper that today carries the drift; the drift's scale
is applied inside it. The element in focus is found by id among the laid-out
boxes, so one camera track works in both orientations.

- The zoom is capped so the element in focus still fits inside the safe
  area at that zoom, so a push in never puts it under the captions.
- The pan aims the element's centre at the safe area's centre and is capped
  so the composition's edges never come inside the frame: the camera
  reframes what is there and never shows past it.
- A move eases (the same smoothstep as everything else) from the camera's
  framing when the key starts to the key's framing.

### 4.4 Exits

`fade` lowers the opacity to 0; `drop` moves 24 px down (scaled with the
frame) while it fades; `wipe` clips from the left edge to the right. An exit
composes with whatever the entrance left (the entrance has finished by rule
2). An element whose exit has finished is not drawn.

### 4.5 Bars

Each item grows over 700 ms from its own time, and its label and value fade
in with it. Rows keep their positions from the element's entrance, so a
later item's row is empty until it arrives. The scale (the value a full-length
bar stands for) eases from the largest value already on screen to the new
largest over those same 700 ms, so when $4bn grows in, $1bn shrinks from
full length to a quarter, and the largest bar on screen always ends at full
length. When every item arrives with the entrance the scale never moves, and
bars draw exactly as they do now.

### 4.6 Emphasis

Timed `pulse` and `underline` draw as the word forms do, at their own time.
`color` blends between the two `#rrggbb` tokens over 400 ms with a small pure
function (`mixColor`) and holds the new colour; on a `bars` element it
recolours the lit bars. An underline bar stays in the accent colour.

## 5. The designer

### 5.1 The prompt

`packages/providers/src/prompts/graphics.ts`:

- The vocabulary block gains `exit`, the timed `emphasis`, a bar item's
  `atMs` and the scene's `camera`, field by field, with the limits.
- New design rules:
  - A graphic on screen for more than about 8 s changes with the narration:
    each time the words bring something new, something enters, leaves,
    grows, shifts colour or the camera moves.
  - A step makes way for the next rather than piling up; six on screen is a
    ceiling.
  - The camera pushes in on what is being said, never at random, and rests
    on an element only while it is on screen.
  - The stage 1 restraint rules hold for motion too: every move earns its
    place.
- A fourth worked example, the valuation build: the title, then the bars with
  $1bn at the entrance and $4bn timed to "4 billion", "Four times" rising in
  as it is said, the $4bn bar's colour shifting to `accent`, and the camera
  pushing in on the bars. The three stage 1 examples stay: they remain valid
  single-step designs.
- `GRAPHIC_ANSWER_TOKENS` goes from 3,000 to 4,000: ten elements and a camera
  track make a longer answer.

The slot message is unchanged: it already carries the slot's length and the
words with their offsets.

### 5.2 No hard dead-air check

"No long still stretch" is a prompt rule, not a refusal. Narration has
pauses, and a hard limit would push the designer into motion for its own
sake or leave graphics "Not designed". The live loop measures it instead
(section 7); a check can follow if the prompt cannot hold it.

### 5.3 Mock mode

For a slot of 8 s or more, `mockGraphicScene` builds a two-step design: the
title and the figure as today, then at half the slot the title exits and a
second line enters in its cell, and the camera pushes in on the figure (when
there is one). Shorter slots get today's mock. Tests and e2e get a staged
graphic without spending.

### 5.4 Carrying the scene through

`resolvePlannedScene`, `toPlannedScene`, `reflowPortrait` and
`separateOverlaps` rebuild `{ elements }` and would drop a scene-level field;
each carries `camera` through. Element fields already pass through, since
each mapping spreads the element. A redesign shows the designer the current
scene with its motion.

## 6. The board

- The main thumbnail shows the graphic's final frame: what is on screen at
  the slot's end, bars at their final scale, colours after any shift.
- When anything in the graphic exits, a row of small frames sits beneath
  the thumbnail, one per step: a frame just before each distinct exit time,
  and the final frame. Every element is fully on screen in at least one of
  them. Each is labelled with its time ("At 0:10", the last "End"). They show
  the bars at that moment's scale and colours as they stand at that moment,
  and leave the camera out, so the whole composition can be checked.
- A graphic with no exits shows one thumbnail, as today.
- `GraphicPreview` takes the moment to draw (`atMs`, defaulting to the end);
  which elements are on screen, which bars have grown and which colour an
  element shows at a moment come from the layout module, so the card and
  the preview agree.
- The player is unchanged: it already plays the real `GraphicCard` at the
  slot's length.

## 7. The live loop

Before the merge, and only with the owner's go-ahead for each paid run: the
stage 1 harness on the Stability AI film's five graphics, $1 a run, the
stored production Anthropic key decrypted in memory and never printed,
production read only, nothing written to production or the cost ledger.

Harness changes:

- `pnpm render:graphics` takes frames at every change (entrances, exits,
  bar items, emphasis, camera moves), not only after entrances
  (`scripts/graphic-frames/frame-times.ts`).
- `run.json` records, per graphic, its longest still stretch: the longest
  gap between the first entrance and the slot's end in which no change
  starts (the drift does not count), and whether narration falls in it.

The target for the final run: no graphic longer than 8 s sits unchanged for
more than about 6 s while words are spoken; every word on screen traces to
the narration or a cited claim (stage 1's rule); no refusals.

## 8. Tests

Landing with the code they test (spec section 13):

- Schemas: a stage 1 scene parses unchanged; each new field parses; ten
  elements in total and six on screen; a camera focus that names no element
  is refused; `color` needs `to` and is refused on a logo; each of the seven
  timing rules, one test each, refused with its reason.
- Compositions: time-aware overlaps (a cross-fade shares a cell; co-visible
  elements still separate); portrait bands shared by elements never on
  screen together; the camera's zoom and pan caps in both orientations; the
  bar rescale; each exit; `mixColor`; the step frames' moments. Every stage 1
  golden unchanged; new goldens for one staged scene at several moments, in
  16:9 and 9:16.
- Providers: the prompt carries the new vocabulary and the fourth example;
  the mock builds two steps for a slot of 8 s and one for a shorter slot,
  and both pass the checks.
- Web: the designer refuses a timing break with its reason and retries; the
  card shows step frames for a staged graphic and one thumbnail otherwise.
- e2e (mock providers): a staged mock graphic shows its step frames and plays.

The full suite runs before the merge, not only the packages touched: the
scene is read by the schemas, providers, timeline, web and db suites. A
golden that fails in the full run is re-run with its package alone before it
is believed.

## 9. Rollout

The timeline schema changes (ten elements, the new fields), and an older
broker would refuse a scene with more than six elements and strip the new
fields from the rest. So, in this order:

1. `deploy:remotion`, so video renders use the new `GraphicCard`.
2. `deploy:stacks boom-busters-broker`, so the broker bundles the new
   schema.
3. A push to `master` (Vercel deploys itself), then `PUT /api/inngest`.

The owner runs the Lambda and broker scripts, as before. No migration:
briefs are JSON. If the stage 1 live loop's own deploys (figure `align`, the
60 s entrance cap) have not been run, this rollout carries them.

To see it: open a project's visual board, press Redesign graphic on a long
graphic, look at its step frames and play it; or re-plan a film.

PROGRESS records decision 290, the number checked against `origin/master` at
the merge.

## 10. Out of scope

- Easing and duration per entrance (owner's ruling, 1.2).
- A hard dead-air check (5.2).
- More than one emphasis on an element.
- Seeking the player from a step frame.
- Editing motion by hand on the board.
- Level 3: the model writing Remotion code.
