# The designer writes the graphic (decision 295)

Status: design approved in conversation 2026-10-12, section by section; this
document is for the owner's review before an implementation plan is written.

## 1. The problem

Decisions 268, 289 and 290 built the motion graphics as a form the model
fills in: elements of five kinds placed on a 12x12 grid, four entrances,
three exits, three emphases, one camera track, and every duration a constant
(`packages/schemas/src/graphics.ts`, `graphic-timing.ts`). The renderer,
`GraphicCard`, does exactly what that form allows: one easing curve
(smoothstep), fixed 600 ms entrances, no springs, no stagger groups, no
arrows, lines, paths, icons or word-by-word text. The prompt
(`packages/providers/src/prompts/graphics.ts`) then pushes restraint hard
("fewer elements beat more", "no decorative rule or shape", "never motion for
its own sake") and its four examples are a title over a figure in one centred
column. The shot list scopes a graphic to "one or two cited figures, a mark,
or a relationship" before the designer sees it.

The live runs of 8 October (`live-graphic-runs/`) show the result: every
scene is two to four elements in one column. On 2026-10-12 the owner's
findings were that the brand fonts and colours are used well, that the
animations feel unpolished and the graphics simplistic and amateur, text-only
ones most of all, and that the guardrails and structure are what restrict
them. The owner also found that the graphics now look better than the chart
format, whose single draw-on reveal has not changed since decision 254.

Claude Motion (Anthropic, beta from 2026-10-08 on Team and Enterprise plans)
does what the owner is asking for: Claude writes the animation code and it
plays live, with kinetic type, counters, bars and scene cuts. It has no API,
so it cannot sit in the pipeline. Its approach can.

### 1.1 The decision

Owner's rulings in the conversation, 2026-10-12:

- The designer writes the animation itself, as code, instead of filling in a
  form. Guardrails stay on facts, brand, timing and frame purity; the grid,
  the element vocabulary, the entrance and exit lists, the timing constants,
  the six-on-screen ceiling and the restraint rules go.
- Charts move onto the same designer: a chart is a graphic the designer
  builds around real series data. The chart format's own reveal stays only
  as the renderer for chart slots with no design yet.
- The $1 live loop (`pnpm live:graphic`, decision 289's follow-up) is
  dropped. The board plays the real composition and Redesign runs the real
  designer; stills cannot show whether a spring settles. The script is
  deleted and the saved runs are kept as a record.

## 2. What the designer writes

The designer's answer is JSON with three parts:

- `source`: one React function component, in JSX, at most 16 KB. It must
  declare `function Graphic(props)` at the top level; helper functions and
  constants beside it are allowed. The sandbox appends `return Graphic` to
  the compiled code, so no `export` is written or needed.
- `title`: one line for the slot card (at most 80 characters).
- `facts`: every number or quoted phrase the graphic shows, each with the
  claim number it comes from: `[{ text, claim }]`.

The component is evaluated inside a sandbox the compositions package owns.
It receives, as arguments it cannot import around:

| Argument | What it is |
| --- | --- |
| `React` | React itself (hooks allowed). |
| `Remotion` | `useCurrentFrame`, `useVideoConfig`, `interpolate`, `spring`, `Easing`, `Sequence`, `AbsoluteFill`, `Img`. Nothing else from Remotion. |
| `props.brand` | The brand tokens: `colors` (primary, accent, background, surface, textPrimary, textSecondary, captionHighlight, collapse, recovery, series[]) as hex strings, and `fonts` (heading, body, numbers, captions: loaded family names). |
| `props.words` | The slot's narration, `[{ text, atMs }]`, offsets from the slot's start. |
| `props.durationMs` | The slot's length. |
| `props.safeArea` | Insets in pixels for the current frame size. |
| `props.logos` | `{ [entity]: { src, width, height } }` for the logos it cited. |
| `props.data` | For a chart slot: the chart brief's `series`, `annotations` and `takeaway`. Absent otherwise. |
| `props.intent` | The shot list's intent text. |

The sandbox is `new Function('React', 'Remotion', 'props', compiled)` in the
browser and on Lambda, and the same with shimmed Remotion hooks in the dry
run (section 3). There is no module scope: `import`, `require`, `window`,
`document`, `fetch`, timers, `Date`, `Math.random` and `eval` are banned by
the static scan, so the code is a pure function of the frame.

### 2.1 The rules that stay, and who enforces them

1. **Facts.** Every digit sequence in a string literal of the source must
   appear in a claim the `facts` manifest cites (today's `figureCitesClaim`,
   applied to the source). A number the claims do not contain is a refusal
   naming it. A quoted phrase in `facts` must appear in its claim's text.
2. **Brand.** Colours come from `props.brand.colors` only: a `#` hex or
   `rgb(` literal in the source is a refusal. Opacity is applied with the
   sandbox helper `Remotion.withAlpha(hex, alpha)` (ours, listed with the
   Remotion argument for convenience). Type comes from `props.brand.fonts`.
3. **Frame purity.** The banned globals above; a static scan refuses them.
4. **Timing to the narration.** The prompt rule stays; the dry run measures
   dead air (section 3).
5. **Both frames.** The component reads `useVideoConfig()` and lays out for
   16:9 and 9:16; the dry run exercises both.
6. **Safe area.** Nothing placed outside `props.safeArea`; the dry run
   checks absolutely positioned elements (section 3).

Everything else is the designer's judgement: layout, how many things are on
screen, easing, springs, staggers, word-by-word reveals, arrows and
connectors, scene cuts, a camera of its own making.

### 2.2 The shot list's scope

`GRAPHIC_INTENT_RULES` in `packages/providers/src/prompts/shotlist.ts`
widens from "one or two cited figures, a company's or a person's mark, or a
relationship between named things" to what a motion designer would build for
the beat: a figure, a comparison, a timeline, a diagram of who did what to
whom, a kinetic restatement of the narration's key phrase. The intent still
cites claims by number and stays within `GRAPHIC_INTENT_MAX`.

### 2.3 The prompt

`packages/providers/src/prompts/graphics.ts` is rewritten:

- The brief: the beat's words with offsets, the intent, the claims and
  logos, and for a chart the series.
- The sandbox contract: the arguments of section 2 and the banned list.
- The six rules of section 2.1.
- A craft section, short: kinetic type over paragraphs; one dominant idea
  with secondary detail; motion keyed to the spoken words, with each new
  thing said getting its own change; a spring or an overshoot where the
  number is the story; an ending that holds rather than vanishes; portrait
  as a first-class frame, not a squeeze.
- Two worked examples as complete components: one text-only beat, one chart.

Direction-craft (the house bible) is not embedded; the brand tokens carry the
look, as today. The answer budget rises to 12,000 tokens; a cut-off is
retried at double (decision 292).

## 3. How a design is checked

The designer runs on the two-call helper (decision 292): one call, and one
retry told what was wrong. The checks, in order, all on the web server:

1. **Compile.** esbuild (`transform`, JSX to JavaScript, ES2020). A syntax
   error is a refusal with esbuild's message and line.
2. **Static scan.** On the source: the banned identifiers, hex and `rgb(`
   literals, `import`/`require`, the size cap, and the facts check of 2.1.
3. **Dry run.** The compiled function is rendered with
   `react-dom/server.renderToStaticMarkup` at every 250 ms of the slot, in
   both frame sizes (1920x1080 and 1080x1920 at 30 fps), with shimmed hooks:
   `useCurrentFrame` returns the frame, `useVideoConfig` the size and fps,
   `spring` and `interpolate` are Remotion's real pure functions, `Sequence`
   and `AbsoluteFill` are plain wrappers, `Img` renders an `img`. A throw at
   any frame is a refusal naming the frame and the error; a frame that takes
   longer than 2 s is a refusal ("frame 40 did not finish").
4. **Dead air.** Consecutive frames whose markup is identical for longer
   than `GRAPHIC_STILL_MAX_MS` (6 s, today's target) are a refusal naming
   the stretch: "nothing changes between 4.2 s and 11.0 s".
5. **Safe area.** From the same markup, an element with inline
   `position: absolute` whose `left`/`top`/`right`/`bottom` places it outside
   the safe insets is a refusal naming the element's text.

A design that passes is stored on the brief as
`code: { version: 1, source, compiled, title, facts, words, durationMs }` (not `motion`: every brief already carries the Ken Burns `motion` spec), beside today's
`scene`, which stays for graphics already built. `designIssue` keeps its
meaning for a design that failed both calls.

The dry run cannot judge whether the graphic looks good. That stays with the
owner: the board plays the real composition (decision 289), and Redesign with
a steer is the loop.

## 4. Rendering and the preview

**Compositions.** A new component `GraphicCode` in
`packages/compositions/src/components/`: it builds the function once from
`payload.compiled` (memoised on the string), renders it inside the same
background, font loading and safe-area frame as `GraphicCard`, and wraps it
in an error boundary that renders the title on the brand background if the
code throws, so one graphic can never fail a master render. `GraphicCard`
stays for `scene` payloads. `DocumentaryMaster` picks by payload kind.

**Timeline.** A new payload `{ kind: 'graphic-code', version, compiled,
title, logos, claimIds, data? }` in `packages/schemas/src/timeline.ts`;
`packages/timeline/src/compile.ts` emits it for a brief with `code`, the
old `graphic` payload for a brief with only `scene`, and the `chart` payload
for a chart brief with no `code`. A render never depends on anything
outside the timeline but the logo objects, as now.

**Board.** `graphic-player.tsx` mounts `GraphicCode` in the Player for a
brief with `code`; the still thumbnail is a frame of the same component,
rendered to markup in the browser, replacing the SVG `GraphicPreview` for
these briefs. Chart slots with `code` get the same player.

**Version.** `version` on the payload names the sandbox contract. A payload
whose version the composition does not know renders the title card and logs
it, rather than misrendering.

**Lambda.** The timeline schema gains a payload, so the broker and the
Remotion site need `deploy:stacks boom-busters-broker` and `deploy:remotion`
(the Lambda recipe, run by the owner) before the designer is switched on; a
new-style graphic would otherwise 422 at render.

## 5. Charts

The shot list keeps writing `ChartBrief` as now (kind, series, points copied
verbatim from claims, takeaway, annotations). When a chart slot is planned or
retyped, the designer is called with the brief's series as `props.data` and
writes the chart as it writes any graphic. The result is stored as `code`
on the chart brief; `ChartBriefSchema` gains the same optional `code` and
`designIssue` fields as `GraphicBriefSchema`. The facts check applies to the
chart's text; the series are validated upstream already. `ChartReveal`
renders a chart brief with no `code`. On the board a chart card gets the
Redesign button and the steer field a graphic card has. The chart format
itself (the brief, the shot list's rules) does not change.

`designPlannedGraphics` (`apps/web/inngest/lib/graphic-steps.ts`) designs
chart rows as well as graphic rows, one step each, skipping any that already
carry `code`.

## 6. UI

The slot card's Redesign button, steer field and "Not designed" line stay
(decision 289). The card shows `code.title`. Settings keep the "Motion
graphics" route on Opus 5.5. The code is not shown or edited in the app.

## 7. Tests

- `packages/schemas`: the `code` fields and the `graphic-code` payload.
- `apps/web/lib/graphic-code/`: the static scan against known-bad sources
  (a hex colour, `Math.random`, an `import`, a number not in any claim); the
  dry run against a component that throws at frame 40, one that holds still
  for 8 s, one that places text off the safe area, and one that passes.
- `packages/compositions`: a fixture component (`fixtures/graphic-code.ts`)
  with a golden render in both frames; the error boundary rendering the
  title when the code throws; the unknown-version card.
- `packages/providers`: the parser and the request builder.
- The mock designer returns the fixture component, so the visuals runner,
  the retyper, the rebriefer and e2e need no model.
- `packages/timeline`: `compile` emitting each of the three payloads.

## 8. Rollout

1. Schemas, sandbox, compiler, dry run, composition and the board, all
   tested with the mock designer; the prompt rewritten.
2. `deploy:stacks boom-busters-broker` and `deploy:remotion`.
3. The Vercel deploy and `PUT /api/inngest`. No migration: `code` lives in
   the brief's JSON column.
4. The owner's first Redesign on a real slot; the cost per graphic read off
   the Costs screen and reported. Expected from token counts: $0.30 to
   $0.60 per graphic on Opus 5.5 against about $0.03 today, so roughly $2 to
   $9 per film. The owner decides from the real figure whether the route
   stays on Opus.

PROGRESS records decision 295, the number checked against `origin/master`
at the merge.

## 9. Out of scope

- Showing or editing the code in the app.
- A library of reusable animation pieces.
- The teaser's own graphics.
- Migrating existing `scene` graphics: they keep rendering, and Redesign
  replaces one when the owner chooses.
- Changing the chart format's brief or the shot list's chart rules.
- Visual judgement by machine: the dry run finds crashes, dead air and
  cropping, not taste.
