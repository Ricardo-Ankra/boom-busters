import {
  FIRST_CHANNEL_BIBLE,
  figureDigitGroups,
  GRAPHIC_SOURCE_MAX,
  GRAPHIC_STILL_MAX_MS,
  GRAPHIC_TITLE_MAX,
  PlannedGraphicCodeSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type {
  BibleInUse,
  ChannelBible,
  ChartSeries,
  PlannedGraphicCode,
} from '@boom-busters/schemas'
import { z } from 'zod'
import { fillSlots, literalBibleText, noun } from './bible'
import { GRAPHIC_CODE_FIXTURE_SOURCE } from './graphic-code-fixture'
import { REMOTION_RULES } from './remotion-rules'
import { claimList, type ScriptClaim } from './script'
import type { Exemplar } from '../exemplars/index'
import { formatIssues, parseJsonCompletion } from './json'
import { ignoreRepairs, trimField, type Note } from './repair'
import { outputBudget, type LLMTaskRequest } from '../llm/types'

export { GRAPHIC_CODE_FIXTURE_SOURCE }

/**
 * The graphics designer (decision 289; it writes code since decision 295):
 * one call per graphic or chart slot, on its own route. The shot list
 * decides that a beat is a graphic and what it must get across; this call
 * writes the graphic, a React component the sandbox in
 * `packages/compositions` runs. The web server checks the answer
 * (`apps/web/lib/graphic-code/`) before it is kept.
 *
 * Three messages: the system rules and the film message are identical for
 * every graphic of a film, so the provider caches them and each graphic pays
 * for its own slot message only.
 */

/** A whole component, with room to think first; a cut-off is asked again at double (decision 292). */
export const GRAPHIC_ANSWER_TOKENS = 12_000

export interface SlotWord {
  text: string
  offsetMs: number
}

/** The design a redesign replaces, as `GraphicDesignInput.current` carries it. */
export type CurrentDesign = Pick<PlannedGraphicCode, 'source' | 'title'> & {
  /** The preamble version the stored design carries, absent on a design stored before decision 301. */
  motion?: number
}

export interface GraphicDesignInput {
  /** The channel bible the project froze. */
  bible: BibleInUse
  caseTitle: string
  /** The film's claims in prompt order: positions are the numbers cited. */
  claims: readonly ScriptClaim[]
  /** Titles the logo library holds. */
  logos: readonly string[]
  chapterTitle: string
  coversText: string
  /** The paragraph or paragraphs the slot sits in, for context. */
  paragraphText: string
  durationMs: number
  words: readonly SlotWord[]
  wordsEstimated: boolean
  intent: string
  intentRefs: readonly number[]
  /** A chart slot: its brief's series, takeaway and annotations, which the code reads as `props.data`. */
  data?: {
    series: ChartSeries[]
    takeaway: string
    annotations?: { atX: string; text: string }[]
  }
  /** A redesign: the source and title being replaced (ruling 9; its facts are not shown). */
  current?: CurrentDesign
  guidance?: string
  /** A passing design of the slot's technique, shown in the slot message (decision 305). */
  exemplar?: Exemplar
  /** Why the previous answer to this same slot was refused. */
  rejection?: string
}

/**
 * The two worked examples are bible slots (a worked example is a channel's
 * own story), so their code lives in the first channel's bible. These three
 * read it back for a test that runs the example through the web app's checks:
 * an example that crashes or crops teaches the model to be refused. The beat
 * is a text-only graphic written on the tokens, with the one hero spring of a
 * beat; the chart is a bar chart read off `props.data`. A slot is its prose,
 * a blank line, then the component.
 */
const afterProse = (slot: string): string => slot.slice(slot.indexOf('\n\n') + 2)
const WORKED_CHART = FIRST_CHANNEL_BIBLE.examples['graphics-worked-chart']!

export const GRAPHIC_EXAMPLE_TYPE = afterProse(
  FIRST_CHANNEL_BIBLE.examples['graphics-worked-beat']!,
)

/** The second worked example's data, as the slot message would carry it. */
export const GRAPHIC_EXAMPLE_CHART_DATA = JSON.parse(
  WORKED_CHART.split('\n').find((line) => line.startsWith('{"series"'))!,
) as NonNullable<GraphicDesignInput['data']>

/** The second worked example's component. */
export const GRAPHIC_EXAMPLE_CHART = afterProse(WORKED_CHART)

const systemTemplate = (
  bible: ChannelBible,
): string => `You write ONE motion graphic for a documentary about [[example:direction-premise]], as a React
component. The narration is recorded; your graphic plays over it in the 16:9 film and in
the 9:16 Short, and it lands the beat the narrator is speaking.

You get the case and its numbered claims, the logos the producer holds, and then this
slot: its chapter, the paragraph it sits in, the words it covers, its length, every
spoken word with its time from the slot's start, the intent (what the viewer must take
away) and the claims it rests on. A chart slot also carries its data.

Answer with JSON only:
{"title": "...", "facts": [{"text": "...", "claim": 3}], "source": "..."}
- "title": the slot card's name for the graphic, one line of at most ${GRAPHIC_TITLE_MAX} characters.
- "facts": every number and every quoted phrase the graphic shows, each with the NUMBER
  of the claim it comes from. A year is a number. At most 40 entries: more is refused, not
  cut. A chart's digits read off props.data need no entry.
- "source": the component, at most ${GRAPHIC_SOURCE_MAX} characters, as one JSON string. Escape
  its double quotes and line breaks as JSON requires.

The sandbox your code runs in:
- Declare function Graphic(props) at the top level; helper functions and constants
  beside it are fine. Write no import and no export: the sandbox runs your code as the
  body of a function of (React, Remotion, props) and returns Graphic. JSX compiles to
  React.createElement. Call Remotion.useCurrentFrame(), Remotion.useVideoConfig() and
  React.useMemo only at the top of Graphic, never inside a helper or a condition; hand a
  helper the frame and fps as arguments, as both examples do. A helper is a plain
  function you call directly, row(label, value), never a React component rendered with
  createElement or JSX: that outer function is parsed once and run again for every frame,
  so a component declared inside it is a new component on each run and would remount its
  subtree on every frame.
- React: React itself, for elements, React.Fragment and React.useMemo.
- Remotion.useCurrentFrame(): the frame, from 0 at the slot's start, 30 to the second.
- Remotion.useVideoConfig(): {width, height, fps, durationInFrames}; the frame is 1920 by
  1080 or 1080 by 1920. Time your motion against props.durationMs and the words' atMs,
  not durationInFrames: in the film that is the length of the compiled slot, which can
  differ from the length you design for.
- Remotion.interpolate(value, inputRange, outputRange, {easing, extrapolateLeft,
  extrapolateRight, output}): inputRange strictly increasing; "clamp" holds the ends.
  output: 'perceptual-scale' on any interpolate that drives a scale.
- Remotion.spring({frame, fps, delay, config}): Remotion's spring, 0 to 1 from the delay;
  its config is always a token (below).
- motion: the house motion tokens, declared above your code and read-only. motion.ms
  {micro 120, enter 450, exit 300, reveal 550, draw 700, count 1000, move 900, gap 120},
  lengths in milliseconds. motion.frames(ms, fps), a length in whole frames, at least 1,
  and a time too: a word at 0 ms starts on frame 1. motion.ease {enter, exit, move,
  emphasis, linear}, the only curves. motion.spring {settle, hero, snap}, the only spring
  configs. motion.px.rise (20 at 1080p; multiply by your unit). motion.scale.enter (0.96).
  motion.stagger(index, fps), the frame offset of the index-th item of a group.
  motion.order ['frame', 'title', 'body', 'hero', 'note'], the entrance order.
- Remotion.Sequence {from, durationInFrames}: its children show only inside that window,
  and inside it useCurrentFrame() counts from 0. A Sequence's durationInFrames is at
  least 1 and its from a finite number, so wrap a length worked out from the words in
  Math.max(1, ...): anything else throws in the render, and the film shows only the
  title. Its children sit in a full-frame layer laid out as a flex row, unless
  layout="none".
- Remotion.AbsoluteFill {style}: a full-frame layer, laid out as a flex column.
- Remotion.Img {src, style}: an image, for a logo.
- Remotion.withAlpha(color, alpha): a brand colour at an opacity from 0 to 1.
- props.brand.colors: primary, accent, background, surface, textPrimary, textSecondary and
  captionHighlight; chartSeries, a list of colours for compared things; semantic.collapse
  and semantic.recovery.
- props.brand.fonts: heading, title, body, numbers and captions, family names for
  fontFamily. Figures are set in numbers.
- props.words: the narration, [{text, atMs}], atMs from the slot's start.
- props.durationMs: the slot's length.
- props.safeArea: {top, right, bottom, left}, insets in pixels for this frame size. The
  captions sit below the bottom inset.
- props.logos: {[title]: {src, width, height}} for the marks in the Logos list, under
  their exact titles. A mark can be missing: draw it only when props.logos holds it.
- props.data: on a chart slot, {series: [{label, unit, points: [{x, y}]}], takeaway,
  annotations?: [{atX, text}]}. Absent otherwise.
Never write import, require, window, document, fetch, setTimeout, setInterval,
requestAnimationFrame, Date, Math.random, eval, Function, globalThis, process, useState,
useEffect or useLayoutEffect, React.Suspense, React.lazy, a # colour, or rgb(), rgba(),
hsl() or hsla(); and assign to nothing under React or Remotion. A scan refuses them.
It also refuses constructor, prototype, __proto__, getPrototypeOf, Reflect, Proxy, self,
navigator, XMLHttpRequest, WebSocket, EventSource, localStorage, sessionStorage,
indexedDB, postMessage, importScripts, Worker and dangerouslySetInnerHTML; top, parent,
frames, opener and location read or called as the browser's (a style's top is fine); and
a script, iframe, object, embed, link, style, meta, base or form element.
It refuses Remotion.Easing in any form (the curves are motion.ease), an interpolate with no
easing: motion.ease.<name> written inside the call, a spring other than
Remotion.spring({ frame, fps, delay, config: motion.spring.<name> }), Remotion['...'],
React['...'] or motion['...'], an assignment to motion, a motion binding of your own, a
Remotion.spring or Remotion.interpolate read without being called, and a motion.ease or
motion.spring name that is not a token.
Format a number by hand ("1.9", "4,000,000"), never with toLocaleString or Intl: those
follow the viewer's locale, so the board and the film would show different figures.
Motion comes from the frame alone: no CSS transition, animation or @keyframes, which the
board plays between frames and the film never does.

The rules. Each one is checked, and a graphic that breaks one is refused:
1. Facts. Every number on screen comes from a claim, and its digits appear in that
   claim's text ("$4bn" from "4 billion dollars" is fine; "$4.2bn" is not). A number that
   stays on screen for a second must be in a claim your facts cite; a counter's passing
   values are not checked while they keep moving, so land a count on the claim's figure.
   Words on screen say only what the narration or the cited claims say. Never add a
   fact, a judgement, a qualifier or a source note of your own ("never audited", "widely
   cited", "allegedly"): this is a film about real ${literalBibleText(noun(bible, 'plural'))} and real people, and no
   check reads your words, only your numbers.
2. Brand. Colours come from props.brand.colors only, with Remotion.withAlpha for opacity;
   type comes from props.brand.fonts. The house paints the background behind your
   graphic.
3. A pure function of the frame. The same frame always draws the same picture: no clock,
   no randomness, no state, nothing that runs after the render.
4. Timing to the narration. Each new thing said gets its own change on screen, landing as
   it is said: a figure as its number is spoken, a name as it is named, a bar as its year
   is read. Dead air is the failure to avoid: a graphic in which nothing changes for more
   than ${GRAPHIC_STILL_MAX_MS / 1000} seconds is refused.
5. Both frames. Lay out from useVideoConfig()'s width and height: the 16:9 frame and the
   9:16 frame are both rendered and both checked.
6. Safe area. Everything sits inside props.safeArea at every frame, entrances included.
   Pad a full-frame layer by the insets, place anything absolutely positioned at or
   inside them, and bring an entrance in with opacity, scale or transform, never from
   outside the insets. Only a Remotion.AbsoluteFill spans the whole frame.
The code is run at every 250 ms of the slot in both frames before it is kept: a frame
that throws, or takes more than 2 seconds, is refused. The last second shows the
finished graphic, with words or figures on screen.

Craft:
- Kinetic type, not paragraphs: a few words at a time, big, entering as they are spoken.
  A line can build word by word.
- One dominant idea with secondary detail: one thing is biggest, and the rest supports it.
- Motion keyed to the spoken words: each new thing said gets its own change, whether an
  entrance, a highlight, a bar growing or a line drawing across.
- Entrances, exits and moves come from the tokens, in the house motion below. Nothing
  passes its mark except the one hero spring of a beat and snap's hair of overshoot on
  small things; nothing spins.
- An ending that holds rather than vanishes.
- Portrait is a first-class frame, not a squeeze: stack what sits side by side, and size
  type from Math.min(width, height).
- Colour carries meaning: semantic.collapse for loss and failure, semantic.recovery for
  gain, accent or captionHighlight for the one thing to look at, chartSeries to tell
  compared things apart, textPrimary and textSecondary for words.
- A logo earns its place when the ${literalBibleText(noun(bible, 'singular'))} or person is the subject, not because they
  are mentioned.
- A chart draws every point of props.data, labels each value as its claim states it, and
  says its takeaway.

The house motion. The scan holds the curve and the spring config: every interpolate names
a motion.ease, every spring a motion.spring. Which curve, which preset, hero once per beat
and every length are judged on the board, not checked:
- Every interpolate carries easing: motion.ease.<name>, written inside the call: enter for
  arrivals, exit for departures, move for a reframe or the camera, emphasis for the one
  hero figure of the beat, linear for counters and progress only. For several keyframes
  pass an array of them, one fewer than the keyframes. Never pass the options through a
  variable: the check reads the call.
- A spring is Remotion.spring({ frame, fps, delay, config: motion.spring.<name> }) and
  nothing else: settle by default (no overshoot), hero at most once per beat (one small
  overshoot, for the figure the beat is about), snap for small things only (a tick, a dot,
  a badge), never a figure or a title. A spring is for an arrival that should feel
  physical; ease everything else.
- Lengths come from motion.ms: an entrance is motion.ms.enter, an exit motion.ms.exit
  (exits are shorter than entrances), a wipe motion.ms.reveal, a bar or a line drawn on
  motion.ms.draw, a count motion.ms.count, a move motion.ms.move. A change within a beat
  is an exit, a motion.ms.gap pause, then an entrance. Convert with motion.frames(ms, fps).
- A fade rises motion.px.rise times your unit; a figure scales in from motion.scale.enter,
  never from 0; a wipe is a clip-path.
- A group of three or more elements staggers: the index-th item enters motion.stagger(index,
  fps) frames after the first. Anything keyed to the narration keeps its spoken time;
  stagger only what the narration does not time.
- The hero lands last, with only its note after it: entrances follow motion.order, frame,
  title, body, hero, note.
- A beat gets one kind of entrance. Emphasis on a word is a colour or weight change over
  motion.ms.micro, with interpolate.

${REMOTION_RULES}

[[example:graphics-worked-beat]]

[[example:graphics-worked-chart]]`

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

export function buildGraphicRequest(input: GraphicDesignInput): LLMTaskRequest {
  const logos = input.logos.filter((title) => title.trim().length > 0)
  const film =
    `Case: ${input.caseTitle}\n\nClaims:\n${claimList(input.claims)}` +
    (logos.length > 0
      ? `\n\nLogos (marks the producer holds):\n${logos.map((title) => `- ${title}`).join('\n')}`
      : '')

  const words = input.words.map((word) => `${seconds(word.offsetMs)}  ${word.text}`).join('\n')
  const slot =
    `Chapter: ${input.chapterTitle}\n\n` +
    `The paragraph: ${input.paragraphText}\n\n` +
    `This graphic covers: ${input.coversText}\n` +
    `Length: ${seconds(input.durationMs)}\n\n` +
    `Words spoken in it, from its start${input.wordsEstimated ? ' (estimated from the slot length; no recorded timings)' : ''}:\n${words}\n\n` +
    `Intent: ${input.intent}\n` +
    `Rests on claims: ${input.intentRefs.length > 0 ? input.intentRefs.join(', ') : 'none named'}` +
    (input.data
      ? `\n\nData (draw every point; values are verbatim from the claims):\n${JSON.stringify(input.data, null, 2)}`
      : '') +
    (input.exemplar ? `\n\n${exemplarBlock(input.exemplar)}` : '')

  return {
    task: 'graphics',
    system: fillSlots(systemTemplate(input.bible.bible), input.bible),
    messages: [
      { role: 'user', content: film },
      { role: 'user', content: slot },
      ...(input.current ? [{ role: 'user' as const, content: currentDesign(input.current) }] : []),
      ...(input.rejection
        ? [
            {
              role: 'user' as const,
              content: `Your previous answer for this slot was refused: ${input.rejection}. Answer again with that fixed.`,
            },
          ]
        : []),
      // Last, nearest the answer, and only when there is one.
      ...(input.guidance
        ? [{ role: 'user' as const, content: `The producer's steer: ${input.guidance}` }]
        : []),
    ],
    cacheablePrefixMessages: 1,
    maxTokens: outputBudget(GRAPHIC_ANSWER_TOKENS),
  }
}

/**
 * The slot's exemplar (decision 305): one passing design of the technique
 * the brief calls for, in the sandbox and on the tokens, so the model
 * patterns on the technique and not on the system prompt's two examples. It
 * sits in the slot message, after the data, so the cached film message and
 * the system prompt are untouched. Four backticks fence it, so a design that
 * holds three in a string cannot close the block early.
 */
function exemplarBlock(exemplar: Exemplar): string {
  return (
    `A passing design of this technique (${exemplar.technique}: ${exemplar.description}), in this ` +
    'sandbox and on the tokens, to pattern on. Its words and figures are its own; yours come ' +
    'from this slot and its claims:\n' +
    '````jsx\n' +
    exemplar.source +
    '\n````'
  )
}

const PRE_TOKEN_DESIGN =
  '\nThis design was written before the motion tokens: move every curve onto motion.ease, every spring onto motion.spring, and every length onto motion.ms, keeping what the producer has not asked to change.'

/**
 * A redesign's starting point: the title, and the code fenced so its JSX reads
 * as code. A design stored before the motion tokens (no `motion`) is said to
 * be one, so the model moves it onto them rather than keeping `Easing`, which
 * the scan refuses (decision 301).
 */
function currentDesign(current: CurrentDesign): string {
  return (
    'The current design, which the producer wants changed:\n' +
    `Title: ${current.title}\n` +
    '```jsx\n' +
    current.source +
    '\n```' +
    (current.motion === undefined ? PRE_TOKEN_DESIGN : '')
  )
}

/**
 * The designer's answer, validated. The title is free text, so one over
 * `GRAPHIC_TITLE_MAX` is trimmed with `trimField` and the trim reported
 * through `note` (decision 293). Nothing else is repaired: a cut source would
 * not compile, and a claim number or a fact's text is a fact. A malformed
 * answer is refused, and the retry is told why (decision 292).
 */
export function parseGraphicCode(text: string, note: Note = ignoreRepairs): PlannedGraphicCode {
  const raw = parseJsonCompletion(text, z.looseObject({}), 'graphic code')
  const parsed = PlannedGraphicCodeSchema.safeParse({
    ...raw,
    title: trimField(raw['title'], GRAPHIC_TITLE_MAX, "the graphic's title", note),
  })
  if (!parsed.success) {
    throw new ValidationError(`The graphic answer is malformed: ${formatIssues(parsed.error)}`, {
      field: 'graphic code',
    })
  }
  return parsed.data
}

/** The words spoken inside a slot, on the slot's own clock. */
export function wordsInSlot(
  words: readonly { text: string; startMs: number }[],
  startMs: number,
  durationMs: number,
): SlotWord[] {
  return words
    .filter((word) => word.startMs >= startMs && word.startMs < startMs + durationMs)
    .map((word) => ({ text: word.text, offsetMs: word.startMs - startMs }))
}

/** No recorded timings: the covered words spread evenly across the slot. */
export function estimatedWords(coversText: string, durationMs: number): SlotWord[] {
  const words = coversText.split(/\s+/).filter(Boolean)
  const step = words.length > 0 ? durationMs / words.length : 0
  return words.map((text, at) => ({ text, offsetMs: Math.round(at * step) }))
}

/**
 * The fixture's counting figure, which lands on "$4bn". The mock swaps the
 * whole expression for a literal figure built from a claim's own digits.
 */
const FIXTURE_FIGURE = "'$' + Math.round(count * 40) / 10 + 'bn'"

/**
 * Deterministic design for MOCK_PROVIDERS=1 (decision 295; ruling 11): the
 * fixture graphic, its figure swapped for `'$<digits>bn'`, where the digits
 * are the first digit group of the claim it cites (the first intent claim
 * with a digit, else the first claim with one), and its one fact that figure
 * on that claim. With no digit-bearing claim the figure is `''` and the
 * design cites nothing. Either way it passes the real checks on any seed.
 * Steered, the title says so, so a redesign proves something offline. The
 * fixture reads its frame and length from the sandbox: the slot's length and
 * a chart's data change nothing, and are taken so the mock is called as the
 * designer is.
 */
export function mockGraphicCode(input: {
  claimTexts: readonly string[]
  intentRefs: readonly number[]
  guidance?: string
  durationMs: number
  data?: GraphicDesignInput['data']
}): PlannedGraphicCode {
  const cited = mockFigure(input.claimTexts, input.intentRefs)
  const figure = cited?.text ?? ''
  return {
    title: input.guidance
      ? `[mock] Redesigned: ${input.guidance}`.slice(0, GRAPHIC_TITLE_MAX).trim()
      : '[mock] Raised in one round',
    facts: cited ? [cited] : [],
    // A replacer function, so the `$` in the figure is never read as a pattern.
    source: GRAPHIC_CODE_FIXTURE_SOURCE.replace(FIXTURE_FIGURE, () => `'${figure}'`),
  }
}

/** `'$<digits>bn'` on the claim it comes from, or null when no claim has a digit. */
function mockFigure(
  claimTexts: readonly string[],
  intentRefs: readonly number[],
): { text: string; claim: number } | null {
  const everyClaim = claimTexts.map((_, index) => index + 1)
  for (const claim of [...intentRefs, ...everyClaim]) {
    const digits = figureDigitGroups(claimTexts[claim - 1] ?? '')[0]
    if (digits !== undefined) return { text: `$${digits}bn`, claim }
  }
  return null
}
